import { describe, expect, test } from "bun:test"
import { Requirements } from "../../src/ocx/requirements"
import { TaskGraph } from "../../src/ocx/task-graph"
import { VerificationPlanner } from "../../src/ocx/verification-planner"

describe("verification planner", () => {
  test("selects ordered checks from changed paths, graph acceptance, and failures", () => {
    const requirements = Requirements.fromText("Preserve the current public API.", "user", 1)
    const graph = TaskGraph.sync(undefined, {
      repositoryID: "/workspace/repo",
      sessionID: "ses_plan",
      topic: "Implement retry handling",
      plan: [{ do: "Run retry tests", expect: "test suite passes" }],
      workstreams: [],
      requirements,
    })
    const plan = VerificationPlanner.plan({
      changedPaths: ["src/retry.ts", "package.json"],
      commandByKind: {
        lint: "bun run lint",
        typecheck: "bun run typecheck",
        test: "bun test",
        build: "bun run build",
      },
      testEvidence: true,
      graph,
      requirements,
      priorFailures: ["test"],
    })

    expect(plan.checks.map((check) => check.kind)).toEqual(["lint", "typecheck", "test", "build"])
    expect(plan.checks.find((check) => check.kind === "test")?.reasons).toEqual([
      "test evidence changed or was discovered",
      expect.stringContaining("accepts test"),
      "previous test check failed",
    ])
    expect(plan.pendingRequirementIDs).toEqual([requirements[0]?.id])
    expect(VerificationPlanner.render(plan)).toContain("=== OCX VERIFICATION PLAN ===")
  })

  test("does not add duplicate check kinds and can plan a prior failure without changed files", () => {
    const plan = VerificationPlanner.plan({ changedPaths: [], priorFailures: ["test", "test", "typecheck"] })

    expect(plan.checks.map((check) => check.kind)).toEqual(["typecheck", "test"])
    expect(plan.checks.every((check) => check.reasons.length > 0)).toBe(true)
  })
})
