import { describe, expect, test } from "bun:test"
import { TurnLifecycleManager, InvalidTurnStateTransitionError } from "@/session/turn-lifecycle"

describe("TurnLifecycleManager", () => {
  test("monotonically transitions through admitted -> executing -> checkpointed -> terminal", () => {
    const manager = new TurnLifecycleManager()
    const sessionID = "sess-1"
    const turnID = "turn-1"

    const record = manager.admit(sessionID, turnID)
    expect(record.state).toBe("admitted")

    manager.transition(turnID, "executing")
    expect(manager.getTurn(turnID)?.state).toBe("executing")

    manager.transition(turnID, "checkpointed")
    expect(manager.getTurn(turnID)?.state).toBe("checkpointed")

    manager.transition(turnID, "terminal")
    expect(manager.getTurn(turnID)?.state).toBe("terminal")

    manager.transition(turnID, "terminal")
    expect(manager.getTurn(turnID)?.state).toBe("terminal")
  })

  test("rejects invalid state transitions", () => {
    const manager = new TurnLifecycleManager()
    manager.admit("sess-2", "turn-2")

    expect(() => {
      manager.transition("turn-2", "checkpointed")
    }).toThrow(InvalidTurnStateTransitionError)
  })

  test("idempotently rehydrates interrupted turns", () => {
    const manager = new TurnLifecycleManager()
    const journalRecord = {
      sessionID: "sess-3",
      turnID: "turn-3",
      state: "executing" as const,
      admittedAt: 1000,
      updatedAt: 1000,
      toolCalls: [
        { callID: "c1", tool: "read", status: "completed" as const, output: "content" },
        { callID: "c2", tool: "edit", status: "running" as const },
      ],
    }

    const firstPass = manager.rehydrate(journalRecord)
    expect(firstPass.state).toBe("terminal")
    expect(firstPass.toolCalls[1].status).toBe("failed")

    const secondPass = manager.rehydrate(firstPass)
    expect(secondPass).toEqual(firstPass)
  })
})
