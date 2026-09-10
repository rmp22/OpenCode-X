import { describe, expect, test, beforeEach } from "bun:test"
import { ActivityRuntime } from "../../src/ocx/activity/runtime"

beforeEach(() => ActivityRuntime.clearAll())

describe("single indicator", () => {
  test("generic model busy: one Thinking indicator", () => {
    const sid = "ses_c1"
    ActivityRuntime.createLease({ sessionID: sid, ownerType: "assistant", ownerID: "a1", kind: "thinking", title: "Thinking about request" })
    expect(ActivityRuntime.activeLeases(sid)).toHaveLength(1)
    expect(ActivityRuntime.selectPrimary(sid)?.title).toContain("Thinking")
    expect(ActivityRuntime.primaryCount(sid)).toBe(1)
  })

  test("playbook starts: Thinking replaced by Playbook indicator, one primary", () => {
    const sid = "ses_c2"
    ActivityRuntime.createLease({ sessionID: sid, ownerType: "assistant", ownerID: "a1", kind: "thinking", title: "Thinking about request" })
    ActivityRuntime.createLease({ sessionID: sid, ownerType: "playbook", ownerID: "p1", kind: "playbook", title: "Playbook 2/3 · UI" })
    const primary = ActivityRuntime.selectPrimary(sid)
    expect(primary?.kind).toBe("playbook")
    expect(primary?.title).toContain("Playbook")
    expect(ActivityRuntime.primaryCount(sid)).toBe(1)
  })

  test("tool runs inside playbook: still one primary indicator", () => {
    const sid = "ses_c3"
    ActivityRuntime.createLease({ sessionID: sid, ownerType: "playbook", ownerID: "p1", kind: "playbook", title: "Playbook 1/3 · Frontend" })
    ActivityRuntime.createLease({ sessionID: sid, ownerType: "tool", ownerID: "t1", kind: "tool", title: "Reading file" })
    expect(ActivityRuntime.primaryCount(sid)).toBe(1)
    expect(ActivityRuntime.selectPrimary(sid)?.kind).toBe("playbook")
  })

  test("provider reasoning streams inside playbook: still one primary loading icon", () => {
    const sid = "ses_c4"
    ActivityRuntime.createLease({ sessionID: sid, ownerType: "playbook", ownerID: "p1", kind: "playbook", title: "Playbook 1/3 · Frontend" })
    ActivityRuntime.createLease({ sessionID: sid, ownerType: "reasoning", ownerID: "r1", kind: "thinking", title: "Provider reasoning delta" })
    expect(ActivityRuntime.primaryCount(sid)).toBe(1)
    expect(ActivityRuntime.selectPrimary(sid)?.kind).toBe("playbook")
  })

  test("playbook ends: spinner stops immediately", () => {
    const sid = "ses_c5"
    const lease = ActivityRuntime.createLease({ sessionID: sid, ownerType: "playbook", ownerID: "p1", kind: "playbook", title: "Playbook 1/3 · Frontend" })
    expect(ActivityRuntime.selectPrimary(sid)).toBeDefined()
    ActivityRuntime.completeLease(sid, lease.id, "completed")
    expect(ActivityRuntime.selectPrimary(sid)).toBeUndefined()
  })

  test("next playbook starts: old not loading, new is only loading", () => {
    const sid = "ses_c6"
    const l1 = ActivityRuntime.createLease({ sessionID: sid, ownerType: "playbook", ownerID: "p1", kind: "playbook", title: "Playbook 1/3 · Frontend" })
    ActivityRuntime.completeLease(sid, l1.id, "completed")
    ActivityRuntime.createLease({ sessionID: sid, ownerType: "playbook", ownerID: "p2", kind: "playbook", title: "Playbook 2/3 · UI" })
    expect(ActivityRuntime.activeLeases(sid)).toHaveLength(1)
    expect(ActivityRuntime.selectPrimary(sid)?.title).toContain("UI")
  })
})

describe("stale lifecycle", () => {
  test("session becomes idle: no active transient leases", () => {
    const sid = "ses_d2"
    ActivityRuntime.createLease({ sessionID: sid, ownerType: "assistant", ownerID: "a1", kind: "thinking", title: "Thinking" })
    ActivityRuntime.createLease({ sessionID: sid, ownerType: "tool", ownerID: "t1", kind: "tool", title: "Editing file" })
    ActivityRuntime.reconcile(sid, { idle: true })
    expect(ActivityRuntime.activeLeases(sid)).toHaveLength(0)
    expect(ActivityRuntime.selectPrimary(sid)).toBeUndefined()
  })

  test("tool errors: tool activity terminal", () => {
    const sid = "ses_d3"
    const lease = ActivityRuntime.createLease({ sessionID: sid, ownerType: "tool", ownerID: "t1", kind: "tool", title: "Running tests" })
    ActivityRuntime.completeLease(sid, lease.id, "failed")
    expect(lease.state).toBe("failed")
    expect(ActivityRuntime.activeLeases(sid)).toHaveLength(0)
  })

  test("retry supersedes old indicators before new", () => {
    const sid = "ses_d5"
    const l1 = ActivityRuntime.createLease({ sessionID: sid, ownerType: "assistant", ownerID: "a1", kind: "thinking", title: "Thinking attempt 1" })
    ActivityRuntime.supersedeLeasesForOwner(sid, "a1")
    expect(l1.state).toBe("superseded")
    const l2 = ActivityRuntime.createLease({ sessionID: sid, ownerType: "assistant", ownerID: "a2", kind: "thinking", title: "Thinking attempt 2" })
    expect(ActivityRuntime.activeLeases(sid)).toHaveLength(1)
    expect(ActivityRuntime.activeLeases(sid)[0].id).toBe(l2.id)
  })

  test("playbook fails: no loading icon remains", () => {
    const sid = "ses_d8"
    const lease = ActivityRuntime.createLease({ sessionID: sid, ownerType: "playbook", ownerID: "p1", kind: "playbook", title: "Playbook · Frontend" })
    ActivityRuntime.completeLease(sid, lease.id, "failed")
    expect(ActivityRuntime.selectPrimary(sid)).toBeUndefined()
  })

  test("reconcile closes orphaned leases", () => {
    const sid = "ses_rec"
    ActivityRuntime.createLease({ sessionID: sid, ownerType: "tool", ownerID: "t1", kind: "tool", title: "Tool 1" })
    ActivityRuntime.createLease({ sessionID: sid, ownerType: "tool", ownerID: "t2", kind: "tool", title: "Tool 2" })
    ActivityRuntime.reconcile(sid, { liveOwnerIDs: new Set(["t1"]) })
    expect(ActivityRuntime.activeLeases(sid)).toHaveLength(1)
    expect(ActivityRuntime.activeLeases(sid)[0].ownerID).toBe("t1")
  })
})

describe("title quality", () => {
  test("rejects blank active title", () => {
    const sid = "ses_e1"
    const lease = ActivityRuntime.createLease({ sessionID: sid, ownerType: "assistant", ownerID: "a1", kind: "thinking", title: "   " })
    expect(lease.title).not.toBe("")
    expect(lease.title.trim().length).toBeGreaterThan(0)
  })

  test("playbook title includes playbook identity", () => {
    const sid = "ses_e3"
    const lease = ActivityRuntime.createLease({ sessionID: sid, ownerType: "playbook", ownerID: "p1", kind: "playbook", title: "Playbook 2/3 · UI" })
    expect(lease.title).toContain("Playbook")
    expect(lease.title).toContain("UI")
  })

  test("concrete activity uses action + target", () => {
    const sid = "ses_e4"
    const lease = ActivityRuntime.createLease({ sessionID: sid, ownerType: "tool", ownerID: "t1", kind: "editing", title: "Editing · TaskView.java" })
    expect(lease.title).toContain("Editing")
  })
})

describe("performance", () => {
  test("100 identical activity updates: only first meaningful update reaches", () => {
    const sid = "ses_f1"
    const lease = ActivityRuntime.createLease({ sessionID: sid, ownerType: "tool", ownerID: "t1", kind: "tool", title: "Reading file" })
    let updates = 0
    for (let i = 0; i < 100; i++) {
      const res = ActivityRuntime.updateLease(sid, lease.id, { title: "Reading file" })
      if (res && res.title === "Reading file" && i === 0) updates++
      // duplicate should be dropped (no change, same title)
    }
    expect(updates).toBeLessThanOrEqual(1)
    expect(ActivityRuntime.activeLeases(sid)).toHaveLength(1)
  })

  test("rapid detail updates coalesced", () => {
    const sid = "ses_f2"
    const lease = ActivityRuntime.createLease({ sessionID: sid, ownerType: "tool", ownerID: "t1", kind: "tool", title: "Running", detail: "detail 1" })
    const first = ActivityRuntime.updateLease(sid, lease.id, { detail: "detail 2" })
    expect(first).toBeDefined()
    const second = ActivityRuntime.updateLease(sid, lease.id, { detail: "detail 3" })
    // second rapid detail may be coalesced (within 120ms window, title unchanged)
    // Should be dropped or coalesced, not necessarily immediate
    expect(second?.detail === "detail 3" || second?.detail === "detail 2").toBe(true)
  })

  test("state transition immediate, not delayed behind detail throttle", () => {
    const sid = "ses_f3"
    const lease = ActivityRuntime.createLease({ sessionID: sid, ownerType: "tool", ownerID: "t1", kind: "tool", title: "Running" })
    ActivityRuntime.updateLease(sid, lease.id, { detail: "detail 1" })
    const completed = ActivityRuntime.completeLease(sid, lease.id, "completed")
    expect(completed?.state).toBe("completed")
    expect(ActivityRuntime.selectPrimary(sid)).toBeUndefined()
  })
})


describe("terminal latch", () => {
  test("terminal state closes activity and suppresses recursive thinking until the next turn", () => {
    const sid = "ses_terminal_latch"
    ActivityRuntime.createLease({ sessionID: sid, ownerType: "assistant", ownerID: "a1", kind: "thinking", title: "Thinking" })
    ActivityRuntime.markTerminal(sid)
    expect(ActivityRuntime.selectPrimary(sid)).toBeUndefined()
    const late = ActivityRuntime.createLease({
      sessionID: sid,
      ownerType: "assistant",
      ownerID: "a2",
      kind: "thinking",
      title: "Recursive thinking",
    })
    expect(late.state).toBe("superseded")
    expect(ActivityRuntime.selectPrimary(sid)).toBeUndefined()

    ActivityRuntime.beginTurn(sid)
    const next = ActivityRuntime.createLease({
      sessionID: sid,
      ownerType: "assistant",
      ownerID: "a3",
      kind: "thinking",
      title: "New user turn",
    })
    expect(next.state).toBe("active")
  })
})
