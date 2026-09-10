import { describe, expect, test } from "bun:test"
import {
  openActivity,
  activeLeases,
  reconcileTerminal,
  reconcileReconnection,
  recoverOrphanedSessions,
  clearAll,
} from "../../src/ocx/activity/runtime"

describe("Status Reconciliation and Terminal Cleanup", () => {
  test("terminal transition clears all active leases and marks them completed", () => {
    clearAll()
    const sessionID = "ses-term-1"

    openActivity(sessionID, "task_1", { title: "Building project", phase: "verify" })
    openActivity(sessionID, "task_2", { title: "Running tests", phase: "verify" })
    expect(activeLeases(sessionID).length).toBe(2)

    const terminated = reconcileTerminal(sessionID, "completed")
    expect(terminated.length).toBe(2)
    expect(terminated[0].state).toBe("completed")
    expect(activeLeases(sessionID).length).toBe(0)
  })

  test("reconnection to terminal session returns inactive state", () => {
    clearAll()
    const sessionID = "ses-reconn-2"

    openActivity(sessionID, "task_edit", { title: "Editing code", phase: "change" })
    const activeReconn = reconcileReconnection(sessionID, false)
    expect(activeReconn.active).toBe(true)
    expect(activeReconn.primaryActivity?.title).toBe("Editing code")

    reconcileTerminal(sessionID, "completed")
    const terminalReconn = reconcileReconnection(sessionID, true)
    expect(terminalReconn.active).toBe(false)
    expect(terminalReconn.primaryActivity).toBeUndefined()
  })

  test("daemon restart recovers orphaned active sessions", () => {
    clearAll()
    const s1 = "ses-orphan-1"
    const s2 = "ses-orphan-2"

    openActivity(s1, "task_a", { title: "A" })
    openActivity(s2, "task_b", { title: "B" })

    expect(activeLeases(s1).length).toBe(1)
    expect(activeLeases(s2).length).toBe(1)

    const recovered = recoverOrphanedSessions([s1, s2])
    expect(recovered).toContain(s1)
    expect(recovered).toContain(s2)

    expect(activeLeases(s1).length).toBe(0)
    expect(activeLeases(s2).length).toBe(0)
  })
})
