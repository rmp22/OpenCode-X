
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
    if (criterion.includes("correctness") && diff.includes("return")) {
      findings.push({
        severity: "advisory",
        category: "correctness",
        message: "verify return value matches expected behavior",
        evidence: diff.slice(0, 80),
        confidence: "medium",
      })
    }
  }

  return findings
}

