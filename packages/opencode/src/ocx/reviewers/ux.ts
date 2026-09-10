
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
    if (criterion.includes("ux") && diff.includes("padding")) {
      findings.push({
        severity: "advisory",
        category: "ux",
        message: "verify padding values follow the design system spacing tokens",
        evidence: diff.slice(0, 80),
        confidence: "medium",
      })
    }
  }

  return findings
}

