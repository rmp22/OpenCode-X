export type TrajectoryEventType =
  | "turn_start"
  | "tool_call"
  | "tool_result"
  | "claim_evaluated"
  | "mutation_applied"
  | "plan_updated"
  | "hitl_prompt"
  | "turn_end"

export interface TrajectoryEvent {
  id: string
  sessionId: string
  type: TrajectoryEventType
  timestamp: number
  payload: Record<string, unknown>
}

export interface SessionMetrics {
  sessionId: string
  totalTurns: number
  toolInvocations: number
  failedToolCalls: number
  mutationsApplied: number
  totalDurationMs: number
  claimsVerified: number
  claimsFalsified: number
}
