import { describe, expect, it } from "bun:test"
import {
  HierarchicalBudgetTracker,
  ProgressCycleBreaker,
  ResearchGovernor,
  ToolHealthTracker,
} from "../../src/ocx/owner/governance"

describe("Governance, Cycle Breaker and Budgets", () => {
  it("breaks cycle when identical tool call is repeated", () => {
    const breaker = new ProgressCycleBreaker(2)
    const v1 = breaker.recordStep("read", { filePath: "src/index.ts" })
    expect(v1.shouldBreak).toBe(false)

    const v2 = breaker.recordStep("read", { filePath: "src/index.ts" })
    expect(v2.shouldBreak).toBe(true)
    expect(v2.reason).toContain("identical arguments")
  })

  it("breaks cycle when ping-pong oscillation is detected", () => {
    const breaker = new ProgressCycleBreaker(5)
    breaker.recordStep("read", { file: "a.ts" })
    breaker.recordStep("read", { file: "b.ts" })
    breaker.recordStep("read", { file: "a.ts" })
    const v = breaker.recordStep("read", { file: "b.ts" })
    expect(v.shouldBreak).toBe(true)
    expect(v.reason).toContain("ping-pong")
  })

  it("breaks cycle when stalled for N steps without touched files", () => {
    const breaker = new ProgressCycleBreaker(10, 3)
    breaker.recordStep("grep", { pattern: "foo" })
    breaker.recordStep("grep", { pattern: "bar" })
    const v = breaker.recordStep("grep", { pattern: "baz" })
    expect(v.shouldBreak).toBe(true)
    expect(v.reason).toContain("without file modification")
  })

  it("enforces hierarchical budgets and forces checkpoint near exhaustion", () => {
    const tracker = HierarchicalBudgetTracker.createDefault(3, 10_000, 5, 10_000)
    expect(tracker.canExecute()).toBe(true)

    const t1 = tracker.recordTurn(2000)
    expect(t1.remainingTurns).toBe(2)
    expect(t1.mustCheckpoint).toBe(false)

    const t2 = tracker.recordTurn(3000)
    expect(t2.remainingTurns).toBe(1)
    expect(t2.mustCheckpoint).toBe(true)

    const t3 = tracker.recordTurn(1000)
    expect(t3.exhausted).toBe(true)
  })

  it("tracks tool health and flags unhealthy after consecutive failures", () => {
    const health = new ToolHealthTracker(3)
    expect(health.isHealthy("websearch")).toBe(true)

    health.recordFailure("websearch")
    health.recordFailure("websearch")
    expect(health.isHealthy("websearch")).toBe(true)

    const f3 = health.recordFailure("websearch")
    expect(f3.isUnhealthy).toBe(true)
    expect(health.isHealthy("websearch")).toBe(false)

    health.recordSuccess("websearch")
    expect(health.isHealthy("websearch")).toBe(true)
  })

  it("governs research tool calls with strict limits", () => {
    const gov = new ResearchGovernor(2)
    expect(gov.canResearch()).toBe(true)

    const r1 = gov.recordResearchCall()
    expect(r1.allowed).toBe(true)
    expect(r1.remaining).toBe(1)

    const r2 = gov.recordResearchCall()
    expect(r2.allowed).toBe(true)
    expect(r2.remaining).toBe(0)

    const r3 = gov.recordResearchCall()
    expect(r3.allowed).toBe(false)
  })
})
