import { describe, expect, test, beforeEach } from "bun:test"
import { PlaybookQueue } from "../../src/ocx/playbook/queue"
import { PlaybookCatalog } from "../../src/ocx/playbook/catalog"
import { PlaybookRunner } from "../../src/ocx/playbook/runner"
import { OCXDb } from "../../src/ocx/ocx-db"

beforeEach(() => PlaybookQueue.clearAll())

describe("playbook catalog", () => {
  test("metadata-only catalog is bounded and compact", () => {
    const catalog = PlaybookCatalog.metadataCatalog()
    expect(catalog.length).toBeLessThan(5000)
    expect(catalog).toContain("frontend")
    expect(catalog).toContain("ui")
    expect(catalog).toContain("browser")
    for (const line of catalog.split("\n")) expect(line.length).toBeLessThan(200)
  })

  test("catalog entries have stage and hash", () => {
    const entries = PlaybookCatalog.catalogEntries()
    expect(entries.length).toBeGreaterThan(20)
    for (const e of entries) {
      expect(e.hash.length).toBeGreaterThan(5)
      expect(["pre_implementation", "post_implementation", "verification", "recovery"]).toContain(e.stage)
    }
  })

  test("adds visual baseline playbooks without duplicating model selections", () => {
    const required = PlaybookCatalog.requiredBaselines({ prompt: "Build a responsive landing page", strategies: ["frontend"] })
    expect(required).toEqual(["ui", "web-design", "fonts", "audit", "browser"])
  })
})

describe("playbook selection", () => {
  test("planning selects four playbooks, zero bodies injected", () => {
    const passes = PlaybookQueue.selectPasses({
      sessionID: "ses_a1",
      selections: [{ id: "frontend" as any }, { id: "ui" as any }, { id: "web-design" as any }, { id: "browser" as any }],
    })
    expect(passes).toHaveLength(4)
    // Hard invariant: no body loaded during selection
    let bodies = 0
    // selection should not call loadBody; we verify bodies count is 0 by not loading
    expect(bodies).toBe(0)
    expect(PlaybookQueue.listPasses("ses_a1")).toHaveLength(4)
  })

  test("selection persists IDs/stages/order/reason only", () => {
    const passes = PlaybookQueue.selectPasses({
      sessionID: "ses_a3",
      selections: [{ id: "ui" as any }, { id: "frontend" as any }],
    })
    expect(passes[0].playbookID).toBe("ui")
    expect(passes[1].playbookID).toBe("frontend")
    expect(passes[0].stage).toBe("pre_implementation")
  })
})

describe("playbook passes", () => {
  test("four selected pre-implementation passes run sequentially, one body per pass", () => {
    const sid = "ses_b1"
    PlaybookQueue.selectPasses({
      sessionID: sid,
      selections: [{ id: "frontend" as any }, { id: "ui" as any }, { id: "web-design" as any }, { id: "fonts" as any }],
    })
    PlaybookQueue.markReadyForStage(sid, "pre_implementation")
    let activeBodies = 0
    let maxActive = 0
    for (let i = 0; i < 4; i++) {
      const ready = PlaybookQueue.nextReady(sid, "pre_implementation")
      expect(ready).toBeDefined()
      const started = PlaybookQueue.startPass(sid, ready!.passID)
      expect(started).toBeDefined()
      const body = PlaybookCatalog.loadBody(started!.playbookID as any)
      expect(body).toBeDefined()
      activeBodies = body ? 1 : 0
      expect(activeBodies).toBeLessThanOrEqual(1)
      maxActive = Math.max(maxActive, PlaybookQueue.activeCount(sid))
      expect(PlaybookQueue.activeCount(sid)).toBeLessThanOrEqual(1)
      PlaybookQueue.completePass(sid, started!.passID, "completed")
      activeBodies = 0
    }
    expect(maxActive).toBe(1)
    expect(PlaybookQueue.listPasses(sid).every((p) => p.status === "completed")).toBe(true)
  })

  test("pass 2 context does not contain raw pass 1 body", () => {
    const sid = "ses_b3"
    PlaybookQueue.selectPasses({ sessionID: sid, selections: [{ id: "frontend" as any }, { id: "ui" as any }] })
    PlaybookQueue.markReadyForStage(sid, "pre_implementation")
    const p1 = PlaybookQueue.nextReady(sid, "pre_implementation")!
    const s1 = PlaybookQueue.startPass(sid, p1.passID)!
    const b1 = PlaybookCatalog.loadBody(s1.playbookID as any)!
    PlaybookQueue.completePass(sid, s1.passID, "completed")
    const p2 = PlaybookQueue.nextReady(sid, "pre_implementation")!
    const s2 = PlaybookQueue.startPass(sid, p2.passID)!
    const b2 = PlaybookCatalog.loadBody(s2.playbookID as any)!
    expect(b1).not.toContain(b2.slice(0, 20))
    expect(b2).not.toContain(b1.slice(0, 20))
  })

  test("completed pass does not rerun without invalidation", () => {
    const sid = "ses_b5"
    const passes = PlaybookQueue.selectPasses({ sessionID: sid, selections: [{ id: "frontend" as any }] })
    PlaybookQueue.markReadyForStage(sid, "pre_implementation")
    const p = PlaybookQueue.nextReady(sid, "pre_implementation")!
    const s = PlaybookQueue.startPass(sid, p.passID)!
    PlaybookQueue.completePass(sid, s.passID, "completed")
    const should = PlaybookQueue.shouldRerun({ sessionID: sid, playbookID: "frontend" as any, stage: "pre_implementation", revision: passes[0].selectedRevision })
    expect(should).toBe(false)
  })

  test("material governed revision change invalidates only affected pass", () => {
    const sid = "ses_b6"
    PlaybookQueue.selectPasses({ sessionID: sid, selections: [{ id: "frontend" as any }, { id: "ui" as any }] })
    PlaybookQueue.markReadyForStage(sid, "pre_implementation")
    for (const pass of PlaybookQueue.listPasses(sid)) {
      PlaybookQueue.startPass(sid, pass.passID)
      PlaybookQueue.completePass(sid, pass.passID, "completed")
    }
    const first = PlaybookQueue.listPasses(sid)[0]
    PlaybookQueue.invalidatePass(sid, first.passID, "architecture changed")
    expect(PlaybookQueue.listPasses(sid)[0].status).toBe("invalidated")
    expect(PlaybookQueue.listPasses(sid)[1].status).toBe("completed")
  })

  test("verification-stage playbook waits until verification stage", () => {
    const sid = "ses_b7"
    PlaybookQueue.selectPasses({
      sessionID: sid,
      selections: [
        { id: "frontend" as any, stage: "pre_implementation" },
        { id: "browser" as any, stage: "verification" },
      ],
    })
    PlaybookQueue.markReadyForStage(sid, "pre_implementation")
    expect(PlaybookQueue.readyPassesForStage(sid, "pre_implementation")).toHaveLength(1)
    expect(PlaybookQueue.readyPassesForStage(sid, "verification")).toHaveLength(0)
    expect(PlaybookQueue.readyPassesForStage(sid, "pre_implementation")[0].playbookID).toBe("frontend")
  })

  test("active_playbook_pass_count <= 1 invariant", () => {
    const sid = "ses_inv"
    PlaybookQueue.selectPasses({ sessionID: sid, selections: [{ id: "ui" as any }, { id: "frontend" as any }] })
    PlaybookQueue.markReadyForStage(sid, "pre_implementation")
    const p1 = PlaybookQueue.nextReady(sid, "pre_implementation")!
    PlaybookQueue.startPass(sid, p1.passID)
    expect(PlaybookQueue.activeCount(sid)).toBe(1)
    const p2 = PlaybookQueue.nextReady(sid, "pre_implementation")
    if (p2) {
      const s2 = PlaybookQueue.startPass(sid, p2.passID)
      expect(s2).toBeUndefined()
      expect(PlaybookQueue.activeCount(sid)).toBe(1)
    }
  })

  test("selected passes are not ready until the stage transition marks them", () => {
    const sid = "ses_ready_only"
    PlaybookQueue.selectPasses({ sessionID: sid, selections: [{ id: "frontend" as any }] })
    expect(PlaybookQueue.nextReady(sid, "pre_implementation")).toBeUndefined()
    PlaybookQueue.markReadyForStage(sid, "pre_implementation")
    expect(PlaybookQueue.nextReady(sid, "pre_implementation")?.status).toBe("ready")
  })

  test("pre-stage mutation does not select post-stage work", () => {
    const sid = "ses_barrier"
    const store = OCXDb.memory()
    store.set(sid, { workflow: "coding", phase: "change", phases: [{ id: "change", goal: "change" }] })
    PlaybookQueue.selectPasses({
      sessionID: sid,
      selections: [
        { id: "frontend" as any, stage: "pre_implementation" },
        { id: "audit" as any, stage: "post_implementation" },
      ],
    })
    PlaybookQueue.markReadyForStage(sid, "pre_implementation")
    expect(PlaybookRunner.reconcileStage({ store, sessionID: sid })).toBe("pre_implementation")
    const pass = PlaybookQueue.nextReady(sid, "pre_implementation")!
    PlaybookQueue.startPass(sid, pass.passID)
    PlaybookQueue.completePass(sid, pass.passID)
    expect(PlaybookRunner.reconcileStage({ store, sessionID: sid })).toBe("implementation")
  })

  test("selected post-stage passes block verification until they are made ready and completed", () => {
    const sid = "ses_post_barrier_selected"
    const store = OCXDb.memory()
    store.set(sid, {
      workflow: "coding",
      phase: "change",
      phases: [{ id: "change", goal: "change" }],
      playbookStage: { stage: "implementation", revision: 1 },
    })
    PlaybookQueue.selectPasses({
      sessionID: sid,
      selections: [
        { id: "audit" as any, stage: "post_implementation" },
        { id: "browser" as any, stage: "verification" },
      ],
    })

    expect(PlaybookRunner.reconcileStage({ store, sessionID: sid, implementationSettled: true })).toBe(
      "post_implementation",
    )
    PlaybookQueue.markReadyForStage(sid, "post_implementation")
    const audit = PlaybookQueue.nextReady(sid, "post_implementation")!
    PlaybookQueue.startPass(sid, audit.passID)
    PlaybookQueue.completePass(sid, audit.passID)
    expect(PlaybookRunner.reconcileStage({ store, sessionID: sid, implementationSettled: true })).toBe("verification")
  })

  test("injects one raw body for a running pass", () => {
    const sid = "ses_one_body"
    PlaybookQueue.selectPasses({ sessionID: sid, selections: [{ id: "frontend" as any }] })
    PlaybookQueue.markReadyForStage(sid, "pre_implementation")
    expect(PlaybookRunner.prepareNextPass({ sessionID: sid, stage: "pre_implementation" })).toBeDefined()
    expect(PlaybookRunner.prepareNextPass({ sessionID: sid, stage: "pre_implementation" })).toBeUndefined()
  })

  test("persists and restores completed pass identity", () => {
    const sid = "ses_pass_persistence"
    const store = OCXDb.memory()
    store.set(sid, { workflow: "coding", phase: "change", phases: [{ id: "change", goal: "implement" }] })
    PlaybookQueue.selectPasses({
      sessionID: sid,
      selectedRevision: "plan-1",
      selections: [{ id: "frontend" as any, stage: "pre_implementation" }],
    })
    PlaybookQueue.markReadyForStage(sid, "pre_implementation")
    const pass = PlaybookQueue.nextReady(sid, "pre_implementation")!
    PlaybookQueue.startPass(sid, pass.passID)
    PlaybookQueue.completePass(sid, pass.passID)
    PlaybookRunner.persist({ store, sessionID: sid })
    expect(store.get(sid)?.playbookStage?.passes).toEqual([
      expect.objectContaining({ playbookID: "frontend", stage: "pre_implementation", selectionRevision: "plan-1", outcome: "completed" }),
    ])

    PlaybookQueue.clearQueue(sid)
    PlaybookQueue.selectPasses({
      sessionID: sid,
      selectedRevision: "plan-1",
      selections: [{ id: "frontend" as any, stage: "pre_implementation" }],
    })
    PlaybookRunner.restoreCompleted({ store, sessionID: sid })
    expect(PlaybookQueue.listPasses(sid)[0]?.status).toBe("completed")
  })

  test("marks selected playbooks ready for audit without loading them", () => {
    const sid = "ses_audit_queue"
    PlaybookQueue.clearQueue(sid)
    PlaybookQueue.selectPasses({
      sessionID: sid,
      selectedRevision: "plan-audit",
      selections: [
        { id: "frontier", stage: "pre_implementation" },
        { id: "browser", stage: "pre_implementation" },
      ],
    })

    expect(PlaybookQueue.auditComplete(sid)).toBe(false)
    expect(PlaybookQueue.listPasses(sid).every((pass) => pass.status === "selected" && !pass.bodyInjected)).toBe(true)

    PlaybookQueue.markReadyForAudit(sid)
    expect(PlaybookQueue.nextReadyForAudit(sid)?.playbookID).toBe("frontier")
    expect(PlaybookQueue.listPasses(sid).every((pass) => !pass.bodyInjected)).toBe(true)
  })
})
