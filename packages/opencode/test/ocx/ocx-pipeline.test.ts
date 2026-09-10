import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { OCXPipeline } from "../../src/ocx/ocx-pipeline"
import { OCXTodoAgent } from "../../src/ocx/todo"
import { OCXDb } from "../../src/ocx/ocx-db"

const sessionID = "ses_ocx_workflow_change"

const todoStore = () => {
  const rows = new Map<string, OCXTodoAgent.TodoItem[]>()
  return {
    get: (id: string) => Effect.succeed(rows.get(id) ?? []),
  }
}

const runPipeline = (prompt: string, store: OCXDb.Store) =>
  Effect.runPromise(OCXPipeline.run({ store, todo: todoStore() }, { sessionID, prompt }))

describe("ocx pipeline workflow changes", () => {
  test("requires approval before applying an explicit workflow change", async () => {
    const store = OCXDb.memory()
    await runPipeline("refactor the auth module to use sessions", store)
    store.set(sessionID, { ...store.get(sessionID)!, status: "blocked" })

    const pending = await runPipeline("change the workflow to debugging", store)

    expect(pending.workflow.name).toBe("coding")
    expect(store.get(sessionID)?.workflow).toBe("coding")
    expect(store.getWorkflowProposal(sessionID)?.workflow).toBe("debugging")

    const result = await runPipeline("APPROVE", store)

    expect(result.workflow.name).toBe("debugging")
    expect(result.workflow.phase).toBe("reproduce")
    expect(result.workflow.status).toBe("active")
    expect(store.get(sessionID)?.workflow).toBe("debugging")
    expect(store.get(sessionID)?.status).toBe("active")
  })

  test("keeps ordinary continuation in the stored workflow", async () => {
    const store = OCXDb.memory()
    await runPipeline("refactor the auth module to use sessions", store)

    const result = await runPipeline("continue with the refactor", store)

    expect(result.workflow.name).toBe("coding")
  })
})
