export type VerificationSlopFinding = {
  readonly rule: string
  readonly severity: "warning" | "blocker"
  readonly evidence: string
  readonly fix: string
}

const COMPLETION_CLAIMS = [
  /\bfixed\b/i,
  /\bworks\b/i,
  /\bfully implemented\b/i,
  /\bproduction.ready\b/i,
  /\bcomplete\b/i,
  /\bdone\b/i,
  /\ball good\b/i,
  /\bzero bugs\b/i,
  /\bcannot fail\b/i,
]

const VERIFICATION_MARKERS = [
  /\btest(?:s)?\s+(?:pass|run|green|succeed)/i,
  /\btypecheck(?:ed)?\s+(?:pass|succeed)/i,
  /\blint(?:ed)?\s+(?:pass|succeed)/i,
  /\bbuild(?:ed)?\s+(?:pass|succeed)/i,
  /\bcov(erage)?\s+(?:pass|succeed)/i,
]

export function scanVerification(content: string, filePath: string): readonly VerificationSlopFinding[] {
  const findings: VerificationSlopFinding[] = []
  const lines = content.split("\n")

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    for (const claim of COMPLETION_CLAIMS) {
      if (claim.test(trimmed)) {
        const hasEvidence = VERIFICATION_MARKERS.some((m) => m.test(trimmed) || m.test(content))
        if (!hasEvidence) {
          findings.push({
            rule: "V-unverified-claim",
            severity: "blocker",
            evidence: `"${trimmed.slice(0, 80)}" at line ${i + 1} claims completion without verification evidence`,
            fix: "provide the command output or test result that proves the claim",
          })
        }
        break
      }
    }
  }

  return findings
}

export * as VerificationSlop from "./verification"