import { describe, expect, test } from "bun:test"
import { Eval } from "../../src/ocx/eval"

const fixture = Eval.parse({
  id: "retry-loop",
  name: "Fix retry loop",
  repositoryFixture: "fixtures/retry-loop",
  startingRevision: "rev-0",
  request: "Fix the retry loop without changing the public API.",
  hardConstraints: ["Keep the public API stable."],
  acceptanceCriteria: ["The retry test passes."],
  expectedDomains: ["runtime"],
  requiredVerification: ["test", "typecheck"],
  prohibitedChanges: ["docs/README.md"],
})

const observation: Eval.Observation = {
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
  recoveries: 1,
  tokenUsage: 100,
  cost: 0.1,
  timeMs: 500,
  ownerReuse: true,
  memoryRetrievalUseful: true,
  staleMemoryIncidents: 0,
  reviewCorrections: 0,
  regressions: 0,
  changedPaths: ["src/retry.ts"],
  verification: [
    { kind: "test", outcome: "passed" },
    { kind: "typecheck", outcome: "passed" },
  ],
}

describe("OCX Eval", () => {
  test("parses a bounded fixture and scores an observed successful run", () => {
    expect(fixture).toBeDefined()
    if (!fixture) return

    const result = Eval.score(fixture, observation)
    expect(result).toMatchObject({ fixtureID: "retry-loop", success: true, score: 100, reasons: [] })
  })

  test("marks incomplete verification and prohibited changes as failure reasons", () => {
    expect(fixture).toBeDefined()
    if (!fixture) return

    const result = Eval.score(fixture, {
      ...observation,
      completed: false,
      prohibitedChanges: 1,
      changedPaths: ["docs/README.md"],
      verification: [{ kind: "test", outcome: "failed" }, { kind: "typecheck", outcome: "unknown" }],
      regressions: 1,
    })
    expect(result.success).toBe(false)
    expect(result.score).toBeLessThan(100)
    expect(result.reasons).toEqual(
      expect.arrayContaining([
        "task did not complete",
        "required checks did not pass: test, typecheck",
        "prohibited paths changed: docs/README.md",
        "1 regression(s) recorded",
      ]),
    )
  })

  test("aggregates run outcomes without treating metrics as success", () => {
    expect(fixture).toBeDefined()
    if (!fixture) return

    const first = Eval.score(fixture, observation)
    const second = Eval.score(fixture, { ...observation, completed: false, ownerReuse: false, memoryRetrievalUseful: false })
    expect(Eval.summarize([first, second])).toEqual({
      runs: 2,
      successes: 1,
      averageScore: 80,
      averageRecoveries: 1,
      ownerReuseRate: 0.5,
      usefulMemoryRate: 0.5,
      totalRegressions: 0,
    })
  })

  test("rejects malformed fixture identifiers and overlong fields", () => {
    expect(Eval.parse({ id: "bad id", name: "x" })).toBeUndefined()
    expect(
      Eval.parse({
        id: "bad-check",
        name: "name",
        repositoryFixture: "fixture",
        startingRevision: "rev",
        request: "request",
        hardConstraints: [],
        acceptanceCriteria: [],
        expectedDomains: [],
        requiredVerification: ["unknown"],
        prohibitedChanges: [],
      }),
    ).toBeUndefined()
    expect(
      Eval.parse({
        id: "too-long",
        name: "x".repeat(401),
        repositoryFixture: "fixture",
        startingRevision: "rev",
        request: "request",
        hardConstraints: [],
        acceptanceCriteria: [],
        expectedDomains: [],
        requiredVerification: [],
        prohibitedChanges: [],
      }),
    ).toBeUndefined()
    expect(
      Eval.parse({
        id: "too-many",
        name: "name",
        repositoryFixture: "fixture",
        startingRevision: "rev",
        request: "request",
        hardConstraints: Array.from({ length: 25 }, () => "constraint"),
        acceptanceCriteria: [],
        expectedDomains: [],
        requiredVerification: [],
        prohibitedChanges: [],
      }),
    ).toBeUndefined()
  })

  test("normalizes partial observations into bounded evidence", () => {
    expect(
      Eval.normalizeObservation(
        {
          completed: true,
          cost: 0.25,
          verification: [{ kind: "test", outcome: "passed" }],
        },
        ["src/retry.ts", "src/retry.ts", ""],
      ),
    ).toMatchObject({
      completed: true,
      cost: 0.25,
      changedPaths: ["src/retry.ts"],
      verification: [{ kind: "test", outcome: "passed" }],
    })
  })
})
