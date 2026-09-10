import type { SlopFinding } from "./types"

export type FindingLifecycleState = "NEW" | "PERSISTENT" | "RESOLVED" | "REINTRODUCED"

export type DeduplicatedFinding = {
  readonly fingerprint: string
  readonly rule: string
  readonly severity: "info" | "warning" | "blocker"
  readonly file: string
  readonly line?: number
  readonly evidence: string
  readonly fix: string
  readonly explanation?: string
  readonly state: FindingLifecycleState
  readonly firstSeenTurn: number
  readonly turnsPersistent: number
  readonly escalatedToBlocker: boolean
}

export type FindingGroup = {
  readonly rootCause: string
  readonly file?: string
  readonly count: number
  readonly findings: readonly DeduplicatedFinding[]
}

export type ActionableFeedbackResult = {
  readonly turn: number
  readonly totalFindings: number
  readonly newCount: number
  readonly persistentCount: number
  readonly resolvedCount: number
  readonly topFindings: readonly DeduplicatedFinding[]
  readonly groups: readonly FindingGroup[]
  readonly formattedFeedback: string
}

export type DedupOptions = {
  readonly topK?: number
  readonly escalationThreshold?: number
}

const DEFAULT_TOP_K = 5
const DEFAULT_ESCALATION_THRESHOLD = 3

export function computeFindingHash(rule: string, file: string, snippet: string): string {
  const normalizedSnippet = snippet.replace(/\s+/g, " ").trim().slice(0, 120)
  const combined = rule + "::" + file + "::" + normalizedSnippet
  let hash = 0x811c9dc5
  for (let i = 0; i < combined.length; i++) {
    hash ^= combined.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, "0")
}

export class FindingDeduplicator {
  private knownFindings = new Map<
    string,
    {
      finding: SlopFinding
      firstSeenTurn: number
      lastSeenTurn: number
      turnsPersistent: number
      resolved: boolean
      escalated: boolean
    }
  >()

  private readonly options: DedupOptions

  constructor(options: DedupOptions = {}) {
    this.options = options
  }

  processTurn(turn: number, rawFindings: readonly SlopFinding[]): ActionableFeedbackResult {
    const topK = this.options.topK ?? DEFAULT_TOP_K
    const escalationThreshold = this.options.escalationThreshold ?? DEFAULT_ESCALATION_THRESHOLD

    const currentFingerprints = new Set<string>()
    const processed: DeduplicatedFinding[] = []

    for (const raw of rawFindings) {
      const fp = raw.hash ?? computeFindingHash(raw.rule, raw.file, raw.evidence)
      currentFingerprints.add(fp)

      const existing = this.knownFindings.get(fp)

      if (!existing) {
        this.knownFindings.set(fp, {
          finding: raw,
          firstSeenTurn: turn,
          lastSeenTurn: turn,
          turnsPersistent: 0,
          resolved: false,
          escalated: false,
        })

        processed.push({
          fingerprint: fp,
          rule: raw.rule,
          severity: raw.severity,
          file: raw.file,
          line: raw.line,
          evidence: raw.evidence,
          fix: raw.fix,
          explanation: `Newly introduced issue in turn ${turn}.`,
          state: "NEW",
          firstSeenTurn: turn,
          turnsPersistent: 0,
          escalatedToBlocker: false,
        })
      } else {
        const wasResolved = existing.resolved
        existing.lastSeenTurn = turn
        existing.resolved = false
        existing.turnsPersistent++

        let severity = raw.severity
        let escalatedToBlocker = existing.escalated

        if (!escalatedToBlocker && existing.turnsPersistent >= escalationThreshold && severity === "warning") {
          severity = "blocker"
          escalatedToBlocker = true
          existing.escalated = true
        }

        const state: FindingLifecycleState = wasResolved ? "REINTRODUCED" : "PERSISTENT"

        processed.push({
          fingerprint: fp,
          rule: raw.rule,
          severity,
          file: raw.file,
          line: raw.line,
          evidence: raw.evidence,
          fix: raw.fix,
          explanation: escalatedToBlocker
            ? `Escalated to blocker: persisted for ${existing.turnsPersistent} turns without resolution.`
            : `Persistent issue originally seen in turn ${existing.firstSeenTurn}.`,
          state,
          firstSeenTurn: existing.firstSeenTurn,
          turnsPersistent: existing.turnsPersistent,
          escalatedToBlocker,
        })
      }
    }

    let resolvedCount = 0
    for (const [fp, record] of this.knownFindings) {
      if (!currentFingerprints.has(fp) && !record.resolved) {
        record.resolved = true
        resolvedCount++
      }
    }

    const newCount = processed.filter((p) => p.state === "NEW").length
    const persistentCount = processed.filter((p) => p.state === "PERSISTENT").length

    const severityOrder = { blocker: 3, warning: 2, info: 1 }
    const stateOrder = { NEW: 3, REINTRODUCED: 2, PERSISTENT: 1, RESOLVED: 0 }

    const sorted = [...processed].sort((a, b) => {
      const sevDiff = severityOrder[b.severity] - severityOrder[a.severity]
      if (sevDiff !== 0) return sevDiff
      const stateDiff = stateOrder[b.state] - stateOrder[a.state]
      if (stateDiff !== 0) return stateDiff
      return b.turnsPersistent - a.turnsPersistent
    })

    const topFindings = sorted.slice(0, topK)

    const groupMap = new Map<string, DeduplicatedFinding[]>()
    for (const finding of processed) {
      const rootCause = finding.rule.split("/")[1] || finding.rule
      const groupKey = `${rootCause}::${finding.file}`
      if (!groupMap.has(groupKey)) {
        groupMap.set(groupKey, [])
      }
      groupMap.get(groupKey)!.push(finding)
    }

    const groups: FindingGroup[] = []
    for (const [key, groupFindings] of groupMap) {
      const [rootCause, file] = key.split("::")
      groups.push({
        rootCause,
        file,
        count: groupFindings.length,
        findings: groupFindings,
      })
    }

    const feedbackLines: string[] = []
    feedbackLines.push(`Anti-Slop Quality Report (Turn ${turn})`)
    feedbackLines.push(`New: ${newCount} | Persistent: ${persistentCount} | Resolved: ${resolvedCount}`)

    for (const tf of topFindings) {
      const lineStr = tf.line ? ":" + tf.line : ""
      feedbackLines.push("- [" + tf.severity.toUpperCase() + "] " + tf.file + lineStr + " (" + tf.rule + ") [" + tf.state + "]")
      feedbackLines.push(`  Evidence: ${tf.evidence}`)
      feedbackLines.push(`  Fix: ${tf.fix}`)
      if (tf.explanation) {
        feedbackLines.push(`  Note: ${tf.explanation}`)
      }
    }

    const formattedFeedback = feedbackLines.join("\n")

    const result: ActionableFeedbackResult = {
      turn,
      totalFindings: processed.length,
      newCount,
      persistentCount,
      resolvedCount,
      topFindings,
      groups,
      formattedFeedback,
    }
    return result
  }

  reset(): void {
    this.knownFindings.clear()
  }
}

export * as FindingDedup from "./dedup"
