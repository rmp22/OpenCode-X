import { describe, expect, test, beforeEach } from "bun:test"
import { Effect } from "effect"
import { WorkflowV2 } from "../../src/ocx/workflow-v2"

describe("Workflow V2 M1 Acceptance Criteria", () => {
  const sessionID = "ses_workflow_v2_test"

  beforeEach(() => {
    WorkflowV2.Db.resetStore()
    WorkflowV2.resetLaneRegistry()
  })

  test("declaring two concurrent lanes from one prompt is one declaration round", () => {
    const session = WorkflowV2.createWorkflowSession(sessionID)

    const declared = session.declareLanes([
      { objective: "Investigate root cause of cache desync", kind: "investigation" },
      { objective: "Add regression tests for cache invalidation", kind: "implementation" },
    ])

    expect(declared.length).toBe(2)
    expect(declared[0]?.kind).toBe("investigation")
    expect(declared[0]?.status).toBe("investigating")
    expect(declared[1]?.kind).toBe("implementation")
    expect(declared[1]?.status).toBe("executing")

    const active = session.listActiveLanes()
    expect(active.length).toBe(2)
    expect(active.map((l) => l.id)).toEqual([declared[0]!.id, declared[1]!.id])
  })

  test("workspace-write during investigation runs and is recorded as a deviation", () => {
    const session = WorkflowV2.createWorkflowSession(sessionID)
    const lane = session.openLane("Investigate auth token expiry", "investigation")

    const readResult = session.executeAction(lane.id, "read", { filePath: "src/auth.ts" })
    expect(readResult.allowed).toBe(true)
    expect(readResult.isDeviation).toBe(false)
    expect(readResult.requiresGate).toBe(false)

    const writeResult = session.executeAction(lane.id, "edit", {
      filePath: "src/auth.ts",
      newString: "fixed",
      oldString: "broken",
    })
    expect(writeResult.allowed).toBe(true)
    expect(writeResult.isDeviation).toBe(true)
    expect(writeResult.deviationReason).toContain("investigation")

    const deviations = WorkflowV2.Db.listDeviations(sessionID, lane.id)
    expect(deviations.length).toBe(1)
    expect(deviations[0]?.kind).toBe("investigation-workspace-write")
  })

  test("blast-radius call mints a gate, freezes the lane, and allows sibling lanes to continue", () => {
    const session = WorkflowV2.createWorkflowSession(sessionID)
    const [laneA, laneB] = session.declareLanes([
      { objective: "Lane A: deploy service", kind: "implementation" },
      { objective: "Lane B: run unit tests", kind: "implementation" },
    ])

    const pushResult = session.executeAction(laneA!.id, "bash", { command: "git push origin main" })
    expect(pushResult.allowed).toBe(false)
    expect(pushResult.requiresGate).toBe(true)
    expect(pushResult.gate).toBeDefined()

    const laneAState = session.getLane(laneA!.id)
    expect(laneAState?.status).toBe("paused")
    expect(laneAState?.activeGateID).toBe(pushResult.gate!.id)

    const laneBState = session.getLane(laneB!.id)
    expect(laneBState?.status).toBe("executing")

    const laneBAction = session.executeAction(laneB!.id, "read", { filePath: "test/auth.test.ts" })
    expect(laneBAction.allowed).toBe(true)
    expect(laneBAction.requiresGate).toBe(false)

    session.signOut(laneB!.id)
    const laneBAfterSignOut = session.getLane(laneB!.id)
    expect(laneBAfterSignOut?.status).toBe("signing_out")

    expect(session.getLane(laneA!.id)?.status).toBe("paused")
  })

  test("natural-language gate answers ('go ahead', 'kill it') resolve correctly", () => {
    expect(WorkflowV2.parseGateAnswer("go ahead")).toBe("go")
    expect(WorkflowV2.parseGateAnswer("yes please proceed")).toBe("go")
    expect(WorkflowV2.parseGateAnswer("looks good, go for it")).toBe("go")
    expect(WorkflowV2.parseGateAnswer("approved")).toBe("go")
    expect(WorkflowV2.parseGateAnswer("lgtm")).toBe("go")

    expect(WorkflowV2.parseGateAnswer("kill it")).toBe("kill")
    expect(WorkflowV2.parseGateAnswer("no, abort the operation")).toBe("kill")
    expect(WorkflowV2.parseGateAnswer("don't push to main")).toBe("kill")
    expect(WorkflowV2.parseGateAnswer("cancel this action")).toBe("kill")
    expect(WorkflowV2.parseGateAnswer("deny")).toBe("kill")

    expect(WorkflowV2.parseGateAnswer("hold on a second")).toBe("hold")
    expect(WorkflowV2.parseGateAnswer("recycle the lane and retry")).toBe("recycle")

    const session = WorkflowV2.createWorkflowSession(sessionID)
    const lane = session.openLane("Database migration", "implementation")
    const actionResult = session.executeAction(lane.id, "bash", { command: "drop table old_records" })
    expect(actionResult.requiresGate).toBe(true)

    const gateID = actionResult.gate!.id
    const resolveResult = session.resolveGate(gateID, "go ahead")
    expect(resolveResult.success).toBe(true)
    expect(resolveResult.resolution?.decision).toBe("go")
    expect(resolveResult.resolution?.resumeToken).toBeDefined()

    const resumedLane = WorkflowV2.resumeLaneFromGate(lane.id, resolveResult.resolution!.resumeToken)
    expect(resumedLane?.status).toBe("executing")
  })

  test("Sign Out failure recycles the lane with the failing item as new input", () => {
    const session = WorkflowV2.createWorkflowSession(sessionID)
    const lane = session.openLane("Refactor auth system", "implementation")

    const run = session.signOut(lane.id)!
    expect(run).toBeDefined()
    expect(session.getLane(lane.id)?.status).toBe("signing_out")

    WorkflowV2.updateChecklistItem(run.id, "typecheck", { pass: true, evidence: "bun typecheck passed" })
    WorkflowV2.updateChecklistItem(run.id, "lint", { pass: true })

    WorkflowV2.updateChecklistItem(run.id, "tests", {
      pass: false,
      evidence: "auth.test.ts failed at line 42",
      reason: "Token signature verification threw expired token error",
    })

    const evaluation = WorkflowV2.evaluateChecklistRun(run.id)
    expect(evaluation.verdict).toBe("fail")
    expect(evaluation.failingItems.length).toBe(1)
    expect(evaluation.failingItems[0]?.id).toBe("tests")

    const recycled = session.recycle(lane.id, evaluation.failingItems[0]!)
    expect(recycled).toBeDefined()
    expect(recycled?.lane.status).toBe("executing")
    expect(recycled?.lane.recycledFrom?.failingItem.id).toBe("tests")
    expect(recycled?.lane.recycledFrom?.failingItem.reason).toContain("expired token error")
    expect(recycled?.newRun.checklistID).toBe("sign-out-audit-recycled")
  })

  test("GateEffect interpreter pauses fiber and resumes on approval or fails on kill", async () => {
    const session = WorkflowV2.createWorkflowSession(sessionID)
    const lane = session.openLane("Deploy cluster", "implementation")

    let pauseCalled = false
    let resumeCalled = false
    let executedAction = false

    const effect = WorkflowV2.executeWithGate(
      lane.id,
      "blast-radius",
      { command: "git push --force" },
      () =>
        Effect.sync(() => {
          executedAction = true
          return "deployment completed"
        }),
      (_pausedLaneID, gate) => {
        pauseCalled = true
        setTimeout(() => {
          WorkflowV2.resolveGate(gate.id, "go ahead")
        }, 10)
      },
      () => {
        resumeCalled = true
      },
    )

    const result = await Effect.runPromise(effect)
    expect(result).toBe("deployment completed")
    expect(pauseCalled).toBe(true)
    expect(resumeCalled).toBe(true)
    expect(executedAction).toBe(true)
  })

  test("Watchdog tracks lane turns, duration, tool calls, and stall detection", () => {
    const watchdog = new WorkflowV2.Watchdog.LaneWatchdog({
      maxTurns: 5,
      maxToolCalls: 10,
      consecutiveStallTurns: 3,
    })

    watchdog.recordTurn(true)
    watchdog.recordToolCall()
    let check = watchdog.check()
    expect(check.exceeded).toBe(false)
    expect(check.stalled).toBe(false)

    watchdog.recordTurn(false)
    watchdog.recordTurn(false)
    watchdog.recordTurn(false)
    check = watchdog.check()
    expect(check.stalled).toBe(true)
    expect(check.reason).toContain("stall detected: 3 consecutive turns")

    watchdog.recordTurn(true)
    watchdog.recordTurn(true)
    check = watchdog.check()
    expect(check.exceeded).toBe(true)
    expect(check.reason).toContain("turn budget exceeded")
  })

  test("loads custom or default project checklist catalogs", () => {
    const defaultCatalog = WorkflowV2.loadProjectChecklist()
    expect(defaultCatalog.length).toBe(6)
    expect(defaultCatalog.map((i) => i.id)).toContain("typecheck")

    const customCatalog = WorkflowV2.loadProjectChecklist([
      { id: "custom-audit", name: "Custom API audit", status: "pending" },
    ])
    expect(customCatalog.length).toBe(1)
    expect(customCatalog[0]?.id).toBe("custom-audit")
  })

  test("generates structured lane debrief summaries", () => {
    const session = WorkflowV2.createWorkflowSession(sessionID)
    const lane = session.openLane("Test debrief generation", "implementation")
    session.signOut(lane.id)

    const debrief = WorkflowV2.getLaneDebrief(lane.id)
    expect(debrief).toBeDefined()
    expect(debrief).toContain("Lane Debrief: Test debrief generation")
    expect(debrief).toContain("Kind: implementation")
  })

  test("research verification pipeline executes paper-to-implementation loop with bounded edges", () => {
    const pipeline = WorkflowV2.Pipelines.createResearchVerificationPipeline({
      paperUrl: "https://arxiv.org/abs/2609.02737",
      maxCycles: 3,
    })

    expect(pipeline.id).toBe("research-verification-pipeline")
    expect(pipeline.initialNodeId).toBe("research:read-spec")
    expect(pipeline.nodes.has("research:read-spec")).toBe(true)
    expect(pipeline.nodes.has("research:check-implementation")).toBe(true)
    expect(pipeline.nodes.has("research:evaluate-gaps")).toBe(true)
    expect(pipeline.nodes.has("research:mutate-repair")).toBe(true)

    const evalNode = pipeline.nodes.get("research:evaluate-gaps")!
    const loopEdge = evalNode.route(
      { status: "success", output: { allRequirementsMet: false }, durationMs: 1 },
      { unmetRequirements: ["missing-block-alignment"] },
      [],
    )
    expect(loopEdge).toEqual({ _tag: "Goto", targetNode: "research:mutate-repair" })

    const completeEdge = evalNode.route(
      { status: "success", output: { allRequirementsMet: true }, durationMs: 1 },
      { unmetRequirements: [], verificationPassed: true },
      [],
    )
    expect(completeEdge).toEqual({ _tag: "Complete", verdict: "completed" })

    const repairNode = pipeline.nodes.get("research:mutate-repair")!
    const cycleEdge = repairNode.route(
      { status: "success", output: { repaired: true }, durationMs: 1 },
      {},
      [],
    )
    expect(cycleEdge._tag).toBe("Loop")
    if (cycleEdge._tag === "Loop") {
      expect(cycleEdge.targetNode).toBe("research:check-implementation")
      expect(cycleEdge.maxCycles).toBe(3)
    }
  })
})
