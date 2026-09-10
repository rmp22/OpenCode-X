import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import { OCXPipeline } from "../../src/ocx/ocx-pipeline"
import { OCXTodoAgent } from "../../src/ocx/todo"
import { OCXDb } from "../../src/ocx/ocx-db"
import { Knowledge } from "../../src/ocx/knowledge"
import { PlanWorkstreamState } from "../../src/ocx/plan-workstream-state"

const user = {
  id: "msg_ocx_test",
  sessionID: "ses_ocx_test",
  role: "user",
  time: { created: 0 },
  agent: "build",
} as unknown as SessionV1.User

const todoStore = () => {
  const rows = new Map<string, OCXTodoAgent.TodoItem[]>()
  return {
    rows,
    get: (sessionID: string) => Effect.succeed(rows.get(sessionID) ?? []),
  }
}

const runPipeline = (prompt: string, store: OCXDb.Store = OCXDb.memory(), todo = todoStore()) =>
  Effect.runPromise(OCXPipeline.run({ store, todo }, { sessionID: "ses_ocx_test", prompt })).then(
    (result) => ({ result, todo }),
  )

const userMessage = (parts: unknown[]) =>
  ({
    info: { role: "user", id: "msg_1" },
    parts,
  }) as unknown as SessionV1.WithParts

describe("ocx pipeline frame", () => {
  test("passes short prompts through without state writes", async () => {
    const store = OCXDb.memory()
    const { result } = await runPipeline("fix it", store)
    expect(result.changed).toBe(false)
    expect(result.strategies).toEqual([])
    expect(result.workflow.name).toBe("coding")
    expect(result.workflow.phase).toBe("plan")
    expect(store.get("ses_ocx_test")).toBeUndefined()
  })

  test("derives heuristic strategies and stack without any call, never a prompt topic", async () => {
    const { result } = await runPipeline("fix the login redirect bug in the react auth form")
    expect(result.changed).toBe(false)
    expect(result.polished).toBe("fix the login redirect bug in the react auth form")
    // Topics come from the LLM-recorded header, never from the user prompt.
    expect(result.topic).toBeUndefined()
    expect(result.stack).toBe("typescript")
    for (const name of ["quality", "engineering", "stack", "typescript"] as const)
      expect(result.strategies).toContain(name)
    expect(result.strategies).not.toContain("write")
    // Specialty playbooks are pull-only via the ocx_playbook tool.
    expect(result.strategies).not.toContain("ui")
  })

  test("picks a preset workflow and persists it for later turns", async () => {
    const store = OCXDb.memory()
    const first = await runPipeline("refactor the auth module to use sessions", store)
    expect(first.result.workflow.name).toBe("coding")
    expect(first.result.workflow.phase).toBe("plan")

    // Later turns keep the stored workflow and phase until runtime evidence
    // authorizes a transition.
    const second = await runPipeline("keep going with the refactor", store)
    expect(second.result.workflow.name).toBe("coding")
    expect(second.result.workflow.phase).toBe("plan")
  })

  test("debug prompts select the debugging workflow with its reasoning playbook", async () => {
    const { result } = await runPipeline("the login endpoint returns a 500 error after my change, fix this bug")
    expect(result.workflow.name).toBe("debugging")
    expect(result.strategies).toContain("reasoning")
  })

  test("frame ships no generic guard rubric; risks come from the session header", async () => {
    const { result } = await runPipeline("extract a shared helper module for retries")
    expect(result.notice).toBeUndefined()
    expect(OCXPipeline.directives(result).join("\n")).not.toContain("OCX GUARD NOTE")
  })

  test("passes stored todos through untouched", async () => {
    const todo = todoStore()
    todo.rows.set("ses_ocx_test", [{ content: "open item", status: "pending", priority: "p1" }])
    const { result } = await runPipeline("continue the refactor work today", OCXDb.memory(), todo)
    expect(result.todos).toEqual([{ content: "open item", status: "pending", priority: "p1" }])
  })

  test("preserves the execution plan across a continuation refresh", async () => {
    const store = OCXDb.memory()
    await runPipeline("implement the retry guard", store)
    const plan = PlanWorkstreamState.parseExecutionPlan([
      "goal=Implement the retry guard",
      "workstream=runtime",
      "  target=src/",
      "  step=Change the retry boundary",
      "    target=src/",
      "    check=Focused test passes",
    ].join("\n")).plan!
    store.set("ses_ocx_test", { ...store.get("ses_ocx_test")!, plan })

    await runPipeline("continue with the retry guard", store)

    expect(store.get("ses_ocx_test")?.plan).toBeDefined()
  })

  test("clears stale execution state only after a new workflow is approved", async () => {
    const store = OCXDb.memory()
    await runPipeline("implement the retry guard", store)
    const plan = PlanWorkstreamState.parseExecutionPlan([
      "goal=Implement the retry guard",
      "workstream=runtime",
      "  target=src/",
      "  step=Change the retry boundary",
      "    target=src/",
      "    check=Focused test passes",
    ].join("\n")).plan!
    store.set("ses_ocx_test", { ...store.get("ses_ocx_test")!, plan })

    const pending = await runPipeline("research a different topic", store)

    expect(pending.result.workflow.name).toBe("coding")
    expect(store.get("ses_ocx_test")?.plan).toBeDefined()
    expect(store.getWorkflowProposal("ses_ocx_test")?.workflow).toBe("research")

    await runPipeline("APPROVE", store)

    expect(store.get("ses_ocx_test")?.plan).toBeUndefined()
    expect(store.getWorkflowProposal("ses_ocx_test")).toBeUndefined()
  })
})

describe("ocx pipeline directives", () => {
  test("adds bounded topic context without copying the request", () => {
    const context = Knowledge.topicContext("Build browser screen", "implement a responsive page with keyboard support")
    expect(context.join("\n")).toContain("=== OCX TOPIC CONTEXT ===")
    expect(context.join("\n")).toContain("Every interactive element")
    expect(context.join("\n")).not.toContain("implement a responsive page")
    expect(context.join("\n").length).toBeLessThanOrEqual(1200)
  })

  test("does not emit topic context for an empty topic", () => {
    expect(Knowledge.topicContext("", "implement a page")).toEqual([])
    expect(Knowledge.topicContext("===", "implement a page")).toEqual([])
  })

  test("assembles strategy docs, selected workflow, and guard note", () => {
    const parts = OCXPipeline.directives({
      changed: true,
      polished: "x",
      strategies: ["write"],
      workflow: {
        name: "debugging",
        phase: "isolate",
        phases: [
          { id: "reproduce", goal: "trigger the bug" },
          { id: "isolate", goal: "narrow the region" },
        ],
        reminder: "Check imports.",
      },
      notice: "- No stubs",
    })
    const text = parts.join("\n\n")
    expect(text).not.toContain("=== OCX SELECTED STRATEGIES ===")
    expect(text).not.toContain("--- write ---")
    expect(text).toContain("=== OCX WORKFLOW ===")
    expect(text).toContain("Current phase: isolate")
    expect(text).toContain("=== OCX GUARD NOTE ===")
  })

  test("renders todo state rows", () => {
    const parts = OCXPipeline.directives({
      changed: false,
      polished: "x",
      strategies: [],
      workflow: { name: "feature", phase: "plan", phases: [{ id: "plan", goal: "list" }] },
      notice: undefined,
      todos: [{ content: "ship it", status: "in_progress", priority: "p1" }],
    })
    const text = parts.join("\n")
    expect(text).toContain("=== OCX TODO STATE ===")
    expect(text).toContain("ship it")
  })
})

describe("ocx pipeline message helpers", () => {
  test("applyToMessages swaps the text part only when changed", () => {
    const message = userMessage([
      { type: "text", text: "original prompt" },
      { type: "text", text: "<system-reminder>note</system-reminder>", synthetic: true },
    ])
    OCXPipeline.applyToMessages([message], {
      changed: true,
      polished: "polished prompt",
      strategies: [],
      workflow: { name: "feature", phase: "explore", phases: [{ id: "explore", goal: "read" }] },
      notice: undefined,
    })
    expect(message.parts[0]).toMatchObject({ type: "text", text: "polished prompt" })
    expect(message.parts[1]).toMatchObject({ synthetic: true })
  })

  test("applyToMessages keeps messages unchanged when not changed", () => {
    const message = userMessage([{ type: "text", text: "original prompt" }])
    OCXPipeline.applyToMessages([message], {
      changed: false,
      polished: "polished prompt",
      strategies: [],
      workflow: { name: "feature", phase: "explore", phases: [{ id: "explore", goal: "read" }] },
      notice: undefined,
    })
    expect(message.parts[0]).toMatchObject({ text: "original prompt" })
  })

  test("promptText reads the last non-synthetic text part", () => {
    const message = userMessage([
      { type: "text", text: "real prompt" },
      { type: "text", text: "reminder", synthetic: true },
    ])
    expect(OCXPipeline.promptText([message])).toBe("real prompt")
  })

  test("promptText skips a synthetic compaction followup", () => {
    const previous = userMessage([{ type: "text", text: "continue the refactor" }])
    const followup = userMessage([{ type: "text", text: "Continue if you have next steps", synthetic: true }])
    expect(OCXPipeline.promptText([previous, followup])).toBe("continue the refactor")
  })
})
