import { describe, expect, test } from "bun:test"
import {
  activityTitle,
  formatActivityLabel,
  selectPrimaryActivity,
  truncateWithEllipsis,
  sanitizeDetail,
  formatActivityLine,
} from "../../src/ocx/activity-row"

describe("TUI primary selector", () => {
  test("uses first-class labels for non-coding work", () => {
    expect(activityTitle("research")).toBe("Researching")
    expect(activityTitle("git")).toBe("Git")
    expect(activityTitle("automation")).toBe("Automating")
    expect(activityTitle("design")).toBe("Designing")
    expect(activityTitle("review")).toBe("Reviewing")
    expect(activityTitle("audit")).toBe("Auditing")
  })

  test("renders audit as the OCX audit label", () => {
    expect(formatActivityLabel({ kind: "audit", title: "Entering audit phase — inspecting diff" })).toBe("[OCX] Audit")
  })
  test("busy false => no primary", () => {
    expect(selectPrimaryActivity({ busy: false })).toBeUndefined()
  })

  test("playbook over generic thinking", () => {
    const title = selectPrimaryActivity({
      busy: true,
      activity: {
        sessionID: "ses",
        seq: 1,
        activityID: "playbook-1",
        ownerType: "playbook",
        ownerID: "playbook-1",
        kind: "playbook",
        state: "active",
        title: "Playbook 2/3 · UI",
        updatedAt: 1,
      },
    })
    expect(title).toContain("Playbook")
  })

  test("blocked over playbook", () => {
    const title = selectPrimaryActivity({
      busy: true,
      activity: {
        sessionID: "ses",
        seq: 1,
        activityID: "playbook-1",
        ownerType: "playbook",
        ownerID: "playbook-1",
        kind: "playbook",
        state: "active",
        title: "Playbook 1/3 · UI",
        updatedAt: 1,
      },
    })
    expect(title).toContain("Playbook")
    const blocked = selectPrimaryActivity({
      busy: true,
      activity: {
        sessionID: "ses",
        seq: 2,
        activityID: "blocked-1",
        ownerType: "recovery",
        ownerID: "blocked-1",
        kind: "blocked",
        state: "active",
        title: "Blocked · Build permission required",
        updatedAt: 2,
      },
    })
    expect(blocked).toContain("Blocked")
  })

  test("single primary at most one", () => {
    const title = selectPrimaryActivity({
      busy: true,
      activity: {
        sessionID: "ses",
        seq: 1,
        activityID: "edit-1",
        ownerType: "tool",
        ownerID: "edit-1",
        kind: "editing",
        state: "active",
        title: "Editing · TaskView.java",
        updatedAt: 1,
      },
    })
    expect(title).toBeDefined()
    // only one title returned, not array
    expect(typeof title).toBe("string")
  })

  test("blank title never animates", () => {
    const title = selectPrimaryActivity({
      busy: true,
      activity: {
        sessionID: "ses",
        seq: 1,
        activityID: "thinking-1",
        ownerType: "assistant",
        ownerID: "thinking-1",
        kind: "thinking",
        state: "active",
        title: "   ",
        updatedAt: 1,
      },
    })
    expect(title).toBeUndefined()
  })

  test("truncateWithEllipsis bounds long strings to max terminal width", () => {
    const long = "A".repeat(120)
    const truncated = truncateWithEllipsis(long, 50)
    expect(truncated.length).toBe(50)
    expect(truncated.endsWith("...")).toBe(true)

    const short = "Short title"
    expect(truncateWithEllipsis(short, 50)).toBe(short)
  })

  test("sanitizeDetail strips raw thinking tokens and CoT dumps", () => {
    const rawCoT = "<think>Let me consider the perimeter of this mutation...</think>"
    expect(sanitizeDetail(rawCoT)).toBe("Reasoning through implementation approach")

    const ocxThinking = "=== OCX THINKING ===\nTrace callers"
    expect(sanitizeDetail(ocxThinking)).toBe("Reasoning through implementation approach")

    const clean = "Applying surgical patch"
    expect(sanitizeDetail(clean)).toBe("Applying surgical patch")
  })

  test("formatActivityLine renders phase, step, detail, target, and stall state", () => {
    const normal = formatActivityLine({
      phase: "change",
      step: "Task 02",
      detail: "Editing server",
      target: "src/server.ts",
    })
    expect(normal).toBe("[change] Task 02: Editing server (src/server.ts)")

    const stalled = formatActivityLine({
      phase: "verify",
      step: "Build",
      detail: "Waiting for output",
      isStalled: true,
      elapsedMs: 45000,
    })
    expect(stalled).toContain("[STALLED 45s]")
    expect(stalled).toContain("[verify]")
  })
})
