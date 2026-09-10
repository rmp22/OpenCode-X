
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
    if (criterion.includes("testing") && diff.includes("function ")) {
      findings.push({
        severity: "advisory",
        category: "testing",
        message: "verify new function has corresponding test coverage",
        evidence: diff.slice(0, 80),
        confidence: "medium",
      })
    }
  }

  return findings
}

