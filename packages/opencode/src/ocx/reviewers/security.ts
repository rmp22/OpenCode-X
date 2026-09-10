
export type ReviewFinding = {
  readonly severity: "blocker" | "advisory"
  readonly category: string
  readonly message: string
  readonly evidence: string
  readonly confidence: "low" | "medium" | "high"
}

export function review(diff: string, criteria: readonly string[]): readonly ReviewFinding[] {
  const findings: ReviewFinding[] = []

  for (const criterion of criteria) {
    if (criterion.includes("security") && (diff.includes("eval(") || diff.includes("innerHTML"))) {
      findings.push({
        severity: "blocker",
        category: "security",
        message: "potential security vulnerability: avoid eval and innerHTML",
        evidence: diff.slice(0, 80),
        confidence: "high",
      })
    }
  }

  return findings
}

