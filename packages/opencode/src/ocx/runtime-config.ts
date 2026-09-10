export interface RuntimeBudgets {
  maxTurnTokens: number
  maxSessionTokens: number
  maxContextWindowTokens: number
  maxToolLoopIterations: number
  maxSubagentRecursionDepth: number
  ssePingIntervalMs: number
  networkTimeoutMs: number
  cancellationGracePeriodMs: number
  retryMaxAttempts: number
  retryInitialDelayMs: number
  retryBackoffFactor: number
  retryMaxDelayMs: number
  attentionMaxSegments: number
  attentionWorkingSetTokens: number
  antislopMaxDuplicateLines: number
  antislopMaxFileLengthLines: number
  antislopMaxCommentsPerFunction: number
}

export const DEFAULT_RUNTIME_BUDGETS: RuntimeBudgets = {
  maxTurnTokens: 128_000,
  maxSessionTokens: 1_000_000,
  maxContextWindowTokens: 200_000,
  maxToolLoopIterations: 30,
  maxSubagentRecursionDepth: 3,
  ssePingIntervalMs: 15_000,
  networkTimeoutMs: 120_000,
  cancellationGracePeriodMs: 2_000,
  retryMaxAttempts: 3,
  retryInitialDelayMs: 2_000,
  retryBackoffFactor: 2,
  retryMaxDelayMs: 30_000,
  attentionMaxSegments: 32,
  attentionWorkingSetTokens: 16_000,
  antislopMaxDuplicateLines: 5,
  antislopMaxFileLengthLines: 2_000,
  antislopMaxCommentsPerFunction: 0,
}

let activeBudgets: RuntimeBudgets = { ...DEFAULT_RUNTIME_BUDGETS }

export function getRuntimeBudgets(): RuntimeBudgets {
  return { ...activeBudgets }
}

export function updateRuntimeBudgets(overrides: Partial<RuntimeBudgets>): RuntimeBudgets {
  activeBudgets = {
    ...activeBudgets,
    ...overrides,
  }
  return { ...activeBudgets }
}

export function resetRuntimeBudgets(): void {
  activeBudgets = { ...DEFAULT_RUNTIME_BUDGETS }
}

export * as RuntimeConfig from "./runtime-config"
