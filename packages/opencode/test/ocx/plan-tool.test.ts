import { describe, expect, test } from "bun:test"
import { ContextReadiness } from "../../src/ocx/context/readiness"
import { OCXDb } from "../../src/ocx/ocx-db"
import { PlanWorkstreamState } from "../../src/ocx/plan-workstream-state"
import { createPlanTool, validatePlanText } from "../../src/ocx/plan-tool"
import { WorkstreamRunner } from "../../src/ocx/workstream-runner"

const sessionID = "ses_plan_tool"
const workdir = "/work/project"

const inspected = [
  {
    info: { role: "user", id: "user", time: { created: 1 } },
    parts: [{ type: "text", text: "Implement the retry guard" }],
  },
  {
    info: { role: "assistant", id: "assistant", time: { created: 2 } },
    parts: [
      { type: "tool", tool: "read", state: { status: "completed", input: { filePath: workdir } } },
      { type: "tool", tool: "read", state: { status: "completed", input: { filePath: `${workdir}/AGENTS.md` } } },
    ],
  },
] as never

const planWrapper = [
  "goal=Implement the retry guard",
  "scope=session prompt",
  "workstream=runtime",
  "  goal=Change the runtime boundary",
  "  target=src/session/prompt.ts",
  "  step=Guard retry admission",
  "    target=src/session/prompt.ts",
  "    check=Focused retry test passes",
].join("\n")

function store() {
  const value = OCXDb.memory()
  value.set(sessionID, {
    workflow: "coding",
    phase: "understand",
    phases: [{ id: "understand", goal: "inspect" }, { id: "change", goal: "change" }],
  })
  return value
}

describe("OCX plan admission", () => {
  test("does not admit a plan before context evidence", async () => {
    const value = store()
    const tool = createPlanTool({ sessionID, workdir, messages: [], store: value })
    const result = await tool.execute!({ wrapper: planWrapper }, { toolCallId: "plan-1", messages: [], abortSignal: undefined })
    expect(result.output).toContain("BLOCK")
    expect(value.get(sessionID)?.plan).toBeUndefined()
  })

  test("accepts a concrete plan after inspection evidence", async () => {
    expect(ContextReadiness.isContextReady(inspected, workdir)).toBe(true)
    const value = store()
    const tool = createPlanTool({ sessionID, workdir, messages: inspected, store: value })
    const result = await tool.execute!({ wrapper: planWrapper }, { toolCallId: "plan-2", messages: [], abortSignal: undefined })
    expect(result.output).toContain("OK")
    expect(value.get(sessionID)?.phase).toBe("change")
    expect(value.get(sessionID)?.plan?.workstreams[0]?.steps[0]?.status).toBe("ready")
  })

  test("rejects a generic step even when context is ready", async () => {
    const value = store()
    const tool = createPlanTool({ sessionID, workdir, messages: inspected, store: value })
    const result = await tool.execute!({
      wrapper: [
        "goal=Implement the retry guard",
        "workstream=runtime",
        "  goal=Change the runtime boundary",
        "  step=Create CSS",
        "    target=src/session/prompt.ts",
        "    check=Focused retry test passes",
      ].join("\n"),
    }, { toolCallId: "plan-3", messages: [], abortSignal: undefined })
    expect(result.output).toContain("INPUT_INVALID")
    expect(value.get(sessionID)?.plan).toBeUndefined()
  })

  test("invalid wrapper names each error and the nesting rule", async () => {
    const value = store()
    const tool = createPlanTool({ sessionID, workdir, messages: inspected, store: value })
    const result = await tool.execute!({
      wrapper: [
        "goal=build_transient_houses_landing_page workstream=design_build target=/tmp/x steps=[1. download_images]",
        "workstream=design_build",
        "target=/tmp/x",
      ].join("\n"),
    }, { toolCallId: "plan-hint", messages: [], abortSignal: undefined })
    expect(result.output).toContain("INPUT_INVALID")
    expect(result.output).toContain("hint=")
    expect(result.output).toContain("step=")
  })

  test("validatePlanText dry-runs without a store", () => {
    expect(validatePlanText("")).not.toEqual([])
    expect(validatePlanText(planWrapper)).toEqual([])
  })

  test("accepts an empty greenfield root inspection without requiring a nonexistent rules file", () => {
    const greenfield = [
      {
        info: { role: "assistant", id: "assistant", time: { created: 1 } },
        parts: [{
          type: "tool",
          tool: "glob",
          state: { status: "completed", input: { pattern: "*" }, output: "No files found" },
        }],
      },
    ] as never
    const result = ContextReadiness.inspect(greenfield, workdir)
    expect(result.ready).toBe(true)
    expect(result.greenfield).toBe(true)
  })

  test("accepts the weak-model one-step workstream form and derives the workstream goal", () => {
    const parsed = PlanWorkstreamState.parseExecutionPlan([
      "goal=Build the landing page",
      "workstream=assets",
      "  target=assets/",
      "  step=Download house images locally",
      "  check=Downloaded files exist under assets/",
    ].join("\n"))
    expect(parsed.errors).toEqual([])
    expect(parsed.plan?.workstreams[0]?.goal).toContain("Download house images locally")
    expect(parsed.plan?.workstreams[0]?.steps[0]?.checks[0]?.description).toBe(
      "Downloaded files exist under assets/",
    )
  })

  test("rejects OCX control-plane work as execution-plan steps", () => {
    const parsed = PlanWorkstreamState.parseExecutionPlan([
      "goal=Build the landing page",
      "workstream=design",
      "  goal=Prepare the design direction",
      "  step=Load design/ui/web-design/frontend/fonts strategies",
      "    target=strategies",
      "    check=strategies loaded",
    ].join("\n"))
    expect(parsed.plan).toBeUndefined()
    expect(parsed.errors.some((error) => error.message.includes("control-plane") || error.message.includes("user/project"))).toBe(true)
  })

  test("rejects completion status in plan input", () => {
    const parsed = PlanWorkstreamState.parseExecutionPlan([
      "goal=Build the landing page",
      "workstream=page",
      "  target=index.html",
      "  step=Write the landing page",
      "    target=index.html",
      "    check=Page exists",
      "    st=completed",
    ].join("\n"))
    expect(parsed.plan).toBeUndefined()
    expect(parsed.errors.some((error) => error.key === "status")).toBe(true)
  })

  test("splits compact comma-separated plan targets into independent paths", () => {
    const parsed = PlanWorkstreamState.parseExecutionPlan([
      "goal=Build the landing page",
      "workstream=page",
      "  target=index.html, style.css, assets/",
      "  step=Write the landing page",
      "    check=Page exists",
    ].join("\n"))
    expect(parsed.plan?.workstreams[0]?.targets).toEqual(["index.html", "style.css", "assets/"])
    expect(parsed.plan?.workstreams[0]?.steps[0]?.targets).toEqual(["index.html", "style.css", "assets/"])
  })

  test("still requires a concrete target for each step", () => {
    const parsed = PlanWorkstreamState.parseExecutionPlan([
      "goal=Build the landing page",
      "workstream=visual",
      "  goal=Build the visual system",
      "  step=Define the responsive type scale",
      "    check=Type scale is responsive",
    ].join("\n"))
    expect(parsed.plan).toBeUndefined()
    expect(parsed.errors.some((error) => error.key.includes(".target"))).toBe(true)
  })

})

describe("OCX workstream runner", () => {
  test("allows one active step and requires evidence before completion", () => {
    const value = store()
    const parsed = PlanWorkstreamState.parseExecutionPlan(planWrapper)
    expect(parsed.plan).toBeDefined()
    value.set(sessionID, { ...value.get(sessionID)!, plan: parsed.plan! })
    const input = { store: value, sessionID }
    const ready = WorkstreamRunner.nextReadyStep(input)
    expect(ready?.stepID).toBe("guard-retry-admission")
    expect(WorkstreamRunner.activateStep(input, ready!.workstreamID, ready!.stepID)).toBeDefined()
    expect(WorkstreamRunner.allowedTargets(input)).toEqual(["src/session/prompt.ts"])
    WorkstreamRunner.recordMutation(input, "src/session/prompt.ts")
    expect(value.get(sessionID)?.plan?.workstreams[0]?.steps[0]?.status).toBe("verify_required")
    expect(WorkstreamRunner.completeStep(input)).toBeUndefined()
    WorkstreamRunner.recordEvidence(input, {
      check: "Focused retry test passes",
      status: "passed",
      evidence: "bun test test/session/prompt.test.ts passed",
      source: "verification",
    })
    expect(WorkstreamRunner.completeStep(input)).toBeDefined()
  })

  test("does not let a phase-like workstream label impersonate the active step", () => {
    const value = store()
    const parsed = PlanWorkstreamState.parseExecutionPlan(planWrapper)
    value.set(sessionID, { ...value.get(sessionID)!, plan: parsed.plan! })
    const input = { store: value, sessionID }
    const ready = WorkstreamRunner.nextReadyStep(input)!
    WorkstreamRunner.activateStep(input, ready.workstreamID, ready.stepID)

    expect(WorkstreamRunner.matchesActiveStep(input, "runtime", "guard-retry-admission")).toBe(true)
    expect(WorkstreamRunner.matchesActiveStep(input, "selfreview", "done")).toBe(false)
  })

  test("replanning preserves completed step evidence", () => {
    const value = store()
    const parsed = PlanWorkstreamState.parseExecutionPlan(planWrapper)
    value.set(sessionID, { ...value.get(sessionID)!, plan: parsed.plan! })
    const input = { store: value, sessionID }
    const ready = WorkstreamRunner.nextReadyStep(input)!
    WorkstreamRunner.activateStep(input, ready.workstreamID, ready.stepID)
    WorkstreamRunner.recordEvidence(input, {
      check: "Focused retry test passes",
      status: "passed",
      evidence: "focused test passed",
      source: "verification",
    })
    WorkstreamRunner.completeStep(input)

    const result = WorkstreamRunner.updatePlan(input, planWrapper)
    const step = result.plan?.workstreams[0]?.steps[0]
    expect(step?.status).toBe("completed")
    expect(step?.checks[0]?.status).toBe("passed")
    expect(step?.checks[0]?.evidence).toBe("focused test passed")
  })

  test("adding a step reopens a completed workstream", () => {
    const value = store()
    const parsed = PlanWorkstreamState.parseExecutionPlan(planWrapper)
    value.set(sessionID, { ...value.get(sessionID)!, plan: parsed.plan! })
    const input = { store: value, sessionID }
    const ready = WorkstreamRunner.nextReadyStep(input)!
    WorkstreamRunner.activateStep(input, ready.workstreamID, ready.stepID)
    WorkstreamRunner.recordEvidence(input, {
      check: "Focused retry test passes",
      status: "passed",
      evidence: "focused test passed",
    })
    WorkstreamRunner.completeStep(input)

    const result = WorkstreamRunner.updatePlan(
      input,
      [
        "updateWorkstream=runtime",
        "addStep=Review the runtime boundary",
        "target=src/session/prompt.ts",
        "check=Review confirms the boundary remains correct",
      ].join("\n"),
    )
    const workstream = result.plan?.workstreams[0]
    expect(workstream?.status === "ready" || workstream?.status === "active").toBe(true)
    expect(workstream?.steps.at(-1)?.status === "ready" || workstream?.steps.at(-1)?.status === "pending").toBe(true)
  })

  test("does not complete an active step from model-reported checkpoint evidence", () => {
    const value = store()
    const parsed = PlanWorkstreamState.parseExecutionPlan(planWrapper)
    value.set(sessionID, { ...value.get(sessionID)!, plan: parsed.plan! })
    const input = { store: value, sessionID }
    const ready = WorkstreamRunner.nextReadyStep(input)!
    WorkstreamRunner.activateStep(input, ready.workstreamID, ready.stepID)
    WorkstreamRunner.recordPassedEvidence(input, [], ["focused test passed"])
    expect(WorkstreamRunner.remainingChecks(input)).toContain("focused-retry-test-passes: Focused retry test passes")
    expect(WorkstreamRunner.completeActiveStep(input).completed).toBe(false)
  })

  test("completes an active step from trusted verification evidence", () => {
    const value = store()
    const parsed = PlanWorkstreamState.parseExecutionPlan(planWrapper)
    value.set(sessionID, { ...value.get(sessionID)!, plan: parsed.plan! })
    const input = { store: value, sessionID }
    const ready = WorkstreamRunner.nextReadyStep(input)!
    WorkstreamRunner.activateStep(input, ready.workstreamID, ready.stepID)
    WorkstreamRunner.recordVerifiedEvidence(input, {
      check: "focused-retry-test-passes",
      status: "passed",
      evidence: "bun test test/session/prompt.test.ts exited successfully",
      source: "verification",
    })
    expect(WorkstreamRunner.completeActiveStep(input)).toEqual({ completed: true, missing: [] })
  })

  test("allows descendants only for directory-like plan targets", () => {
    const store = OCXDb.memory()
    const sessionID = "ses_plan_target_tree"
    store.set(sessionID, {
      workflow: "coding",
      phase: "change",
      phases: [{ id: "change", goal: "implement" }],
      plan: PlanWorkstreamState.parseExecutionPlan([
        "goal=Build page",
        "workstream=assets",
        "  target=assets/",
        "  step=Download assets",
        "    target=assets/",
        "    target=index.html",
        "    check=Files exist",
      ].join("\n")).plan!,
      done: false,
    } as never)
    const input = { store, sessionID }
    const ready = WorkstreamRunner.nextReadyStep(input)!
    WorkstreamRunner.activateStep(input, ready.workstreamID, ready.stepID)

    expect(WorkstreamRunner.isAllowedTarget(input, "/repo", "/repo/assets/hero.jpg")).toBe(true)
    expect(WorkstreamRunner.isAllowedTarget(input, "/repo", "/repo/index.html")).toBe(true)
    expect(WorkstreamRunner.isAllowedTarget(input, "/repo", "/repo/index.html/child")).toBe(false)
    expect(WorkstreamRunner.isAllowedTarget(input, "/repo", "/repo/other.txt")).toBe(false)
  })


})

describe("OCX plan code-mutation guard", () => {
  const mutationWrapper = [
    "goal=Ground the PowerAdvisor GPU hint contract",
    "workstream=contract",
    "  goal=Ground header, implementation, and test contracts",
    "  target=frameworks/native/services/surfaceflinger/PowerAdvisor/PowerAdvisor.h",
    "  step=Ground the notifyGpuLoadUp contract across header and implementation",
    "    target=frameworks/native/services/surfaceflinger/PowerAdvisor/PowerAdvisor.h",
    "    check=Contract cites header, implementation, and test lines",
    "workstream=implement",
    "  goal=Add the missing GPU hint declaration",
    "  target=frameworks/native/services/surfaceflinger/PowerAdvisor/PowerAdvisor.h",
    "  step=Apply the minimal declaration correction for the supported GPU hint path",
    "    target=PowerAdvisor-declaration",
    "    check=Header declares the override beside notifyCpuLoadUp",
  ].join("\n")

  function documentationStore(sessionID: string) {
    const value = OCXDb.memory()
    value.set(sessionID, {
      workflow: "documentation",
      phase: "understand",
      phases: [{ id: "understand", goal: "inspect" }],
    })
    return value
  }

  test("accepts steps without legacy workflow mutation blocking in agentic workflows", async () => {
    const sessionID = "ses_plan_doc_mutation"
    const value = documentationStore(sessionID)
    const tool = createPlanTool({ sessionID, workdir, messages: inspected, store: value })
    const result = await tool.execute!({ wrapper: mutationWrapper }, { toolCallId: "plan-doc-mutation", messages: [], abortSignal: undefined })
    expect(result.output).toContain("OK")
    expect(value.get(sessionID)?.plan).toBeDefined()
  })

  test("accepts read-only contract steps under a read-only workflow", async () => {
    const sessionID = "ses_plan_doc_contract"
    const value = documentationStore(sessionID)
    const contractOnly = mutationWrapper.split("\n").slice(0, 7).join("\n")
    const tool = createPlanTool({ sessionID, workdir, messages: inspected, store: value })
    const result = await tool.execute!({ wrapper: contractOnly }, { toolCallId: "plan-doc-contract", messages: [], abortSignal: undefined })
    expect(result.output).toContain("OK")
  })
})
