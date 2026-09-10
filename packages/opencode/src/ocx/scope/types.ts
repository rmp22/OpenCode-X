export type ScopeLevel =
  | "local"
  | "component"
  | "feature"
  | "subsystem"
  | "structural"

export type ScopeDimension = "depth" | "width" | "coupling" | "risk" | "request_breadth"

export const SCOPE_DIMENSIONS: readonly ScopeDimension[] = [
  "depth",
  "width",
  "coupling",
  "risk",
  "request_breadth",
]

export const SCOPE_LEVELS: readonly ScopeLevel[] = [
  "local",
  "component",
  "feature",
  "subsystem",
  "structural",
]

export type DimensionScore = {
  readonly dimension: ScopeDimension
  readonly value: number
  readonly min: number
  readonly max: number
  readonly rationale: string
}

export type ScopeEvaluation = {
  readonly depth: number
  readonly width: number
  readonly coupling: number
  readonly risk: number
  readonly requestBreadth: number
  readonly confidence: number
  readonly dimensions: readonly DimensionScore[]
}

export type TaskKind =
  | "bug_fix"
  | "cleanup"
  | "hardening"
  | "feature"
  | "refactor"
  | "architecture"
  | "exploration"
  | "ai_slop_removal"
  | "production_readiness"
  | "edge_case_review"

export type RequestIntent = {
  readonly taskKind: TaskKind[]
  readonly explicitScope: string | undefined
  readonly qualityBar: "minimal" | "standard" | "comprehensive" | "production"
  readonly minimalPatchRequested: boolean
  readonly preserveUnrelatedWip: boolean
  readonly broadCleanupRequested: boolean
  readonly hardeningRequested: boolean
  readonly productionReadinessRequested: boolean
  readonly edgeCaseReviewRequested: boolean
  readonly architectureRequested: boolean
}

export type ScopeBoundary = {
  readonly primary: readonly string[]
  readonly allowedIfRequired: readonly string[]
  readonly protected: readonly string[]
}

export type ScopeFinding = {
  readonly id: string
  readonly status: "fixed" | "not_relevant" | "intentionally_preserved" | "blocked"
  readonly description: string
  readonly reason: string
  readonly preservationReason?: string
}

export type PreservationReason =
  | "unrelated_to_user_request"
  | "no_evidence_it_is_defective"
  | "public_behavior_intentionally_preserved"
  | "requires_separate_product_decision"
  | "unsafe_without_missing_information"
  | "protected_user_work_outside_required_scope"
  | "diff_size"
  | "would_touch_another_file"
  | "not_minimal_anymore"

export type ReevaluationEvent = {
  readonly oldScope: ScopeLevel
  readonly newScope: ScopeLevel
  readonly evidence: readonly string[]
  readonly reason: string
}

export type ScopeTelemetry = {
  readonly sessionId: string
  readonly initialScope: ScopeLevel
  readonly finalScope: ScopeLevel
  readonly scopeChanges: readonly ReevaluationEvent[]
  readonly filesInspected: readonly string[]
  readonly filesChanged: readonly string[]
  readonly findingsAtCompletion: readonly ScopeFinding[]
  readonly reviewerVerdict: "under_scoped" | "over_scoped" | "appropriate" | "unknown"
}

export type ScopeState = {
  readonly intent: RequestIntent
  readonly evaluation: ScopeEvaluation
  readonly provisionalLevel: ScopeLevel
  readonly boundary: ScopeBoundary
  readonly findings: readonly ScopeFinding[]
  readonly reevaluations: readonly ReevaluationEvent[]
  readonly telemetry: ScopeTelemetry
}

export * as Types from "./types"
