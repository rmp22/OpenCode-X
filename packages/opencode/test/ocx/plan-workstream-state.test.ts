import { describe, expect, test } from "bun:test"
import { PlanWorkstreamState, createPlanStep, createWorkstream, satisfyPlanStep, canStartStep, primaryCannotIgnoreOwnerWorkstream, busyOwnerDoesNotStallIndependentWork } from "../../src/ocx/plan-workstream-state"

describe("Plans and Workstreams as State", () => {
  test("primary cannot silently ignore an owner-assigned workstream", () => {
    const ws = [createWorkstream({ scope: "SystemUI", owner: "owner-systemui", dependencies: [], workflowState: "implement", writeSet: ["src/systemui/foo.ts"], intentRevision: "r1" })]
    expect(primaryCannotIgnoreOwnerWorkstream(ws)).toBe(true)
  })

  test("busy owner does not stall independent work", () => {
    const ws = [
      createWorkstream({ id: "a", scope: "A", owner: "owner-a", dependencies: [], workflowState: "implement", writeSet: ["a.ts"], status: "RUNNING", intentRevision: "r1" }),
      createWorkstream({ id: "b", scope: "B", owner: "owner-b", dependencies: [], workflowState: "implement", writeSet: ["b.ts"], status: "PENDING", intentRevision: "r1" }),
    ]
    expect(busyOwnerDoesNotStallIndependentWork(ws, "B")).toBe(true)
  })

  test("needs_input becomes WAITING_INPUT", () => {
    const ws = [{ ...createWorkstream({ scope: "x", owner: "o", dependencies: [], workflowState: "s", writeSet: [], intentRevision: "r1" }), status: "NEEDS_INPUT" as any }]
    const out = PlanWorkstreamState.needsInputToWaiting(ws as any)
    expect(out[0].status).toBe("WAITING_INPUT")
  })

  test("plan step dependencies", () => {
    const a = createPlanStep({ objective: "A", expectedEvidence: "a done", dependencies: [], intentRevision: "r1" })
    const b = createPlanStep({ objective: "B", expectedEvidence: "b done", dependencies: [a.id], intentRevision: "r1" })
    expect(canStartStep(a, [a, b])).toBe(true)
    expect(canStartStep(b, [a, b])).toBe(false)
    const afterA = satisfyPlanStep([a, b], a.id)
    expect(canStartStep(afterA.find((s) => s.id === b.id)!, afterA)).toBe(true)
  })

  test("workstream statuses include required states", () => {
    const ws = createWorkstream({ scope: "x", owner: "primary", dependencies: [], workflowState: "implement", writeSet: ["x.ts"], status: "WAITING_INPUT", intentRevision: "r1" })
    expect(ws.status).toBe("WAITING_INPUT")
  })

  test("keeps later dependency-free workstreams pending until earlier workstreams complete", () => {
    const parsed = PlanWorkstreamState.parseExecutionPlan([
      "goal=Build page",
      "workstream=assets",
      "  target=assets",
      "  step=Download project assets",
      "    target=assets",
      "    check=Files exist",
      "workstream=implementation",
      "  target=index.html",
      "  step=Write the landing page",
      "    target=index.html",
      "    check=Page renders",
    ].join("\n"))
    expect(parsed.plan).toBeDefined()
    const plan = parsed.plan!
    expect(PlanWorkstreamState.nextReadyStep(plan)).toMatchObject({ workstreamID: "assets" })
    const second = plan.workstreams[1]!
    expect(second.status).toBe("pending")
    expect(second.steps[0]?.status).toBe("pending")
  })

  test("rejects dependency cycles before plan admission", () => {
    const parsed = PlanWorkstreamState.parseExecutionPlan([
      "goal=Build the page",
      "workstream=page",
      "  step=First step",
      "    dependency=second-step",
      "    check=First check",
      "    target=page/",
      "  step=Second step",
      "    dependency=first-step",
      "    check=Second check",
      "    target=page/",
    ].join("\n"))
    expect(parsed.plan).toBeUndefined()
    expect(parsed.errors.some((error) => error.message.includes("cycle"))).toBe(true)
  })

  test("downgrades legacy completed checks without trusted evidence", () => {
    const plan = PlanWorkstreamState.parseStoredPlan({
      revision: 1,
      goal: "Build the page",
      contextReady: true,
      workstreams: [{
        id: "page",
        goal: "Build the page",
        dependencies: [],
        targets: ["page/"],
        status: "completed",
        steps: [{
          id: "write-page",
          action: "Write the page markup",
          targets: ["page/"],
          dependencies: [],
          status: "completed",
          evidence: ["model said done"],
          mutations: [],
          checks: [{ id: "page-check", description: "Page exists", status: "passed", evidence: "model said done" }],
        }],
      }],
      mutations: [],
      evidence: [{ check: "page-check", status: "passed", evidence: "model said done" }],
    })
    expect(plan?.workstreams[0]?.steps[0]?.checks[0]?.status).toBe("unknown")
    expect(plan?.workstreams[0]?.steps[0]?.status).toBe("verify_required")
    expect(plan?.workstreams[0]?.status).toBe("verifying")
  })

  test("attaches orphan top-level steps to a sole workstream", () => {
    const parsed = PlanWorkstreamState.parseExecutionPlan(
      "goal=build_transient_houses_landing_page workstream=design_build target=/workspace/sample-project/web-design steps=[1. download_images -> 2. create_assets -> 3. write_index -> 4. write_styles -> 5. verify_in_browser] check=rendered_page_has_hero_section+multiple_sections+real_images",
    )
    expect(parsed.errors).toEqual([])
    const plan = parsed.plan!
    expect(plan.workstreams).toHaveLength(1)
    expect(plan.workstreams[0]?.steps).toHaveLength(1)
    expect(plan.workstreams[0]?.steps[0]?.targets).toEqual(["/workspace/sample-project/web-design"])
    expect(plan.workstreams[0]?.steps[0]?.checks).toHaveLength(1)
  })

  test("keeps orphan steps rejected when several workstreams compete", () => {
    const parsed = PlanWorkstreamState.parseExecutionPlan([
      "goal=Build page",
      "workstream=assets",
      "  target=assets",
      "workstream=pages",
      "  target=index.html",
      "step=Download everything",
      "check=Files exist",
      "target=assets",
    ].join("\n"))
    expect(parsed.plan).toBeUndefined()
    expect(parsed.errors.some((error) => error.key.includes(".step"))).toBe(true)
  })

})
