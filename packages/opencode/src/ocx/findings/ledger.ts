import {
  type Finding,
  type DeltaSavingsMetric,
  type FindingLifecycleState,
  type FileFindingTrend,
  computeFindingFingerprint,
} from "./types"

export class FindingLedger {
  private readonly findings = new Map<string, Finding>()
  private readonly resolvedFindings = new Map<string, Finding>()
  private readonly injectedFingerprints = new Set<string>()
  private readonly fileTrends = new Map<string, FileFindingTrend>()

  record(input: Omit<Finding, "fingerprint"> & { readonly fingerprint?: string }): {
    readonly isNew: boolean
    readonly isChanged: boolean
    readonly finding: Finding
  } {
    const fingerprint =
      input.fingerprint ??
      computeFindingFingerprint({
        detector: input.detector,
        code: input.code,
        target: input.target,
        message: input.message,
      })

    const existing = this.findings.get(fingerprint)
    const wasResolved = this.resolvedFindings.has(fingerprint)
    const isNew = existing === undefined && !wasResolved
    const isChanged = existing !== undefined && existing.message !== input.message

    let lifecycleState: FindingLifecycleState = "OPEN"
    let turnsSeen = 1

    if (wasResolved) {
      lifecycleState = "RECURRED"
      this.resolvedFindings.delete(fingerprint)
    } else if (existing) {
      lifecycleState = existing.lifecycleState ?? "OPEN"
      turnsSeen = (existing.turnsSeen ?? 1) + 1
    }

    const finding: Finding = {
      ...input,
      fingerprint,
      lifecycleState,
      turnsSeen,
    }

    this.findings.set(fingerprint, finding)
    if (isChanged) {
      this.injectedFingerprints.delete(fingerprint)
    }

    const result = {
      isNew,
      isChanged,
      finding,
    }
    return result
  }

  transitionState(fingerprint: string, nextState: FindingLifecycleState): void {
    const existing = this.findings.get(fingerprint)
    if (existing) {
      if (nextState === "RESOLVED") {
        this.resolveFinding(fingerprint)
        return
      }
      const updated: Finding = {
        ...existing,
        lifecycleState: nextState,
      }
      this.findings.set(fingerprint, updated)
    }
  }

  getActiveFindings(): readonly Finding[] {
    return Array.from(this.findings.values())
  }

  getResolvedFindings(): readonly Finding[] {
    return Array.from(this.resolvedFindings.values())
  }

  getUninjectedDelta(): readonly Finding[] {
    const delta: Finding[] = []
    for (const [fp, finding] of this.findings.entries()) {
      if (!this.injectedFingerprints.has(fp)) {
        delta.push(finding)
      }
    }
    return delta
  }

  markInjected(fingerprints?: readonly string[]): void {
    if (fingerprints) {
      for (const fp of fingerprints) {
        this.injectedFingerprints.add(fp)
      }
    } else {
      for (const fp of this.findings.keys()) {
        this.injectedFingerprints.add(fp)
      }
    }
  }

  resolveFinding(fingerprint: string): void {
    const existing = this.findings.get(fingerprint)
    if (existing) {
      const resolved: Finding = {
        ...existing,
        lifecycleState: "RESOLVED",
      }
      this.resolvedFindings.set(fingerprint, resolved)
    }
    this.findings.delete(fingerprint)
    this.injectedFingerprints.delete(fingerprint)
  }

  suppressContradictedFindings(steeringPrompt: string): readonly Finding[] {
    const lower = steeringPrompt.toLowerCase()
    const suppressed: Finding[] = []
    for (const [fp, finding] of this.findings.entries()) {
      const matchTarget = lower.includes(finding.target.toLowerCase())
      const matchCode = lower.includes(finding.code.toLowerCase())
      const matchRule = lower.includes(finding.detector.toLowerCase())
      const explicitOverride =
        lower.includes("allow") ||
        lower.includes("ignore") ||
        lower.includes("keep") ||
        lower.includes("skip")
      if ((matchTarget || matchCode || matchRule) && explicitOverride) {
        const updated: Finding = {
          ...finding,
          lifecycleState: "SUPPRESSED",
          remediation: `Suppressed by user steering: ${steeringPrompt}`,
        }
        this.resolvedFindings.set(fp, updated)
        this.findings.delete(fp)
        this.injectedFingerprints.delete(fp)
        suppressed.push(updated)
      }
    }
    return suppressed
  }

  recordTurnFileCounts(file: string, count: number, rules: readonly string[]): FileFindingTrend {
    const existing = this.fileTrends.get(file)
    const history = existing ? [...existing.history, count] : [count]

    let consecutiveIncreases = 0
    for (let i = history.length - 1; i > 0; i--) {
      if (history[i] > history[i - 1]) {
        consecutiveIncreases++
      } else {
        break
      }
    }

    const isOscillating = consecutiveIncreases >= 2
    const trend: FileFindingTrend = {
      file,
      history,
      consecutiveIncreases,
      isOscillating,
      oscillatingRules: isOscillating ? rules : [],
    }

    this.fileTrends.set(file, trend)
    return trend
  }

  checkOscillation(file: string): FileFindingTrend | undefined {
    const trend = this.fileTrends.get(file)
    return trend
  }

  shouldHaltRepair(file: string): boolean {
    const trend = this.fileTrends.get(file)
    const shouldHalt = trend ? trend.isOscillating : false
    return shouldHalt
  }

  getOscillationReport(file: string): string | undefined {
    const trend = this.fileTrends.get(file)
    if (!trend || !trend.isOscillating) return undefined
    const report = `Oscillation detected in ${file}: finding count increased consecutively (${trend.history.join(" -> ")}). Rules involved: ${trend.oscillatingRules.join(", ")}. Halting automatic repair.`
    return report
  }

  clear(): void {
    this.findings.clear()
    this.resolvedFindings.clear()
    this.injectedFingerprints.clear()
    this.fileTrends.clear()
  }

  calculateDeltaSavings(): DeltaSavingsMetric {
    const all = Array.from(this.findings.values())
    const delta = this.getUninjectedDelta()

    const allChars = all.reduce((sum, f) => sum + (f.message.length + f.detector.length + f.target.length + 30), 0)
    const deltaChars = delta.reduce((sum, f) => sum + (f.message.length + f.detector.length + f.target.length + 30), 0)

    const totalTokensEstimated = Math.max(0, Math.round(allChars / 4))
    const deltaTokensEstimated = Math.max(0, Math.round(deltaChars / 4))
    const tokensSaved = Math.max(0, totalTokensEstimated - deltaTokensEstimated)
    const savingsPercent = totalTokensEstimated === 0 ? 0 : Math.round((tokensSaved / totalTokensEstimated) * 100)

    const metric: DeltaSavingsMetric = {
      totalTokensEstimated,
      deltaTokensEstimated,
      tokensSaved,
      savingsPercent,
    }
    return metric
  }

  renderDeltaPrompt(): string {
    const delta = this.getUninjectedDelta()
    if (delta.length === 0) return ""

    const lines: string[] = []
    lines.push("=== ACTIONABLE FINDINGS (DELTA ONLY) ===")
    for (const f of delta) {
      const prefix = f.enforcement === "blocking" ? "[BLOCKING]" : "[ADVISORY]"
      lines.push(prefix + " " + f.detector + " (" + f.code + ") on " + f.target + ": " + f.message)
      if (f.remediation) {
        lines.push("  Remediation: " + f.remediation)
      }
    }
    this.markInjected(delta.map((f) => f.fingerprint))
    return lines.join("\n")
  }
}

export const defaultFindingLedger = new FindingLedger()

export * as FindingLedgerModule from "./ledger"
