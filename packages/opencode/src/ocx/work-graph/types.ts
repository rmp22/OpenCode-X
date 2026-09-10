export const GRAPH_VERSION = 1

export const NODE_STATUSES = [
  "pending",
  "ready",
  "running",
  "waiting_activity",
  "evaluating",
  "completed",
  "blocked",
  "failed",
  "needs_input",
  "superseded",
  "cancelled",
] as const

export type NodeStatus = (typeof NODE_STATUSES)[number]

export const WORK_INTENTS = [
  "answer",
  "explain",
  "explore",
  "research",
  "diagnose",
  "design",
  "decide",
  "plan",
  "create",
  "change",
  "refactor",
  "migrate",
  "review",
  "verify",
  "measure",
  "document",
  "configure",
  "operate",
  "release",
  "recover",
] as const

export type WorkIntent = (typeof WORK_INTENTS)[number]

export const ARTIFACT_KINDS = [
  "source",
  "test",
  "documentation",
  "ui",
  "configuration",
  "schema",
  "data",
  "build",
  "toolchain",
  "dependency",
  "git",
  "environment",
  "infrastructure",
  "release",
  "runtime",
  "external_information",
  "generated_asset",
] as const

export type ArtifactKind = (typeof ARTIFACT_KINDS)[number]

export const CONCERNS = [
  "correctness",
  "maintainability",
  "architecture",
  "security",
  "privacy",
  "performance",
  "reliability",
  "compatibility",
  "accessibility",
  "ux",
  "concurrency",
  "testing",
  "cost",
  "style",
  "compliance",
] as const

export type Concern = (typeof CONCERNS)[number]

export const OPERATION_KINDS = [
  "answer",
  "observe",
  "inspect",
  "search",
  "map_codebase",
  "reproduce",
  "triage",
  "analyze",
  "diagnose",
  "compare",
  "synthesize",
  "decide",
  "plan",
  "design",
  "prototype",
  "create_code",
  "modify_code",
  "create_test",
  "modify_test",
  "create_document",
  "modify_document",
  "modify_config",
  "modify_schema",
  "migrate_data",
  "modify_build",
  "modify_dependency",
  "modify_environment",
  "modify_infrastructure",
  "review_code",
  "review_architecture",
  "review_security",
  "review_accessibility",
  "review_design",
  "review_documentation",
  "run_test",
  "run_lint",
  "run_typecheck",
  "run_build",
  "benchmark",
  "profile",
  "validate_artifact",
  "validate_claims",
  "stage_git",
  "commit_git",
  "sync_git",
  "prepare_release",
  "deploy",
  "canary",
  "observe_release",
  "rollback",
  "report",
  "explain",
  "deliver",
] as const

export type OperationKind = (typeof OPERATION_KINDS)[number]

export const EFFECT_KINDS = [
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

export type EffectKind = (typeof EFFECT_KINDS)[number]

export const EDGE_KINDS = ["requires", "produces_input", "validates", "blocks", "supersedes"] as const
export type EdgeKind = (typeof EDGE_KINDS)[number]

export type GraphStatus = "active" | "waiting" | "satisfied" | "cancelled"
export type ActivityKind = "llm" | "tool" | "owner" | "validator" | "user_input" | "external_service"
export type ActivityStatus = "succeeded" | "failed" | "cancelled" | "needs_input"
export type RiskLevel = "safe" | "low" | "moderate" | "high" | "destructive" | "unknown"
export type ScopeAccess = "read" | "write" | "mixed"
export type NodeCreatedBy = "user" | "recipe" | "planner" | "evaluator" | "recovery"
export type EvidenceBlocking = "node_completion" | "graph_completion" | "release"

export type RiskProfile = {
  readonly level: RiskLevel
  readonly signals: readonly string[]
}

export type ScopeRef = {
  readonly root?: string
  readonly paths: readonly string[]
  readonly access: ScopeAccess
}

export type ArtifactTarget = {
  readonly kind: ArtifactKind
  readonly subject: string
  readonly path?: string
}

export type OwnerRef = {
  readonly id: string
  readonly scope?: string
  readonly expertise?: readonly string[]
}

export type AcceptanceCriterion = {
  readonly id: string
  readonly description: string
  readonly required: boolean
}

export type EffectPolicy = {
  readonly effects: readonly EffectKind[]
  readonly approvals: readonly string[]
}

export type EvidenceRequirement = {
  readonly id: string
  readonly description: string
  readonly predicate: string
  readonly blocking: EvidenceBlocking
  readonly invalidatedBy: readonly string[]
  readonly required: boolean
}

export type ValidationPolicy = {
  readonly validators: readonly string[]
  readonly required: boolean
}

export type RetryPolicy = {
  readonly maxActivities: number
  readonly maxLLMCalls: number
  readonly maxRetries: number
  readonly maxEquivalentFailures: number
  readonly maxReplans: number
}

export type WorkNode = {
  readonly id: string
  readonly intent: readonly WorkIntent[]
  readonly operation: OperationKind
  readonly goal: string
  readonly acceptance: readonly AcceptanceCriterion[]
  readonly artifacts: readonly ArtifactTarget[]
  readonly concerns: readonly Concern[]
  readonly risk: RiskProfile
  readonly scope: ScopeRef
  readonly owner?: OwnerRef
  readonly status: NodeStatus
  readonly revision: number
  readonly dependencies: readonly string[]
  readonly effectPolicy: EffectPolicy
  readonly evidenceRequirements: readonly EvidenceRequirement[]
  readonly validationPolicy: ValidationPolicy
  readonly retryPolicy: RetryPolicy
  readonly createdBy: NodeCreatedBy
  readonly createdIntentRevision: number
  readonly updatedAt: number
}

export type WorkEdge = {
  readonly from: string
  readonly to: string
  readonly kind: EdgeKind
}

export type Graph = {
  readonly version: typeof GRAPH_VERSION
  readonly id: string
  readonly sessionID: string
  readonly repositoryID?: string
  readonly revision: number
  readonly intentRevision: number
  readonly intentKey: string
  readonly nodes: readonly WorkNode[]
  readonly edges: readonly WorkEdge[]
  readonly status: GraphStatus
  readonly createdAt: number
  readonly updatedAt: number
}

export type EvidenceDraft = {
  readonly id: string
  readonly kind: string
  readonly subject: string
  readonly source: string
  readonly contentHash?: string
}

export type ActivityResult = {
  readonly id: string
  readonly nodeID: string
  readonly status: ActivityStatus
  readonly graphRevision: number
  readonly intentRevision: number
  readonly nodeRevision: number
  readonly idempotencyKey?: string
  readonly output?: unknown
  readonly error?: string
  readonly evidence: readonly EvidenceDraft[]
}

export type EventType =
  | "graph_created"
  | "graph_reconciled"
  | "intent_revised"
  | "node_created"
  | "node_status_changed"
  | "activity_result_recorded"
  | "evidence_recorded"
  | "node_completed"
  | "node_blocked"
  | "node_superseded"
  | "node_cancelled"

export type EventPayload =
  | { readonly graph: Graph; readonly reason?: string }
  | { readonly node: WorkNode }
  | { readonly nodeID: string; readonly status: NodeStatus; readonly nodeRevision: number; readonly reason?: string }
  | { readonly result: ActivityResult }
  | { readonly evidence: readonly EvidenceDraft[]; readonly nodeID: string }
  | { readonly intentKey: string; readonly intentRevision: number }

export type Event = {
  readonly eventID: string
  readonly sessionID: string
  readonly graphID: string
  readonly sequence: number
  readonly type: EventType
  readonly graphRevision: number
  readonly intentRevision: number
  readonly nodeID?: string
  readonly nodeRevision?: number
  readonly causationID?: string
  readonly correlationID?: string
  readonly idempotencyKey?: string
  readonly timestamp: number
  readonly payload: EventPayload
}

export type GraphPatch = {
  readonly addNodes: readonly WorkNode[]
  readonly removeNodeIDs: readonly string[]
  readonly supersedeNodeIDs: readonly string[]
  readonly addEdges: readonly WorkEdge[]
  readonly removeEdges: readonly WorkEdge[]
  readonly intentKey: string
  readonly intentRevision: number
  readonly reason: string
}

export * as WorkGraph from "./types"
