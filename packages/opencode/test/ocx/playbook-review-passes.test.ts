import { describe, expect, test, beforeEach } from "bun:test"
import { PlaybookQueue } from "../../src/ocx/playbook/queue"
import { PlaybookCatalog } from "../../src/ocx/playbook/catalog"
import { PlaybookRunner } from "../../src/ocx/playbook/runner"
import { Workflow } from "../../src/ocx/workflow"
import { PlanWorkstreamState } from "../../src/ocx/plan-workstream-state"

beforeEach(() => PlaybookQueue.clearAll())

describe("strategy audit passes & universal audit phase", () => {
  test("all actionable workflow presets contain an audit phase before deliver", () => {
    for (const workflowId of Workflow.WORKFLOW_IDS) {
      const preset = Workflow.preset(workflowId)
      const auditPhase = preset.phases.find((phase) => phase.id === "audit")
      expect(auditPhase).toBeDefined()
      expect(auditPhase?.id).toBe("audit")
      const deliverIndex = preset.phases.findIndex((phase) => phase.family === "deliver")
      const auditIndex = preset.phases.findIndex((phase) => phase.id === "audit")
      expect(auditIndex).toBeLessThan(deliverIndex)
    }
  })

  test("strategy audit pass directive formats with explicit guidance", () => {
    const sid = "ses_audit_test"
    PlaybookQueue.selectPasses({
      sessionID: sid,
      selections: [{ id: "web-design" as any, stage: "verification" }],
    })
    PlaybookQueue.markReadyForStage(sid, "verification")
    const prepared = PlaybookRunner.prepareNextPass({ sessionID: sid, stage: "verification" })
    expect(prepared).toBeDefined()
    expect(prepared!.directive).toContain("=== OCX AUDIT PASS 1/1 · Web Design [verification] ===")
    expect(prepared!.directive).toContain("You have selected this playbook (Web Design). The audit phase requires verifying and auditing your work against every applicable guidance in this playbook:")
    expect(prepared!.directive).toContain("Audit your work and evidence against this playbook.")
    expect(prepared!.directive).toContain("=== END OCX AUDIT PASS 1/1 · Web Design ===")
  })

  test("lenient plan parser accepts plans without explicit goal key", () => {
    const raw = [
      "workstream=design",
      "  goal=Build landing page",
      "  target=src/index.html",
      "  step=Create landing page structure",
      "    target=src/index.html",
      "    check=HTML file created and valid",
    ].join("\n")
    const parsed = PlanWorkstreamState.parseExecutionPlan(raw, { contextReady: true })
    expect(parsed.errors).toHaveLength(0)
    expect(parsed.plan).toBeDefined()
    expect(parsed.plan?.goal).toBe("Build landing page")
    expect(parsed.plan?.workstreams).toHaveLength(1)
  })

  test("lenient plan parser auto-attaches top-level orphan steps to default workstream", () => {
    const raw = [
      "goal=Build application",
      "step=Create application entrypoint",
      "  target=src/main.ts",
      "  check=Entrypoint file exists",
    ].join("\n")
    const parsed = PlanWorkstreamState.parseExecutionPlan(raw, { contextReady: true })
    expect(parsed.errors).toHaveLength(0)
    expect(parsed.plan?.workstreams).toHaveLength(1)
    expect(parsed.plan?.workstreams[0].id).toBe("main")
    expect(parsed.plan?.workstreams[0].steps).toHaveLength(1)
  })

  test("loads one selected playbook per audit pass", () => {
    const sid = "ses_audit_passes"
    PlaybookQueue.clearQueue(sid)
    PlaybookQueue.selectPasses({
      sessionID: sid,
      selectedRevision: "plan-audit",
      selections: [
        { id: "frontier", stage: "pre_implementation" },
        { id: "browser", stage: "pre_implementation" },
      ],
    })
    PlaybookQueue.markReadyForAudit(sid)

    const first = PlaybookRunner.prepareNextPass({ sessionID: sid, mode: "audit" })
    expect(first?.ctx.mode).toBe("audit")
    expect(first?.ctx.playbookID).toBe("frontier")
    expect(first?.directive.match(/=== OCX AUDIT PASS/g)?.length).toBe(1)
    expect(PlaybookQueue.listPasses(sid).map((pass) => Boolean(pass.bodyInjected))).toEqual([true, false])
    expect(PlaybookRunner.prepareNextPass({ sessionID: sid, mode: "audit" })).toBeUndefined()

    const active = PlaybookQueue.activePass(sid)
    expect(active).toBeDefined()
    PlaybookQueue.completePass(sid, active!.passID, "completed")

    const second = PlaybookRunner.prepareNextPass({ sessionID: sid, mode: "audit" })
    expect(second?.ctx.mode).toBe("audit")
    expect(second?.ctx.playbookID).toBe("browser")
    expect(second?.directive.match(/=== OCX AUDIT PASS/g)?.length).toBe(1)
    expect(PlaybookQueue.listPasses(sid).map((pass) => Boolean(pass.bodyInjected))).toEqual([true, true])
    expect(PlaybookQueue.auditComplete(sid)).toBe(false)

    const finalActive = PlaybookQueue.activePass(sid)
    expect(finalActive).toBeDefined()
    PlaybookQueue.completePass(sid, finalActive!.passID, "completed")
    expect(PlaybookQueue.auditComplete(sid)).toBe(true)
  })
})
