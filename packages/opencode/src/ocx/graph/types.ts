export type NodeId = string

export type GraphNode = {
  readonly id: NodeId
  readonly label: string
  readonly kind: "initial" | "intermediate" | "terminal"
  readonly maxRetries?: number
  readonly allowedTools?: readonly string[]
  readonly deniedTools?: readonly string[]
  readonly permissions?: readonly string[]
  readonly requiredEvidence?: readonly string[]
  readonly tokenBudget?: number
  readonly budgetConstraints?: {
    readonly maxTokens?: number
    readonly maxCost?: number
    readonly maxDurationMs?: number
  }
  readonly metadata?: Record<string, unknown>
}

export type GraphEdge = {
  readonly id?: string
  readonly from: NodeId
  readonly to: NodeId
  readonly label?: string
  readonly condition?: string
  readonly evaluateCondition?: (context: Record<string, unknown>) => boolean
  readonly isRetry?: boolean
  readonly weight?: number
}

export type ExecutionGraph = {
  readonly id: string
  readonly pipelineId: string
  readonly nodes: readonly GraphNode[]
  readonly edges: readonly GraphEdge[]
  readonly initialNodeId: NodeId
  readonly terminalNodeIds: readonly NodeId[]
}

export type EvidenceRecord = {
  readonly id: string
  readonly nodeId: NodeId
  readonly kind: string
  readonly detail: string
  readonly timestamp: number
}

export type SuspensionKind =
  | "user_input"
  | "permission"
  | "rate_limit"
  | "circuit_breaker"
  | "review"
  | "approval"
  | "verification_failure"
  | "external_input"

export type SuspensionReason = {
  readonly kind: SuspensionKind
  readonly detail: string
  readonly timestamp: number
  readonly metadata?: Record<string, unknown>
}

export type GraphCheckpoint = {
  readonly checkpointId: string
  readonly graphId: string
  readonly sessionID: string
  readonly currentNode: NodeId
  readonly visitedNodes: readonly NodeId[]
  readonly nodeOutputs: Record<NodeId, unknown>
  readonly accumulatedEvidence: readonly EvidenceRecord[]
  readonly budgetRemaining: number
  readonly timestamp: number
}

export type TransitionResult =
  | { readonly status: "advanced"; readonly fromNode: string; readonly toNode: string; readonly checkpoint: GraphCheckpoint }
  | { readonly status: "suspended"; readonly node: string; readonly reason: SuspensionReason }
  | { readonly status: "completed"; readonly terminalNode: string; readonly evidence: readonly EvidenceRecord[] }
  | { readonly status: "rejected"; readonly fromNode: string; readonly attemptedNode: string; readonly reason: string }
  | { readonly status: "resumed"; readonly node: string; readonly checkpoint: GraphCheckpoint }
  | { readonly status: "rolled_back"; readonly targetNode: string; readonly checkpoint: GraphCheckpoint }

export * as GraphTypes from "./types"
