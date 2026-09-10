import { describe, expect, test } from "bun:test"
import {
  openActivity,
  closeActivity,
  recordHeartbeat,
  recordActiveWorkEvidence,
  isSessionStalled,
  triggerStallRecovery,
  clearAll,
} from "../../src/ocx/activity/runtime"

describe("Runtime Heartbeat and Stall Detection", () => {
  test("heartbeat updates heartbeat timestamp on active lease", () => {
    const sessionID = "ses-hb-1"
    clearAll()

    openActivity(sessionID, "tool_read", {
      title: "Reading configuration",
      phase: "plan",
    })

    const hbTime = recordHeartbeat(sessionID, { bytesRead: 1024, toolRuntimeMs: 2500 })
    expect(hbTime).toBeGreaterThan(0)
    expect(isSessionStalled(sessionID, 30000, hbTime + 1000)).toBe(false)
  })

  test("stall detection triggers when no heartbeat or evidence received past threshold", () => {
    const sessionID = "ses-stall-2"
    clearAll()

    const startTime = 1000000
    openActivity(sessionID, "tool_bash", {
      title: "Compiling binary",
      phase: "verify",
    })

    const hbTime = recordHeartbeat(sessionID)
    expect(isSessionStalled(sessionID, 30000, hbTime + 10000)).toBe(false)

    expect(isSessionStalled(sessionID, 30000, hbTime + 35000)).toBe(true)

    const recovery = triggerStallRecovery(sessionID)
    expect(recovery.stalled).toBe(true)
    expect(recovery.action).toBe("cancel_tool")
    expect(recovery.message).toContain("Operation stalled")
  })

  test("active work evidence prevents false positive stalls during long-running tasks", () => {
    const sessionID = "ses-evidence-3"
    clearAll()

    openActivity(sessionID, "long_model_stream", {
      title: "Streaming response tokens",
      phase: "change",
    })

    recordHeartbeat(sessionID)
    recordActiveWorkEvidence(sessionID, "token", 10)
    expect(isSessionStalled(sessionID, 30000, Date.now())).toBe(false)

    recordActiveWorkEvidence(sessionID, "process_output", 512)
    expect(isSessionStalled(sessionID, 30000, Date.now())).toBe(false)

    closeActivity(sessionID, "long_model_stream")
    expect(isSessionStalled(sessionID, 30000, Date.now() + 60000)).toBe(false)
  })
})
