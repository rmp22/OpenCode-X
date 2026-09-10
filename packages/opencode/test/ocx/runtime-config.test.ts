import { describe, expect, test, beforeEach } from "bun:test"
import {
  DEFAULT_RUNTIME_BUDGETS,
  getRuntimeBudgets,
  updateRuntimeBudgets,
  resetRuntimeBudgets,
} from "@/ocx/runtime-config"

describe("RuntimeConfig", () => {
  beforeEach(() => {
    resetRuntimeBudgets()
  })

  test("loads default runtime budgets correctly", () => {
    const budgets = getRuntimeBudgets()
    expect(budgets.maxTurnTokens).toBe(128_000)
    expect(budgets.maxToolLoopIterations).toBe(30)
    expect(budgets.retryMaxAttempts).toBe(3)
    expect(budgets.cancellationGracePeriodMs).toBe(2000)
  })

  test("updates budgets with partial overrides", () => {
    updateRuntimeBudgets({
      maxTurnTokens: 64_000,
      retryMaxAttempts: 5,
    })

    const updated = getRuntimeBudgets()
    expect(updated.maxTurnTokens).toBe(64_000)
    expect(updated.retryMaxAttempts).toBe(5)
    expect(updated.maxToolLoopIterations).toBe(DEFAULT_RUNTIME_BUDGETS.maxToolLoopIterations)
  })

  test("resets budgets to defaults", () => {
    updateRuntimeBudgets({ maxTurnTokens: 10_000 })
    resetRuntimeBudgets()
    expect(getRuntimeBudgets().maxTurnTokens).toBe(DEFAULT_RUNTIME_BUDGETS.maxTurnTokens)
  })
})
