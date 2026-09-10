export type BaseEvent = {
  readonly id?: string
  readonly sessionID?: string
  readonly sequence?: number
  readonly idempotencyKey?: string
  readonly payload?: unknown
  readonly metadata?: Record<string, unknown>
}

export type GraphEvent =
  | (BaseEvent & { readonly type: "node_entered"; readonly nodeId: string; readonly timestamp: number })
  | (BaseEvent & { readonly type: "node_exited"; readonly nodeId: string; readonly output?: unknown; readonly timestamp: number })
  | (BaseEvent & { readonly type: "tool_executed"; readonly toolName: string; readonly argsHash: string; readonly exitCode: number; readonly timestamp: number })
  | (BaseEvent & { readonly type: "evidence_collected"; readonly evidenceId: string; readonly kind: string; readonly detail?: string; readonly timestamp: number })
  | (BaseEvent & { readonly type: "claim_asserted"; readonly claimId: string; readonly assertion: string; readonly nodeId: string; readonly timestamp: number })
  | (BaseEvent & { readonly type: "claim_verified"; readonly claimId: string; readonly evidenceIds: readonly string[]; readonly timestamp: number })
  | (BaseEvent & { readonly type: "suspended"; readonly kind: string; readonly reason: string; readonly timestamp: number })
  | (BaseEvent & { readonly type: "resumed"; readonly suspensionId: string; readonly timestamp: number })
  | (BaseEvent & { readonly type: string; readonly timestamp: number; readonly [key: string]: unknown })

export type OCXEvent = GraphEvent

export type EventFilter = {
  readonly sessionID?: string
  readonly type?: string
  readonly nodeId?: string
  readonly fromTimestamp?: number
  readonly fromSequence?: number
}

export type JournalCompactionResult = {
  readonly sessionID: string
  readonly compactedBeforeSequence: number
  readonly remainingEventsCount: number
}

export type ReconstructedGraphState = {
  readonly currentNode: string
  readonly visitedNodes: readonly string[]
  readonly accumulatedEvidence: readonly { readonly id: string; readonly kind: string; readonly detail?: string }[]
  readonly verifiedClaims: readonly string[]
  readonly isSuspended: boolean
  readonly activeSuspensionReason?: string
}

export * as EventTypes from "./types"
