export type ReviewCostInput = {
  readonly changedFiles?: readonly string[]
  readonly changedFileCount?: number
  readonly addedLines?: number
  readonly removedLines?: number
  readonly diffLines?: number
  readonly newFiles?: number
  readonly newAbstractions?: number
  readonly abstractions?: number
  readonly newDependencies?: number
  readonly dependencies?: number
  readonly changedResponsibilities?: number
  readonly responsibilities?: number
  readonly unrelatedRenames?: number
  readonly verificationGaps?: number
  readonly verificationGap?: number
  readonly contextFiles?: number
  readonly selfReview?: boolean
  readonly selfReviewed?: boolean
}

export type ReviewCostEstimate = {
  readonly score: number
  readonly level: "low" | "medium" | "high"
  readonly changedFiles: number
  readonly diffLines: number
  readonly signals: readonly string[]
  readonly recommendations: readonly string[]
}

export type ReviewCostFinding = {
  readonly id: "RC-review-cost" | "RC-self-review"
  readonly severity: "warning"
  readonly message: string
  readonly span?: string
}

export function fromDiff(input: {
  readonly changedPaths: readonly string[]
  readonly addedLines: number
  readonly removedLines?: number
}): ReviewCostInput {
  return {
    changedFiles: input.changedPaths,
    addedLines: input.addedLines,
    ...(input.removedLines !== undefined ? { removedLines: input.removedLines } : {}),
  }
}

export function estimate(input: ReviewCostInput): ReviewCostEstimate {
  const changedFiles = input.changedFiles?.length ?? nonNegative(input.changedFileCount)
  const diffLines = input.diffLines ?? nonNegative(input.addedLines) + nonNegative(input.removedLines)
  const newFiles = nonNegative(input.newFiles)
  const abstractions = input.newAbstractions ?? input.abstractions ?? 0
  const dependencies = input.newDependencies ?? input.dependencies ?? 0
  const responsibilities = input.changedResponsibilities ?? input.responsibilities ?? 0
  const verificationGaps = input.verificationGaps ?? input.verificationGap ?? 0
  const signals: string[] = []
  const recommendations: string[] = []
  let score = 0

  if (diffLines > 400) {
    score += 2
    signals.push(`diff has ${diffLines} lines`)
    recommendations.push("split unrelated work or explain the complete change boundary")
  }
  if (diffLines > 1_000) {
    score += 3
    signals.push("diff exceeds the large-change threshold")
  }
  if (changedFiles > 6) {
    score += 2
    signals.push(`${changedFiles} files changed`)
    recommendations.push("review the file list by responsibility and remove unrelated churn")
  }
  if (changedFiles > 12) {
    score += 3
    signals.push("many files increase reviewer context cost")
  }
  if (newFiles > 0) {
    score += newFiles > 6 ? 3 : 1
    signals.push(`${newFiles} new files`)
    recommendations.push("confirm each new file has one owner and one current caller")
  }
  if (abstractions > 1) {
    score += 2
    signals.push(`${abstractions} new abstractions`)
    recommendations.push("justify each boundary and remove one-use wrappers")
  }
  if (abstractions > 4) score += 2
  if (dependencies > 0) {
    score += 2
    signals.push(`${dependencies} new dependencies`)
    recommendations.push("verify package existence, version, license, and repository alternatives")
  }
  if (responsibilities > 1) {
    score += 2
    signals.push(`${responsibilities} responsibilities changed`)
    recommendations.push("split the change by ownership or document the intentional cross-cutting boundary")
  }
  if (input.unrelatedRenames && input.unrelatedRenames > 0) {
    score += 3
    signals.push(`${input.unrelatedRenames} unrelated renames`)
    recommendations.push("restore unrelated names")
  }
  if (verificationGaps > 0) {
    score += 3
    signals.push(`${verificationGaps} verification gaps`)
    recommendations.push("run the smallest relevant checks and record unknowns honestly")
  }
  if (input.contextFiles && input.contextFiles > 8) {
    score += 1
    signals.push(`${input.contextFiles} context files require review`)
  }
  if (input.selfReview === false || input.selfReviewed === false) {
    score += 2
    signals.push("self-review is not recorded")
    recommendations.push("read the final diff as a reviewer before handoff")
  }

  return {
    score,
    level: score >= 7 ? "high" : score >= 3 ? "medium" : "low",
    changedFiles,
    diffLines,
    signals,
    recommendations: [...new Set(recommendations)],
  }
}

export function findings(input: ReviewCostInput): readonly ReviewCostFinding[] {
  const result = estimate(input)
  const out: ReviewCostFinding[] = []
  if (result.level === "high")
    out.push({
      id: "RC-review-cost",
      severity: "warning",
      message: `review cost is high (score ${result.score}): ${result.signals.join("; ")}. ${result.recommendations.join("; ")}`,
      span: `${result.changedFiles} files, ${result.diffLines} diff lines`,
    })
  if (input.selfReview === false || input.selfReviewed === false)
    out.push({
      id: "RC-self-review",
      severity: "warning",
      message: "the change has no recorded self-review; inspect the final diff before handoff",
    })
  return out
}

function nonNegative(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

export * as ReviewCostGate from "./review-cost"
