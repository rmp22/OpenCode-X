import { describe, expect, test } from "bun:test"
import { BudgetEnforcer } from "@/ocx/governance"

describe("Budget Enforcer Governance", () => {
  test("initializes with default budget configuration and empty state", () => {
    const enforcer = new BudgetEnforcer()
    const config = enforcer.getConfig()
    expect(config.maxSessionTokens).toBe(100000)
    expect(config.warningThresholdRatio).toBe(0.8)

    const state = enforcer.getState()
    expect(state.sessionTokensUsed).toBe(0)
    expect(state.status).toBe("ok")
    expect(state.remainingSessionTokens).toBe(100000)
  })

  test("tracks token usage across session and individual stages", () => {
    const enforcer = new BudgetEnforcer({ maxSessionTokens: 10000, maxStageTokens: 4000 })
    enforcer.recordUsage(2000, "analyze")
    enforcer.recordUsage(1500, "mutate")

    const state = enforcer.getState()
    expect(state.sessionTokensUsed).toBe(3500)
    expect(state.stageTokensUsed.analyze).toBe(2000)
    expect(state.stageTokensUsed.mutate).toBe(1500)
    expect(state.remainingSessionTokens).toBe(6500)
    expect(state.status).toBe("ok")
  })

  test("triggers warning and exhaustion status based on thresholds", () => {
    const enforcer = new BudgetEnforcer({ maxSessionTokens: 1000, warningThresholdRatio: 0.8 })

    const okCheck = enforcer.checkBudget(500)
    expect(okCheck.allowed).toBe(true)
    expect(okCheck.status).toBe("ok")
    expect(okCheck.requiresDegradation).toBe(false)

    const warnCheck = enforcer.checkBudget(850)
    expect(warnCheck.allowed).toBe(true)
    expect(warnCheck.status).toBe("warning")
    expect(warnCheck.requiresDegradation).toBe(true)

    const exhaustCheck = enforcer.checkBudget(1050)
    expect(exhaustCheck.allowed).toBe(false)
    expect(exhaustCheck.status).toBe("exhausted")
    expect(exhaustCheck.requiresDegradation).toBe(true)
  })

  test("enforces stage-level token budgets", () => {
    const enforcer = new BudgetEnforcer({ maxSessionTokens: 50000, maxStageTokens: 2000 })
    enforcer.recordUsage(1500, "mutate")

    const checkOver = enforcer.checkBudget(600, "mutate")
    expect(checkOver.allowed).toBe(false)
    expect(checkOver.status).toBe("exhausted")

    const checkOther = enforcer.checkBudget(600, "analyze")
    expect(checkOther.allowed).toBe(true)
    expect(checkOther.status).toBe("ok")
  })

  test("validates prompt assembly tokens against model budget and reserves", () => {
    const enforcer = new BudgetEnforcer({
      maxModelTokens: 8000,
      reservedCompletionTokens: 1000,
    })

    const validPrompt = enforcer.validatePromptAssembly(6500)
    expect(validPrompt.valid).toBe(true)
    expect(validPrompt.overflowTokens).toBe(0)

    const overflowPrompt = enforcer.validatePromptAssembly(7500)
    expect(overflowPrompt.valid).toBe(false)
    expect(overflowPrompt.overflowTokens).toBe(500)
    expect(overflowPrompt.reason).toBeDefined()
  })

  test("trims segments prioritizing retention of protected and high-salience items", () => {
    const enforcer = new BudgetEnforcer()
    const segments = [
      { id: "system", estimatedTokens: 100, protected: true, salience: 10 },
      { id: "low_old", estimatedTokens: 50, salience: 1 },
      { id: "medium", estimatedTokens: 80, salience: 5 },
      { id: "low_recent", estimatedTokens: 40, salience: 1 },
    ]

    const trimmed = enforcer.trimSegments(segments, 200)
    expect(trimmed.totalTokens).toBeLessThanOrEqual(200)

    const retainedIds = trimmed.retained.map((s) => s.id)
    const evictedIds = trimmed.evicted.map((s) => s.id)

    expect(retainedIds).toContain("system")
    expect(retainedIds).toContain("medium")
    expect(evictedIds).toContain("low_old")
  })

  test("supports resetting individual stage and all stages", () => {
    const enforcer = new BudgetEnforcer()
    enforcer.recordUsage(500, "analyze")
    enforcer.recordUsage(300, "mutate")

    enforcer.resetStage("analyze")
    expect(enforcer.getState().stageTokensUsed.analyze).toBeUndefined()
    expect(enforcer.getState().stageTokensUsed.mutate).toBe(300)

    enforcer.resetAll()
    expect(enforcer.getState().sessionTokensUsed).toBe(0)
    expect(Object.keys(enforcer.getState().stageTokensUsed).length).toBe(0)
  })
})
