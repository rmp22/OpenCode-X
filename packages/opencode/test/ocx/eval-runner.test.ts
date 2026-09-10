import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { Effect, Exit } from "effect"
import { Eval } from "../../src/ocx/eval"
import { EvalRunner } from "../../src/ocx/eval-runner"
import { OCXDb } from "../../src/ocx/ocx-db"
import { tmpdir } from "../fixture/fixture"

function fixture(repositoryFixture: string) {
  return Eval.parse({
    id: "retry-loop",
    name: "Fix retry loop",
    repositoryFixture,
    startingRevision: "HEAD",
    request: "Fix the retry loop without changing the public API.",
    hardConstraints: ["Keep the public API stable."],
    acceptanceCriteria: ["The retry test passes."],
    expectedDomains: ["runtime"],
    expectedPaths: ["src/retry.ts"],
    requiredVerification: ["test"],
    prohibitedChanges: ["docs/README.md"],
  })
}

describe("OCX EvalRunner", () => {
  test("executes in a copied workspace and records VCS evidence", async () => {
    await using source = await tmpdir({ git: true })
    const evalFixture = fixture(source.path)
    expect(evalFixture).toBeDefined()
    if (!evalFixture) return
    const store = OCXDb.memory()
    let executionDirectory = ""

    const record = await Effect.runPromise(
      EvalRunner.run({
        fixture: evalFixture,
        store,
        metadata: { policyVersion: "test-policy", featureFlags: ["owners", "owners"] },
        executor: ({ workdir, runID, metadata }) =>
          Effect.promise(async () => {
            executionDirectory = workdir
            await Bun.write(join(workdir, "src", "retry.ts"), "export const retry = true\n")
            expect(runID).toStartWith("eval_")
            expect(metadata.policyVersion).toBe("test-policy")
            return {
              completed: true,
              verification: [{ kind: "test" as const, outcome: "passed" as const }],
            }
          }),
      }),
    )

    expect(executionDirectory).not.toBe(source.path)
    expect(record.status).toBe("completed")
    expect(record.actualRevision).toBeDefined()
    expect(record.result.success).toBe(true)
    expect(record.result.observation.changedPaths).toEqual(["src/retry.ts"])
    expect(record.metadata.featureFlags).toEqual(["owners"])
    expect(store.evaluations("retry-loop")).toEqual([record])
    expect(await Bun.file(join(source.path, "src", "retry.ts")).exists()).toBe(false)
  })

  test("records executor failures without losing the failure cause", async () => {
    await using source = await tmpdir({ git: true })
    const evalFixture = fixture(source.path)
    expect(evalFixture).toBeDefined()
    if (!evalFixture) return

    const store = OCXDb.memory()
    const record = await Effect.runPromise(
      EvalRunner.run({
        fixture: evalFixture,
        store,
        executor: () => Effect.fail(new Error("provider unavailable")),
      }),
    )

    expect(record.status).toBe("failed")
    expect(record.error).toContain("provider unavailable")
    expect(record.result.success).toBe(false)
    expect(store.evaluations("retry-loop")[0]?.status).toBe("failed")
  })

  test("persists evaluation records across database reopen", async () => {
    await using source = await tmpdir({ git: true })
    const evalFixture = fixture(source.path)
    expect(evalFixture).toBeDefined()
    if (!evalFixture) return
    const filename = join(source.path, "nested", "workflow.db")
    const store = await Effect.runPromise(OCXDb.open(filename))
    const record = await Effect.runPromise(
      EvalRunner.run({
        fixture: evalFixture,
        store,
        executor: () => Effect.succeed({ completed: true }),
      }),
    )
    const reopened = await Effect.runPromise(OCXDb.open(filename))

    expect(reopened.evaluations("retry-loop")).toEqual([record])
  })

  test("runs ablation variants sequentially with explicit policy metadata", async () => {
    await using source = await tmpdir({ git: true })
    const evalFixture = fixture(source.path)
    expect(evalFixture).toBeDefined()
    if (!evalFixture) return
    const seen: string[] = []
    const store = OCXDb.memory()
    const records = await Effect.runPromise(
      EvalRunner.runAblations({
        fixture: evalFixture,
        store,
        variants: [
          { id: "baseline", featureFlags: [] },
          { id: "owners-memory", featureFlags: ["owners", "memory"] },
        ],
        executor: ({ metadata }) =>
          Effect.sync(() => {
            seen.push(metadata.ablationID ?? "")
            return { completed: true, verification: [{ kind: "test" as const, outcome: "passed" as const }] }
          }),
      }),
    )

    expect(seen).toEqual(["baseline", "owners-memory"])
    expect(records.map((record) => record.metadata.ablationID)).toEqual(["baseline", "owners-memory"])
    expect(records[1]?.metadata.featureFlags).toEqual(["owners", "memory"])
    expect(store.evaluations("retry-loop")).toHaveLength(2)
  })

  test("rejects a fixture directory that does not exist", async () => {
    const evalFixture = fixture(join(process.cwd(), "missing-eval-fixture"))
    expect(evalFixture).toBeDefined()
    if (!evalFixture) return

    const exit = await Effect.runPromise(
      EvalRunner.run({ fixture: evalFixture, executor: () => Effect.succeed({ completed: true }) }).pipe(Effect.exit),
    )
    expect(Exit.isFailure(exit)).toBe(true)
  })
})
