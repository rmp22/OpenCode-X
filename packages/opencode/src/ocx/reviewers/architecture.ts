
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
    if (criterion.includes("architecture") && diff.includes("class ")) {
      findings.push({
        severity: "advisory",
        category: "architecture",
        message: "verify new class follows existing architecture patterns",
        evidence: diff.slice(0, 80),
        confidence: "medium",
      })
    }
  }

  return findings
}

