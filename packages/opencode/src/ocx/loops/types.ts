export type LoopPatternKind =
  | "identical_tool"
  | "read_thrash"
  | "error_cycle"
  | "no_progress_turn"
  | "identical_tool_calls"
  | "repetitive_reads"
  | "consecutive_errors"
  | "reasoning_thrash"

export type EscalationLevel = 0 | 1 | 2 | 3 | 4

export type EscalationAction =
  | { readonly level: 0; readonly kind: "none" }
  | { readonly level: 1; readonly kind: "advisory" | "soft_advisory"; readonly message: string; readonly pattern?: LoopPatternKind }
  | { readonly level: 2; readonly kind: "strict_instruction" | "hard_instruction"; readonly message: string; readonly lockedTools: readonly string[]; readonly pattern?: LoopPatternKind }
  | { readonly level: 3; readonly kind: "strategy_pivot" | "suspension"; readonly message: string; readonly reason?: string; readonly alternativeStrategy?: string; readonly rollbackRequested?: boolean; readonly pattern?: LoopPatternKind }
  | { readonly level: 4; readonly kind: "abort" | "suspension"; readonly message: string; readonly suspensionKind?: "circuit_breaker" | "hitl"; readonly pattern?: LoopPatternKind }

export type LoopBudget = {
  readonly maxAttempts?: number
  readonly maxCost?: number
  readonly maxDurationMs?: number
}

export type LoopBudgetState = {
  readonly attempts: number
  readonly spentCost: number
  readonly startTime: number
  readonly isExhausted: boolean
  readonly exhaustionReason?: string
}

export type RecoverySuggestion = {
  readonly pattern: LoopPatternKind
  readonly strategy: string
  readonly suggestedAction: string
  readonly alternativeTools: readonly string[]
  readonly explanation: string
}

export type LoopEvent = {
  readonly kind: LoopPatternKind
  readonly toolName?: string
  readonly target?: string
  readonly errorCount?: number
  readonly timestamp: number
}

export const DEFAULT_LOOP_THRESHOLDS = {
  maxIdenticalToolCalls: 2,
  maxRepeatReads: 3,
  maxConsecutiveErrors: 3,
  maxNoProgressTurns: 2,
  historyRetentionLimit: 50,
  defaultCommandTimeoutMs: 30000,
  defaultMaxAttempts: 50,
  defaultMaxCost: 10.0,
  defaultMaxDurationMs: 1000 * 60 * 30,
} as const

export * as LoopTypes from "./types"
