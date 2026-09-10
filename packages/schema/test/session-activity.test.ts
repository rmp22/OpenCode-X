import { describe, expect, test } from "bun:test"
import { SessionID } from "../src/session-id"
import {
  SessionActivity,
  validateSessionActivity,
} from "../src/session-activity"

describe("Session Activity Contract", () => {
  test("valid activity payload passes schema decoding and validation", () => {
    const now = Date.now()
    const valid = {
      sessionID: "ses_123",
      activityID: "act_456",
      type: "tool_execution",
      phase: "change",
      step: {
        id: "step_1",
        name: "apply patch",
        progress: 0.5,
      },
      target: "src/auth.ts",
      detail: "Editing authentication middleware",
      startedAt: now - 1000,
      updatedAt: now,
      heartbeatAt: now,
      status: "running",
    }

    const decoded = validateSessionActivity(valid)
    expect(decoded.sessionID).toBe(SessionID.make("ses_123"))
    expect(decoded.type).toBe("tool_execution")
    expect(decoded.status).toBe("running")
    expect(decoded.step.progress).toBe(0.5)
  })

  test("missing required fields are rejected", () => {
    const missingType = {
      sessionID: "ses_123",
      activityID: "act_456",
      phase: "change",
      step: { id: "step_1", name: "step" },
      target: "src/foo.ts",
      detail: "Working",
      startedAt: 100,
      updatedAt: 200,
      heartbeatAt: 200,
      status: "running",
    }

    expect(() => validateSessionActivity(missingType)).toThrow()
  })

  test("invalid status or type enum values are rejected", () => {
    const invalidType = {
      sessionID: "ses_123",
      activityID: "act_456",
      type: "invalid_type_not_in_enum",
      phase: "plan",
      step: { id: "step_1", name: "step" },
      target: "target",
      detail: "detail",
      startedAt: 100,
      updatedAt: 200,
      heartbeatAt: 200,
      status: "running",
    }
    expect(() => validateSessionActivity(invalidType)).toThrow()

    const invalidStatus = {
      sessionID: "ses_123",
      activityID: "act_456",
      type: "reasoning",
      phase: "plan",
      step: { id: "step_1", name: "step" },
      target: "target",
      detail: "detail",
      startedAt: 100,
      updatedAt: 200,
      heartbeatAt: 200,
      status: "invalid_status_enum",
    }
    expect(() => validateSessionActivity(invalidStatus)).toThrow()
  })

  test("timestamp consistency rejects updatedAt earlier than startedAt", () => {
    const inconsistentTimes = {
      sessionID: "ses_123",
      activityID: "act_456",
      type: "compaction",
      phase: "verify",
      step: { id: "step_1", name: "step" },
      target: "context",
      detail: "Compacting memory",
      startedAt: 2000,
      updatedAt: 1000,
      heartbeatAt: 2000,
      status: "running",
    }

    expect(() => validateSessionActivity(inconsistentTimes)).toThrow(
      /updatedAt must be greater than or equal to startedAt/,
    )
  })
})
