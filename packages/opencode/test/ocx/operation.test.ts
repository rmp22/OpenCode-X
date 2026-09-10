import { describe, expect, test } from "bun:test"
import { Effect, Exit } from "effect"
import { join } from "node:path"
import { OCXDb } from "../../src/ocx/ocx-db"
import { OCXOperation } from "../../src/ocx/operation"
import { tmpdir } from "../fixture/fixture"

describe("OCX operation recovery", () => {
  test("classifies and stores a failed effect without hiding the failure", async () => {
    const store = OCXDb.memory()
    const exit = await Effect.runPromise(
      OCXOperation.observe(
        { sessionID: "ses_read", operation: "read", store },
        Effect.fail(new Error("file not found")),
      ).pipe(Effect.exit),
    )

    expect(Exit.isFailure(exit)).toBe(true)
    const record = store.operations("ses_read")[0]
    expect(record).toMatchObject({
      operation: "read",
      status: "failed",
      category: "env",
    })
    expect(record?.message).toContain("file not found")
  })

  test("records cancellation separately from an ordinary failure", async () => {
    const store = OCXDb.memory()
    const exit = await Effect.runPromise(
      OCXOperation.observe({ sessionID: "ses_task", operation: "task", store }, Effect.interrupt).pipe(Effect.exit),
    )

    expect(Exit.isFailure(exit)).toBe(true)
    expect(store.operations("ses_task")[0]).toMatchObject({ operation: "task", status: "cancelled" })
  })

  test("round-trips operation records through SQLite", async () => {
    await using temp = await tmpdir()
    const databasePath = join(temp.path, "nested", "workflow.db")
    const first = await Effect.runPromise(OCXDb.open(databasePath))
    first.recordOperation({
      sessionID: "ses_roundtrip",
      operation: "patch",
      status: "failed",
      category: "artifact",
      message: "patch rejected",
      retryable: true,
      nextAction: "re-read the file",
    })

    const second = await Effect.runPromise(OCXDb.open(databasePath))
    expect(second.operations("ses_roundtrip")[0]).toMatchObject({
      operation: "patch",
      status: "failed",
      category: "artifact",
      retryable: true,
    })
  })
})
