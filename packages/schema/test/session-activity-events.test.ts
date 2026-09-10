import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Event } from "../src/event"
import { SessionID } from "../src/session-id"
import { Heartbeat, Updated } from "../src/session-activity"

describe("Schema Activity Events", () => {
  const SessionActivityUpdated = Updated
  const SessionHeartbeat = Heartbeat

  test("SessionActivityUpdated event serializes and matches event type", () => {
    expect(SessionActivityUpdated.type).toBe("session.activity.updated")

    const now = Date.now()
    const activityPayload = {
      sessionID: "ses_abc",
      activityID: "act_xyz",
      type: "tool_execution" as const,
      phase: "change",
      step: { id: "step-1", name: "mutation" },
      target: "src/main.ts",
      detail: "Writing code",
      startedAt: now - 500,
      updatedAt: now,
      heartbeatAt: now,
      status: "running" as const,
    }

    const event = Schema.decodeUnknownSync(SessionActivityUpdated)({
      id: Event.ID.create(),
      type: SessionActivityUpdated.type,
      data: { activity: activityPayload },
    })
    expect(event.type).toBe("session.activity.updated")
    expect(event.data.activity.sessionID).toBe(SessionID.make("ses_abc"))
    expect(event.data.activity.status).toBe("running")
  })

  test("SessionHeartbeat event serializes sessionID and heartbeat timestamp", () => {
    expect(SessionHeartbeat.type).toBe("session.heartbeat")

    const now = Date.now()
    const hb = Schema.decodeUnknownSync(SessionHeartbeat)({
      id: Event.ID.create(),
      type: SessionHeartbeat.type,
      data: {
        sessionID: "ses_hb",
        timestamp: now,
        heartbeatAt: now,
      },
    })

    expect(hb.type).toBe("session.heartbeat")
    expect(hb.data.sessionID).toBe(SessionID.make("ses_hb"))
    expect(hb.data.heartbeatAt).toBe(now)
  })

  test("event definitions can be processed by generic event handlers", () => {
    const receivedEvents: string[] = []
    const dispatch = (evt: { type: string }) => {
      receivedEvents.push(evt.type)
    }

    const e1 = Schema.decodeUnknownSync(SessionHeartbeat)({
      id: Event.ID.create(),
      type: SessionHeartbeat.type,
      data: {
        sessionID: "ses_s1",
        timestamp: 100,
        heartbeatAt: 100,
      },
    })
    dispatch(e1)

    expect(receivedEvents).toContain("session.heartbeat")
  })
})
