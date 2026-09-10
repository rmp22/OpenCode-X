import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import type { Provider } from "../../src/provider/provider"
import type { LLM } from "../../src/session/llm"
import { OCXDb } from "../../src/ocx/ocx-db"
import { Header } from "../../src/ocx/header"
import { OwnerRegistry } from "../../src/ocx/owner/registry"
import { Requirements } from "../../src/ocx/requirements"
import { Workflow } from "../../src/ocx/workflow"
import { BeforeStep } from "../../src/ocx/turn/before-step"
import { State } from "../../src/ocx/turn/state"
import { PlanWorkstreamState } from "../../src/ocx/plan-workstream-state"
import type { TurnServices } from "../../src/ocx/turn/types"
import { tmpdir } from "../fixture/fixture"

const model = {} as Provider.Model
const user = {} as SessionV1.User

const messages = [
  {
    info: { role: "user", id: "user" },
    parts: [{ type: "text", text: "review this TypeScript change" }],
  },
] as unknown as SessionV1.WithParts[]

describe("before-step practice injection", () => {
  test("persists a repository graph and emits it once for a validated header", async () => {
    await using tmp = await tmpdir()
    const sessionID = "ses_before_step_graph"
    const key = State.turnKey(sessionID, "user")
    const requirements = Requirements.fromText("Preserve the current public API.", "user", 1)
    State.setPipeline(key, {
      changed: false,
      polished: "implement the retry change",
      strategies: [],
       workflow: { name: "coding", phase: "plan", phases: Workflow.PRESETS.coding.phases },
      notice: undefined,
      requirements,
    })
    State.setHeader(
      key,
      Header.parseHeader({
        topic: "Implement retry handling",
        strategies: [],
        risks: [],
         workflow: "coding",
        plan: [
          { do: "Map retry call sites", expect: "call sites are listed" },
          { do: "Add retry regression tests", expect: "test suite passes" },
        ],
        workstreams: [{ id: "runtime", goal: "Change runtime retry behavior" }],
      }),
    )
    const store = OCXDb.memory()
    const services = {
      store,
      todoGet: () => Effect.succeed([{ content: "Map retry call sites", status: "completed", priority: "p1" }]),
      todoSet: () => Effect.void,
      llm: {} as LLM.Interface,
      model,
      user,
      sessionID,
      cwd: tmp.path,
      ocxVerifyLadder: false,
      ocxReviewEnvelope: false,
      ocxFlakeGate: false,
      ocxPractices: false,
      ocxPatchSelection: false,
      publishActivity: () => Effect.void,
      publishWorkflow: () => Effect.void,
      updatePart: () => Effect.void,
    } satisfies TurnServices

    const first = await Effect.runPromise(BeforeStep.run(services, messages, "user"))
    const second = await Effect.runPromise(BeforeStep.run(services, messages, "user"))
    const repository = OwnerRegistry.repositoryID(tmp.path)

    expect(store.getGraph(repository)?.nodes.filter((node) => node.kind === "task")).toHaveLength(2)
    expect(store.getGraph(repository)?.nodes.find((node) => node.title === "Map retry call sites")?.status).toBe("completed")
    expect(store.getRequirementLedger(repository)).toEqual(requirements)
    expect(first.deltas.some((delta) => delta.includes("=== OCX TASK GRAPH ==="))).toBe(true)
    expect(second.deltas.some((delta) => delta.includes("=== OCX TASK GRAPH ==="))).toBe(false)
  })

  test("injects one matching built-in pack and skips it on the next step", async () => {
    await using tmp = await tmpdir()

    const sessionID = "ses_before_step_practice"
    const key = State.turnKey(sessionID, "user")
    State.setPipeline(key, {
      changed: false,
      polished: "review this TypeScript change",
      strategies: [],
       workflow: { name: "coding", phase: "understand", phases: Workflow.PRESETS.coding.phases },
      notice: undefined,
    })
    State.setHeader(
      key,
       Header.parseHeader({ topic: "Review pack", strategies: [], risks: [], workflow: "coding" }),
    )
    const services = {
      store: OCXDb.memory(),
      todoGet: () => Effect.succeed([]),
      todoSet: () => Effect.void,
      llm: {} as LLM.Interface,
      model,
      user,
      sessionID,
      cwd: tmp.path,
      ocxVerifyLadder: false,
      ocxReviewEnvelope: false,
      ocxFlakeGate: false,
      ocxPractices: true,
      ocxPatchSelection: false,
      publishActivity: () => Effect.void,
      publishWorkflow: () => Effect.void,
      updatePart: () => Effect.void,
    } satisfies TurnServices

    const first = await Effect.runPromise(BeforeStep.run(services, messages, "user"))
    const second = await Effect.runPromise(BeforeStep.run(services, messages, "user"))

    expect(first.deltas.some((delta) => delta.includes("OCX PRACTICE PACK: review-checklist"))).toBe(true)
    expect(State.practiceHitsOf(key)).toEqual(["review-checklist"])
    expect(second.deltas.some((delta) => delta.includes("OCX PRACTICE PACK:"))).toBe(false)
  })

  test("emits todo state once and refreshes it after a status change", async () => {
    const sessionID = "ses_before_step_todos"
    const key = State.turnKey(sessionID, "user")
    State.setPipeline(key, {
      changed: false,
      polished: "finish the task",
      strategies: [],
       workflow: { name: "coding", phase: "plan", phases: Workflow.PRESETS.coding.phases },
      notice: undefined,
    })
    const todos = [{ content: "Finish the task", status: "pending", priority: "p1" }]
    const services = {
      store: OCXDb.memory(),
      todoGet: () => Effect.succeed(todos),
      todoSet: () => Effect.void,
      llm: {} as LLM.Interface,
      model,
      user,
      sessionID,
      cwd: "/tmp",
      ocxVerifyLadder: false,
      ocxReviewEnvelope: false,
      ocxFlakeGate: false,
      ocxPractices: false,
      ocxPatchSelection: false,
      publishActivity: () => Effect.void,
      publishWorkflow: () => Effect.void,
      updatePart: () => Effect.void,
    } satisfies TurnServices

    const first = await Effect.runPromise(BeforeStep.run(services, messages, "user"))
    const second = await Effect.runPromise(BeforeStep.run(services, messages, "user"))
    todos[0]!.status = "completed"
    const third = await Effect.runPromise(BeforeStep.run(services, messages, "user"))

    expect(first.deltas.filter((delta) => delta.includes("=== OCX TODO STATE ==="))).toHaveLength(1)
    expect(second.deltas.some((delta) => delta.includes("=== OCX TODO STATE ==="))).toBe(false)
    expect(third.deltas.some((delta) => delta.includes("[x] Finish the task"))).toBe(true)
  })

  test("clears ephemeral state when a session run ends", () => {
    const sessionID = "ses_before_step_cleanup"
    const key = State.turnKey(sessionID, "user")
    const reminderKey = `${key}:build:current`
    State.markReminderInjected(reminderKey)
    expect(State.isReminderInjected(reminderKey)).toBe(true)
    expect(State.shouldInjectTodoState(key, "todo-state")).toBe(true)

    State.clearSession(sessionID)

    expect(State.isReminderInjected(reminderKey)).toBe(false)
    expect(State.shouldInjectTodoState(key, "todo-state")).toBe(true)
  })

  test("does not rewrite an existing reasoning topic during header processing", async () => {
    const sessionID = "ses_before_step_topic"
    const key = State.turnKey(sessionID, "user")
    const reasoning = {
      id: "reasoning",
      messageID: "assistant",
      sessionID,
      type: "reasoning",
      text: "reasoning text",
      time: { start: 1, end: 2 },
      metadata: { ocx: { topic: "Initial auth flow" } },
    } as unknown as SessionV1.ReasoningPart
    const input = [
      { info: { role: "user", id: "user" }, parts: [] },
      { info: { role: "assistant", id: "assistant" }, parts: [reasoning] },
    ] as unknown as SessionV1.WithParts[]
    State.setPipeline(key, {
      changed: false,
      polished: "review this TypeScript change",
      strategies: [],
       workflow: { name: "coding", phase: "understand", phases: Workflow.PRESETS.coding.phases },
      notice: undefined,
    })
    State.setHeader(
      key,
       Header.parseHeader({ topic: "Header auth flow", strategies: [], risks: [], workflow: "coding" }),
    )
    const updates: SessionV1.Part[] = []
    const services = {
      store: OCXDb.memory(),
      todoGet: () => Effect.succeed([]),
      todoSet: () => Effect.void,
      llm: {} as LLM.Interface,
      model,
      user,
      sessionID,
      cwd: "/tmp",
      ocxVerifyLadder: false,
      ocxReviewEnvelope: false,
      ocxFlakeGate: false,
      ocxPractices: false,
      ocxPatchSelection: false,
      publishActivity: () => Effect.void,
      publishWorkflow: () => Effect.void,
      updatePart: (part: SessionV1.Part) => Effect.sync(() => void updates.push(part)),
    } satisfies TurnServices

    await Effect.runPromise(BeforeStep.run(services, input, "user"))

    expect(reasoning.metadata?.ocx?.topic).toBe("Initial auth flow")
    expect(updates).toHaveLength(0)
  })

  test("records a differing workflow header as a proposal without changing active state", async () => {
    const sessionID = "ses_before_step_workflow_proposal"
    const key = State.turnKey(sessionID, "user")
    const store = OCXDb.memory()
    store.set(sessionID, {
      workflow: "coding",
      phase: "understand",
      phases: Workflow.PRESETS.coding.phases,
      status: "active",
      requirements: [],
    })
    State.setPipeline(key, {
      changed: false,
      polished: "investigate the failure",
      strategies: [],
      workflow: { name: "coding", phase: "understand", phases: Workflow.PRESETS.coding.phases },
      notice: undefined,
    })
    State.setHeader(
      key,
      Header.parseHeader({
        topic: "Investigate the failure",
        reason: "Failure isolation is needed before changing implementation code.",
        strategies: [],
        risks: [],
        workflow: "debugging",
      }),
    )
    const services = {
      store,
      todoGet: () => Effect.succeed([]),
      todoSet: () => Effect.void,
      llm: {} as LLM.Interface,
      model,
      user,
      sessionID,
      cwd: "/tmp",
      ocxVerifyLadder: false,
      ocxReviewEnvelope: false,
      ocxFlakeGate: false,
      ocxPractices: false,
      ocxPatchSelection: false,
      publishActivity: () => Effect.void,
      publishWorkflow: () => Effect.void,
      updatePart: () => Effect.void,
    } satisfies TurnServices

    const result = await Effect.runPromise(BeforeStep.run(services, messages, "user"))

    expect(store.get(sessionID)?.workflow).toBe("coding")
    expect(store.get(sessionID)?.phase).toBe("understand")
    expect(store.getWorkflowProposal(sessionID)).toMatchObject({
      workflow: "debugging",
      reason: "Failure isolation is needed before changing implementation code.",
      previousWorkflow: "coding",
    })
    expect(result.deltas.some((delta) => delta.includes("RESPONSE OPTIONS: APPROVE | DENY"))).toBe(true)
  })

  test("adopts a fresh header after active and proposal state were cleared", async () => {
    const sessionID = "ses_before_step_fresh_header"
    const key = State.turnKey(sessionID, "user")
    const store = OCXDb.memory()
    store.setWorkflowProposal(sessionID, {
      workflow: "debugging",
      reason: "stale proposal",
    })
    State.setPipeline(key, {
      changed: false,
      polished: "investigate the failure",
      strategies: [],
      workflow: { name: "coding", phase: "understand", phases: Workflow.PRESETS.coding.phases },
      notice: undefined,
    })
    State.setHeader(
      key,
      Header.parseHeader({
        topic: "Investigate the failure",
        reason: "Start a fresh debugging workflow for the new task.",
        strategies: [],
        risks: [],
        workflow: "debugging",
      }),
    )
    const services = {
      store,
      todoGet: () => Effect.succeed([]),
      todoSet: () => Effect.void,
      llm: {} as LLM.Interface,
      model,
      user,
      sessionID,
      cwd: "/tmp",
      ocxVerifyLadder: false,
      ocxReviewEnvelope: false,
      ocxFlakeGate: false,
      ocxPractices: false,
      ocxPatchSelection: false,
      publishActivity: () => Effect.void,
      publishWorkflow: () => Effect.void,
      updatePart: () => Effect.void,
    } satisfies TurnServices

    await Effect.runPromise(BeforeStep.run(services, messages, "user"))

    expect(store.get(sessionID)?.workflow).toBe("debugging")
    expect(store.get(sessionID)?.phase).toBe("reproduce")
    expect(store.getWorkflowProposal(sessionID)).toBeUndefined()
  })

  test("refreshes salience once per phase and again after a phase transition", async () => {
    const sessionID = "ses_before_step_salience"
    const key = State.turnKey(sessionID, "user")
    State.setPipeline(key, {
      changed: false,
      polished: "implement the change",
      strategies: [],
       workflow: { name: "coding", phase: "change", phases: Workflow.PRESETS.coding.phases },
      notice: undefined,
    })
    const services = {
      store: OCXDb.memory(),
      todoGet: () => Effect.succeed([]),
      todoSet: () => Effect.void,
      llm: {} as LLM.Interface,
      model,
      user,
      sessionID,
      cwd: "/tmp",
      ocxVerifyLadder: false,
      ocxReviewEnvelope: false,
      ocxFlakeGate: false,
      ocxPractices: false,
      ocxPatchSelection: false,
      publishActivity: () => Effect.void,
      publishWorkflow: () => Effect.void,
      updatePart: () => Effect.void,
    } satisfies TurnServices

    const first = await Effect.runPromise(BeforeStep.run(services, messages, "user"))
    const second = await Effect.runPromise(BeforeStep.run(services, messages, "user"))
    expect(first.deltas.some((delta) => delta.includes("OCX TASK STATE"))).toBe(false)
    expect(second.deltas.some((delta) => delta.includes("OCX TASK STATE"))).toBe(false)
  })

  test("injects live reasoning control into every model continuation", async () => {
    const sessionID = "ses_before_step_reasoning_control"
    const key = State.turnKey(sessionID, "user")
    const store = OCXDb.memory()
    store.set(sessionID, {
       workflow: "coding",
       phase: "validate",
       phases: Workflow.PRESETS.coding.phases,
    })
    State.setPipeline(key, {
      changed: false,
      polished: "verify the change",
      strategies: [],
       workflow: { name: "coding", phase: "validate", phases: Workflow.PRESETS.coding.phases },
      notice: undefined,
    })
    const services = {
      store,
      todoGet: () => Effect.succeed([]),
      todoSet: () => Effect.void,
      llm: {} as LLM.Interface,
      model,
      user,
      sessionID,
      cwd: "/tmp",
      ocxVerifyLadder: false,
      ocxReviewEnvelope: false,
      ocxFlakeGate: false,
      ocxPractices: false,
      ocxPatchSelection: false,
      publishActivity: () => Effect.void,
      publishWorkflow: () => Effect.void,
      updatePart: () => Effect.void,
    } satisfies TurnServices

    try {
      const first = await Effect.runPromise(BeforeStep.run(services, messages, "user"))
      const second = await Effect.runPromise(BeforeStep.run(services, messages, "user"))
      const firstControl = first.deltas.find((delta) => delta.includes("=== OCX REASONING CONTROL ==="))
      const secondControl = second.deltas.find((delta) => delta.includes("=== OCX REASONING CONTROL ==="))

      expect(firstControl).toContain("protocol=2")
      expect(firstControl).toContain("profile=deep")
      expect(firstControl).toContain("phase=validate")
      expect(firstControl).toContain("recovery=no")
      expect(secondControl).toBeUndefined()
    } finally {
      State.clearSession(sessionID)
    }
  })

  test("activates one persisted workstream step and projects its status", async () => {
    const sessionID = "ses_before_step_plan"
    const key = State.turnKey(sessionID, "user")
    const store = OCXDb.memory()
    store.set(sessionID, {
       workflow: "coding",
       phase: "change",
       phases: Workflow.PRESETS.coding.phases,
    })
    const parsed = PlanWorkstreamState.parseExecutionPlan(
      [
        "goal=Implement the retry guard",
        "workstream=runtime",
        "  goal=Change the runtime boundary",
        "  target=src/session/prompt.ts",
        "  step=Guard retry admission",
        "    target=src/session/prompt.ts",
        "    check=Focused retry test passes",
      ].join("\n"),
    )
    store.set(sessionID, { ...store.get(sessionID)!, plan: parsed.plan! })
    State.setPipeline(key, {
      changed: false,
      polished: "review this TypeScript change",
      strategies: [],
       workflow: { name: "coding", phase: "change", phases: Workflow.PRESETS.coding.phases },
      notice: undefined,
    })
    State.setHeader(
      key,
       Header.parseHeader({ topic: "Implement retry guard", workflow: "coding", strategies: [], risks: [] }),
    )
    const todos: { content: string; status: string; priority: string }[] = []
    const services = {
      store,
      todoGet: () => Effect.succeed(structuredClone(todos)),
      todoSet: (_sessionID: string, items: ReadonlyArray<{ status: string; content: string; priority: string }>) =>
        Effect.sync(() => {
          todos.splice(0, todos.length, ...structuredClone([...items]))
        }),
      llm: {} as LLM.Interface,
      model,
      user,
      sessionID,
      cwd: "/tmp",
      ocxVerifyLadder: false,
      ocxReviewEnvelope: false,
      ocxFlakeGate: false,
      ocxPractices: false,
      ocxPatchSelection: false,
      publishActivity: () => Effect.void,
      publishWorkflow: () => Effect.void,
      updatePart: () => Effect.void,
    } satisfies TurnServices

    try {
      const result = await Effect.runPromise(BeforeStep.run(services, messages, "user"))
      expect(store.get(sessionID)?.plan).toBeDefined()
      expect(result.deltas.some((delta) => delta.includes("OCX TASK STATE"))).toBe(false)
    } finally {
      State.clearSession(sessionID)
    }
  })
})

describe("OCX before-step audit activity", () => {
  test("closes the audit lease when the run completes", async () => {
    const sessionID = "ses_before_step_audit_close"
    const key = State.turnKey(sessionID, "user")
    State.setPipeline(key, {
      changed: false,
      polished: "audit the change",
      strategies: [],
      workflow: { name: "coding", phase: "audit", phases: Workflow.PRESETS.coding.phases },
      notice: undefined,
    })
    State.setHeader(
      key,
      Header.parseHeader({ topic: "Audit pack", strategies: [], risks: [], workflow: "coding" }),
    )
    const calls: unknown[][] = []
    const services = {
      store: OCXDb.memory(),
      todoGet: () => Effect.succeed([]),
      todoSet: () => Effect.void,
      llm: {} as LLM.Interface,
      model,
      user,
      sessionID,
      cwd: "/tmp",
      ocxVerifyLadder: false,
      ocxReviewEnvelope: false,
      ocxFlakeGate: false,
      ocxPractices: false,
      ocxPatchSelection: false,
      publishActivity: (...args: unknown[]) => Effect.sync(() => { calls.push(args) }),
      publishWorkflow: () => Effect.void,
      updatePart: () => Effect.void,
    } satisfies TurnServices

    try {
      await Effect.runPromise(BeforeStep.run(services, messages, "user"))
      expect(calls.some((args) => args[0] === "audit" && args[1] === true)).toBe(true)
      expect(calls.some((args) => args[0] === "audit" && args[1] === false)).toBe(true)
    } finally {
      State.clearSession(sessionID)
    }
  })
})
