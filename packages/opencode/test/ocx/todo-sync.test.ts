import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { mergePlan } from "../../src/ocx/todo/sync"
import { reconcileDelegation, reconcilePlan } from "../../src/ocx/todo/sync"
import { Frame } from "../../src/ocx/turn/frame"

describe("plan to todo merge", () => {
  test("appends plan steps as pending items", () => {
    const merged = mergePlan([], [{ do: "Map the retry call sites" }, { do: "Extract the backoff helper" }])
    expect(merged).toEqual([
      { content: "Map the retry call sites", status: "pending", priority: "p1" },
      { content: "Extract the backoff helper", status: "pending", priority: "p1" },
    ])
  })

  test("keeps existing items and their statuses", () => {
    const existing = [{ content: "Fix the parser", status: "in_progress", priority: "p0" }]
    const merged = mergePlan(existing, [{ do: "Write regression test" }, { do: "Run the suite" }])
    expect(merged[0]).toEqual({ content: "Fix the parser", status: "in_progress", priority: "p0" })
    expect(merged.length).toBe(3)
  })

  test("skips steps that duplicate an existing item regardless of punctuation or case", () => {
    const existing = [{ content: "Run typecheck for packages/opencode", status: "pending", priority: "p1" }]
    const merged = mergePlan(existing, [
      { do: "run typecheck for packages/opencode" },
      { do: "Run, Typecheck  for packages/opencode!" },
      { do: "Add a missing export" },
    ])
    expect(merged.map((item) => item.content)).toEqual(["Run typecheck for packages/opencode", "Add a missing export"])
  })

  test("ignores tiny plans that need no list", () => {
    const existing = [{ content: "Reply to review", status: "pending", priority: "p2" }]
    expect(mergePlan(existing, [{ do: "One single step" }])).toEqual(existing)
    expect(mergePlan(existing, [])).toEqual(existing)
  })

  test("caps the merged list at 32 items", () => {
    const existing = Array.from({ length: 30 }, (_, index) => ({ content: `existing ${index}`, status: "pending", priority: "p2" }))
    const plan = Array.from({ length: 10 }, (_, index) => ({ do: `new step ${index}` }))
    expect(mergePlan(existing, plan).length).toBe(32)
  })

  test("marks a test plan item complete when test files were created", () => {
    const plan = [
      { do: "Write tests: domain.test.mjs and server.test.mjs", expect: "test suite passes" },
      { do: "Run the browser check", expect: "browser check passes" },
    ]
    const reconciled = reconcilePlan(
      mergePlan([], plan),
      plan,
      [
        { kind: "write", path: "/project/tests/domain.test.mjs" },
        { kind: "write", path: "/project/tests/server.test.mjs" },
      ],
    )
    expect(reconciled[0]?.status).toBe("completed")
    expect(reconciled[1]?.status).toBe("pending")
  })

  test("reconciles only an exact normalized delegated todo", () => {
    const existing = [
      { content: "Implement auth", status: "pending", priority: "p1" },
      { content: "Review auth", status: "pending", priority: "p2" },
    ]

    expect(reconcileDelegation(existing, " implement-auth! ", "in_progress")).toEqual([
      { content: "Implement auth", status: "in_progress", priority: "p1" },
      { content: "Review auth", status: "pending", priority: "p2" },
    ])
    expect(reconcileDelegation(existing, "Implement auth", "completed")[0]?.status).toBe("completed")
    expect(reconcileDelegation(existing, "Unknown task", "pending")).toEqual(existing)
  })
})

describe("plan todo sync per turn", () => {
  const plan = [
    { do: "Map the retry call sites", expect: "call sites listed" },
    { do: "Extract the backoff helper", expect: "helper compiles" },
  ]

  function fakeServices(store: { todos: { content: string; status: string; priority: string }[] }) {
    return {
      sessionID: "ses_sync",
      todoGet: (sid: string) => Effect.succeed(structuredClone(store.todos)),
      todoSet: (sid: string, items: ReadonlyArray<{ content: string; status: string; priority: string }>) =>
        Effect.sync(() => {
          store.todos = structuredClone([...items])
        }),
    }
  }

  const header = {
    topic: "t",
    strategies: [],
    unknownStrategies: [],
    risks: [],
    intents: [],
    plan,
    workstreams: [],
  }

  test("writes plan steps once and skips repeats within the turn", async () => {
    const store = { todos: [] as { content: string; status: string; priority: string }[] }
    const services = fakeServices(store)
    const key = "ses_sync:u1"
    await Effect.runPromise(Frame.syncPlanTodos(services, key, header))
    expect(store.todos.length).toBe(2)

    await Effect.runPromise(
      Frame.syncPlanTodos(services, key, { ...header, plan: [...plan, { do: "third", expect: "done" }] }),
    )
    expect(store.todos.length).toBe(2)
  })

  test("ignores headers without a real plan", async () => {
    const store = { todos: [] as { content: string; status: string; priority: string }[] }
    const services = fakeServices(store)
    await Effect.runPromise(Frame.syncPlanTodos(services, "ses_sync:u2", { ...header, plan: [{ do: "only one", expect: "x" }] }))
    await Effect.runPromise(Frame.syncPlanTodos(services, "ses_sync:u3", undefined))
    expect(store.todos).toEqual([])
  })
})
