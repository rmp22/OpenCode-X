import { describe, expect, test } from "bun:test"
import { ProcessGroup, type ProcessHandle } from "@/session/run-state"

describe("ProcessGroup", () => {
  test("registers and unregisters process handles", () => {
    const sessionID = "session-test-pg"
    const handle: ProcessHandle = {
      pid: 12345,
      kill: () => {},
    }

    const unregister = ProcessGroup.register(sessionID, handle)
    unregister()
    ProcessGroup.clear(sessionID)
  })

  test("terminates processes on session cancellation", async () => {
    const sessionID = "session-test-terminate"
    let sigtermSent = false
    let sigkillSent = false
    let cleanedUp = false

    const handle: ProcessHandle = {
      pid: 54321,
      kill: (signal) => {
        if (signal === "SIGTERM") sigtermSent = true
        if (signal === "SIGKILL") sigkillSent = true
      },
      cleanup: () => {
        cleanedUp = true
      },
    }

    ProcessGroup.register(sessionID, handle)
    await ProcessGroup.terminate(sessionID, 50)

    expect(sigtermSent).toBe(true)
    expect(sigkillSent).toBe(true)
    expect(cleanedUp).toBe(true)
  })
})
