export const CAPABILITIES = [
  "search.text",
  "search.files",
  "search.symbol",
  "search.references",
  "search.structure",
  "file.read",
  "file.write",
  "file.edit",
  "file.patch",
  "edit.structure",
  "workflow.intake",
  "workflow.plan",
  "workflow.structure",
  "workflow.progress",
  "workflow.status",
  "workflow.todo",
  "design.direction",
  "guidance.read",
  "verification.run",
  "network.read",
  "command.run",
  "git.status",
  "git.diff",
  "git.operation",
  "build.execute",
  "agent.delegate",
  "user.question",
] as const

export type Capability = (typeof CAPABILITIES)[number]

export const EFFECTS = [
  "NONE",
  "FILESYSTEM_READ",
  "FILESYSTEM_WRITE",
  "REPOSITORY_MUTATION",
  "PROCESS_EXECUTION",
  "NETWORK_READ",
  "NETWORK_WRITE",
  "BUILD_MUTATION",
  "PACKAGE_INSTALL",
  "read_file",
  "search_repo",
  "search_web",
  "delegate",
  "mutate_source",
  "mutate_test",
  "mutate_document",
  "mutate_config",
  "mutate_schema",
  "mutate_data",
  "mutate_build",
  "mutate_dependency",
  "mutate_environment",
  "mutate_infrastructure",
  "run_lint",
  "run_typecheck",
  "run_test",
  "run_build",
  "run_benchmark",
  "git_stage",
  "git_commit",
  "git_sync",
  "deploy",
  "rollback",
] as const

export type Effect = (typeof EFFECTS)[number]

export const AVAILABILITY_STATES = [
  "ACTIVE",
  "GATED_BY_WORKFLOW",
  "DISABLED_BY_USER",
  "PERMISSION_REQUIRED",
  "BACKEND_UNAVAILABLE",
  "UNSUPPORTED",
] as const

export type AvailabilityState = (typeof AVAILABILITY_STATES)[number]

export const FAILURE_CODES = [
  "TOOL_GATED_BY_WORKFLOW",
  "CAPABILITY_GATED_BY_WORKFLOW",
  "WORKFLOW_PHASE_MISMATCH",
  "MUTATION_BLOCKED",
  "WORKFLOW_BYPASS_BLOCKED",
  "REPEATED_GATED_TOOL_CALL",
  "TOOLSET_STALE",
  "UNKNOWN_TOOL",
  "UNSUPPORTED_CAPABILITY",
  "PERMISSION_REQUIRED",
  "BACKEND_UNAVAILABLE",
  "TOOL_DISABLED_BY_USER",
  "OUTSIDE_USER_SCOPE",
  "PROTECTED_TARGET",
  "DESTRUCTIVE_ACTION",
  "MISSING_REQUIRED_APPROVAL",
  "UNAVAILABLE_TOOL",
  "UNSATISFIED_HARD_DEPENDENCY",
  "SECURITY_POLICY",
  "UNKNOWN_DANGEROUS_EFFECT",
] as const

export type FailureCode = (typeof FAILURE_CODES)[number]

export type WorkflowPhase = {
  readonly id: string
  readonly goal?: string
  readonly gate?: string
}

export type WorkflowContext = {
  readonly workflow: string
  readonly phase: string
  readonly phases: readonly WorkflowPhase[]
  readonly variant?: WorkflowVariant
  readonly objective?: string
  readonly status?: WorkflowStatus
  readonly revision?: number
  readonly intentRevision?: number
  readonly epoch: string
  readonly toolsetVersion: number
}

export const HARD_GATE_CODES = [
  "OUTSIDE_USER_SCOPE",
  "PROTECTED_TARGET",
  "DESTRUCTIVE_ACTION",
  "MISSING_REQUIRED_APPROVAL",
  "UNAVAILABLE_TOOL",
  "UNSATISFIED_HARD_DEPENDENCY",
  "SECURITY_POLICY",
  "UNKNOWN_DANGEROUS_EFFECT",
] as const

export type HardGateCode = (typeof HARD_GATE_CODES)[number]
export type TransitionReason =
  | "goal_satisfied"
  | "evidence_ready"
  | "user_redirect"
  | "operation_requires_related_phase"
  | "validation_failed"
  | "validation_passed"
  | "risk_escalated"
  | "scope_changed"
  | "work_complete"

export type WorkflowTransition = {
  readonly workflow?: string
  readonly variant?: WorkflowVariant
  readonly phase?: string
  readonly reason: TransitionReason
}

export type WorkflowDecision = {
  readonly outcome:
    | "ALLOW"
    | "ALLOW_AND_TRANSITION"
    | "ALLOW_WITH_WARNING"
    | "REPLAN_REQUIRED"
    | "NEEDS_APPROVAL"
    | "BLOCK"
  readonly allowed: boolean
  readonly operation?: Operation
  readonly transition?: WorkflowTransition
  readonly warning?: string
  readonly code?: HardGateCode
  readonly reason: string
}

export type ToolResolution = {
  readonly inputName: string
  readonly canonicalName: string
  readonly capability: Capability
}

export type AvailabilityOptions = {
  readonly disabled?: boolean
  readonly permission?: "allow" | "ask" | "deny"
  readonly backendAvailable?: boolean
  readonly supported?: boolean
}

export type Availability = {
  readonly capability: string
  readonly state: AvailabilityState
  readonly reason: string
  readonly workflow?: string
  readonly phase?: string
}

export type WorkflowFailure = {
  readonly code: FailureCode
  readonly tool?: string
  readonly capability?: string
  readonly phase?: string
  readonly reason: string
  readonly recovery: readonly string[]
  readonly effects?: readonly Effect[]
  readonly target?: string
}

export type ToolDecision = {
  readonly allowed: boolean
  readonly known: boolean
  readonly resolution?: ToolResolution
  readonly availability: Availability
  readonly failure?: WorkflowFailure
  readonly stale?: boolean
}

export type EffectDecision = {
  readonly allowed: boolean
  readonly availability: Availability
  readonly failure?: WorkflowFailure
  readonly stale?: boolean
}

export type AttemptResult = {
  readonly repeated: boolean
  readonly attempts: number
}

export * as WorkflowGateTypes from "./types"
import type { Operation, WorkflowStatus, WorkflowVariant } from "../workflow"
