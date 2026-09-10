import type { ScopeFinding, PreservationReason, ScopeLevel } from "./types"

export type ReviewInput = {
  readonly findings: readonly ScopeFinding[]
  readonly scopeLevel: ScopeLevel
  readonly rootCauseFixed: boolean
  readonly equivalentPathsChecked: boolean
  readonly edgeCasesChecked: boolean
  readonly consistencyChecked: boolean
  readonly architectureChecked: boolean
  readonly qualityBarMet: boolean
  readonly unrelatedChangesMade: boolean
}

export type ReviewResult = {
  readonly complete: boolean
  readonly missingFindings: readonly ScopeFinding[]
  readonly invalidPreservations: readonly string[]
  readonly completionBlocked: boolean
  readonly blockers: readonly string[]
}

const VALID_PRESERVATION_REASONS: readonly PreservationReason[] = [
  "unrelated_to_user_request",
  "no_evidence_it_is_defective",
  "public_behavior_intentionally_preserved",
  "requires_separate_product_decision",
  "unsafe_without_missing_information",
  "protected_user_work_outside_required_scope",
]

const INVALID_PRESERVATION_REASONS: readonly PreservationReason[] = [
  "diff_size",
  "would_touch_another_file",
  "not_minimal_anymore",
]

function isValidPreservation(reason: string): boolean {
  return VALID_PRESERVATION_REASONS.includes(reason as PreservationReason)
}

function isInvalidPreservation(reason: string): boolean {
  return INVALID_PRESERVATION_REASONS.includes(reason as PreservationReason)
}

export function reviewSufficiency(input: ReviewInput): ReviewResult {
  const missingFindings: ScopeFinding[] = []
  const invalidPreservations: string[] = []
  const blockers: string[] = []

  for (const finding of input.findings) {
    if (finding.status === "fixed") continue
    if (finding.status === "not_relevant") continue
    if (finding.status === "intentionally_preserved") {
      if (finding.preservationReason && isInvalidPreservation(finding.preservationReason)) {
        invalidPreservations.push(
          `Finding "${finding.id}" preserved for invalid reason: ${finding.preservationReason}`,
        )
      }
      continue
    }
    if (finding.status === "blocked") {
      blockers.push(`Finding "${finding.id}" is blocked: ${finding.description}`)
      continue
    }
    missingFindings.push(finding)
  }

  if (!input.rootCauseFixed) {
    blockers.push("Root cause is not fixed")
  }

  if (!input.equivalentPathsChecked) {
    blockers.push("Equivalent code paths have not been checked for consistency")
  }

  if (input.unrelatedChangesMade) {
    blockers.push("Unrelated changes were made")
  }

  if (!input.qualityBarMet) {
    blockers.push("Quality bar from user request is not met")
  }

  const complete =
    missingFindings.length === 0 &&
    invalidPreservations.length === 0 &&
    blockers.length === 0 &&
    input.rootCauseFixed

  return {
    complete,
    missingFindings,
    invalidPreservations,
    completionBlocked: blockers.length > 0,
    blockers,
  }
}

export * as SufficiencyReviewer from "./sufficiency-review"
