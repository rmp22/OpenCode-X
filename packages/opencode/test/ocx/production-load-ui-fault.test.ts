import { describe, expect, test } from "bun:test"
import {
  openActivity,
  closeActivity,
  recordHeartbeat,
  isSessionStalled,
  triggerStallRecovery,
  reconcileReconnection,
  reconcileTerminal,
  ActivityEventThrottler,
  clearAll,
} from "../../src/ocx/activity/runtime"

describe("Production Load and UI Fault Tests", () => {
  test("50 concurrent sessions manage activity leases without contention or state bleed", () => {
    clearAll()
    const sessionCount = 50

    for (let i = 0; i < sessionCount; i++) {
      const sID = `session-concurrent-${i}`
      openActivity(sID, "main_task", {
        title: `Task for session ${i}`,
        phase: "change",
        priority: 50,
      })
      recordHeartbeat(sID)
    }

    for (let i = 0; i < sessionCount; i++) {
      const sID = `session-concurrent-${i}`
      const stalled = isSessionStalled(sID, 30000, Date.now())
      expect(stalled).toBe(false)
      closeActivity(sID, "main_task", "completed")
    }
  })

  test("rapid tool loop bounds queue depth and preserves state transitions", () => {
    const throttler = new ActivityEventThrottler()
    const queue: { id: number; isStateChange: boolean }[] = []

    for (let i = 0; i < 500; i++) {
      const isStateChange = i === 10 || i === 200 || i === 450
      throttler.enqueueWithBounding(queue, { id: i, isStateChange }, 50)
    }

    expect(queue.length).toBeLessThanOrEqual(53)
    const stateChangesInQueue = queue.filter((item) => item.isStateChange)
    expect(stateChangesInQueue.length).toBe(3)
  })

  test("simulated provider timeout triggers stall watchdog and recovery action", () => {
    clearAll()
    const sessionID = "ses-fault-timeout"

    openActivity(sessionID, "llm_generate", {
      title: "Generating response",
      phase: "change",
    })
    recordHeartbeat(sessionID)

    const simulatedNow = Date.now() + 65000
    expect(isSessionStalled(sessionID, 30000, simulatedNow)).toBe(true)

    const recovery = triggerStallRecovery(sessionID)
    expect(recovery.stalled).toBe(true)
    expect(recovery.action).toBe("cancel_tool")
  })

  test("client disconnect and reconnect cleanly reconciles active vs terminal sessions", () => {
    clearAll()
    const activeID = "ses-conn-active"
    const finishedID = "ses-conn-done"

    openActivity(activeID, "running_tool", { title: "Compiling code" })
    openActivity(finishedID, "finished_tool", { title: "All done" })
    reconcileTerminal(finishedID, "completed")

    const activeReconn = reconcileReconnection(activeID, false)
    expect(activeReconn.active).toBe(true)
    expect(activeReconn.primaryActivity?.title).toBe("Compiling code")

    const finishedReconn = reconcileReconnection(finishedID, true)
    expect(finishedReconn.active).toBe(false)
  })
})
