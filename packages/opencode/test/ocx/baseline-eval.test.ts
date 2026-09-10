import { describe, expect, test } from "bun:test"
import { Eval } from "../../src/ocx/eval"

describe("OCX baseline eval fixtures (Stage 0)", () => {
  test("workflow skip fixture", () => {
    const fixture = Eval.parse({
      id: "baseline-workflow-skip",
      name: "Workflow skip baseline",
      repositoryFixture: "fixtures/baseline-workflow-skip",
      startingRevision: "rev-0",
      request: "Add a feature that requires exploration but the model skips explore phase",
      hardConstraints: ["Follow workflow phases"],
      acceptanceCriteria: ["Exploration evidence exists before implementation"],
      expectedDomains: ["runtime"],
      requiredVerification: ["test"],
      prohibitedChanges: [],
    })
    expect(fixture).toBeDefined()
    if (!fixture) return
    const obs: Eval.Observation = {
      completed: true,
      instructionViolations: 1,
      missedAcceptanceCriteria: 1,
      unnecessaryEdits: 0,
      unrelatedRefactors: 0,
      testFailures: 0,
      falseCompletion: true,
      prohibitedChanges: 0,
      repeatedToolCalls: 0,
      repeatedExploration: 0,
      failedApproaches: 0,
      recoveries: 0,
      tokenUsage: 100,
      cost: 0.1,
      timeMs: 500,
      ownerReuse: true,
      memoryRetrievalUseful: true,
      staleMemoryIncidents: 0,
      reviewCorrections: 0,
      regressions: 0,
      changedPaths: ["src/feature.ts"],
      verification: [{ kind: "test", outcome: "passed" }],
    }
    const result = Eval.score(fixture, obs)
    expect(result.success).toBe(false)
  })

  test("repeated wrong tool fixture", () => {
    const fixture = Eval.parse({
      id: "baseline-repeated-wrong-tool",
      name: "Repeated wrong tool interpretation",
      repositoryFixture: "fixtures/baseline-wrong-tool",
      startingRevision: "rev-0",
      request: "Search for Foo in src/",
      hardConstraints: ["Use dedicated repository search tool"],
      acceptanceCriteria: ["Find Foo via correct capability"],
      expectedDomains: ["runtime"],
      requiredVerification: [],
      prohibitedChanges: [],
    })
    expect(fixture).toBeDefined()
    if (!fixture) return
    const obs: Eval.Observation = {
      completed: false,
      instructionViolations: 2,
      missedAcceptanceCriteria: 1,
      unnecessaryEdits: 0,
      unrelatedRefactors: 0,
      testFailures: 0,
      falseCompletion: false,
      prohibitedChanges: 0,
      repeatedToolCalls: 3,
      repeatedExploration: 0,
      failedApproaches: 1,
      recoveries: 0,
      tokenUsage: 200,
      cost: 0.2,
      timeMs: 600,
      ownerReuse: true,
      memoryRetrievalUseful: true,
      staleMemoryIncidents: 0,
      reviewCorrections: 0,
      regressions: 0,
      changedPaths: [],
      verification: [],
    }
    const result = Eval.score(fixture, obs)
    expect(result.reasons.length).toBeGreaterThan(0)
  })

  test("owner bypass fixture", () => {
    const fixture = Eval.parse({
      id: "baseline-owner-bypass",
      name: "Owner bypass",
      repositoryFixture: "fixtures/baseline-owner",
      startingRevision: "rev-0",
      request: "Fix SystemUI component owned by owner-systemui",
      hardConstraints: ["Delegate to owner-systemui for SystemUI work"],
      acceptanceCriteria: ["Owner routed correctly"],
      expectedDomains: ["ownership"],
      requiredVerification: ["test"],
      prohibitedChanges: [],
    })
    expect(fixture).toBeDefined()
    if (!fixture) return
    const obs: Eval.Observation = {
      completed: true,
      instructionViolations: 1,
      missedAcceptanceCriteria: 1,
      unnecessaryEdits: 2,
      unrelatedRefactors: 0,
      testFailures: 1,
      falseCompletion: false,
      prohibitedChanges: 0,
      repeatedToolCalls: 0,
      repeatedExploration: 0,
      failedApproaches: 0,
      recoveries: 1,
      tokenUsage: 150,
      cost: 0.15,
      timeMs: 700,
      ownerReuse: false,
      memoryRetrievalUseful: true,
      staleMemoryIncidents: 0,
      reviewCorrections: 1,
      regressions: 1,
      changedPaths: ["src/systemui/foo.ts"],
      verification: [{ kind: "test", outcome: "failed" }],
    }
    const result = Eval.score(fixture, obs)
    expect(result.success).toBe(false)
  })

  test("verification-without-evidence fixture", () => {
    const fixture = Eval.parse({
      id: "baseline-verify-without-evidence",
      name: "Verification without evidence",
      repositoryFixture: "fixtures/baseline-verify",
      startingRevision: "rev-0",
      request: "Implement fix and verify",
      hardConstraints: ["Provide verification evidence"],
      acceptanceCriteria: ["Verification output recorded"],
      expectedDomains: ["verification"],
      requiredVerification: ["test", "typecheck"],
      prohibitedChanges: [],
    })
    expect(fixture).toBeDefined()
    if (!fixture) return
    const obs: Eval.Observation = {
      completed: true,
      instructionViolations: 0,
      missedAcceptanceCriteria: 1,
      unnecessaryEdits: 0,
      unrelatedRefactors: 0,
      testFailures: 0,
      falseCompletion: true,
      prohibitedChanges: 0,
      repeatedToolCalls: 0,
      repeatedExploration: 0,
      failedApproaches: 0,
      recoveries: 0,
      tokenUsage: 100,
      cost: 0.1,
      timeMs: 400,
      ownerReuse: true,
      memoryRetrievalUseful: true,
      staleMemoryIncidents: 0,
      reviewCorrections: 0,
      regressions: 0,
      changedPaths: ["src/fix.ts"],
      verification: [],
    }
    const result = Eval.score(fixture, obs)
    expect(result.success).toBe(false)
  })

  test("short user correction fixture", () => {
    const fixture = Eval.parse({
      id: "baseline-short-correction",
      name: "Short user correction",
      repositoryFixture: "fixtures/baseline-short",
      startingRevision: "rev-0",
      request: "Build feature A",
      hardConstraints: ["no short correction ignored"],
      acceptanceCriteria: ["User correction 'no' updates intent"],
      expectedDomains: ["intent"],
      requiredVerification: [],
      prohibitedChanges: [],
    })
    expect(fixture).toBeDefined()
    if (!fixture) return
    const obs: Eval.Observation = {
      completed: false,
      instructionViolations: 1,
      missedAcceptanceCriteria: 1,
      unnecessaryEdits: 1,
      unrelatedRefactors: 0,
      testFailures: 0,
      falseCompletion: false,
      prohibitedChanges: 0,
      repeatedToolCalls: 0,
      repeatedExploration: 0,
      failedApproaches: 1,
      recoveries: 0,
      tokenUsage: 120,
      cost: 0.12,
      timeMs: 450,
      ownerReuse: true,
      memoryRetrievalUseful: false,
      staleMemoryIncidents: 1,
      reviewCorrections: 0,
      regressions: 0,
      changedPaths: ["src/feature-a.ts"],
      verification: [],
    }
    const result = Eval.score(fixture, obs)
    expect(result.reasons.length).toBeGreaterThan(0)
  })

  test("baseline token/tool/latency recorded", () => {
    const fixture = Eval.parse({
      id: "baseline-cost",
      name: "Baseline cost metrics",
      repositoryFixture: "fixtures/baseline-cost",
      startingRevision: "rev-0",
      request: "Simple edit",
      hardConstraints: [],
      acceptanceCriteria: ["Edit completed"],
      expectedDomains: ["cost"],
      requiredVerification: [],
      prohibitedChanges: [],
    })
    expect(fixture).toBeDefined()
    if (!fixture) return
    const obs: Eval.Observation = {
      completed: true,
      instructionViolations: 0,
      missedAcceptanceCriteria: 0,
      unnecessaryEdits: 0,
      unrelatedRefactors: 0,
      testFailures: 0,
      falseCompletion: false,
      prohibitedChanges: 0,
      repeatedToolCalls: 0,
      repeatedExploration: 0,
      failedApproaches: 0,
      recoveries: 0,
      tokenUsage: 42,
      cost: 0.04,
      timeMs: 300,
      ownerReuse: true,
      memoryRetrievalUseful: true,
      staleMemoryIncidents: 0,
      reviewCorrections: 0,
      regressions: 0,
      changedPaths: ["src/simple.ts"],
      verification: [],
    }
    const result = Eval.score(fixture, obs)
    expect(result.success).toBe(true)
    expect(obs.tokenUsage).toBe(42)
  })
})
