export * as SessionActivitySchema from "./session-activity"

import { Schema } from "effect"
import { Event } from "./event"
import { SessionID } from "./session-id"

export const ActivityType = Schema.Literals([
  "tool_execution",
  "reasoning",
  "compaction",
  "verification",
  "subagent",
  "idle",
])
export type ActivityType = Schema.Schema.Type<typeof ActivityType>

export const ActivityStatus = Schema.Literals([
  "running",
  "completed",
  "failed",
  "stalled",
])
export type ActivityStatus = Schema.Schema.Type<typeof ActivityStatus>

export const ActivityStep = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  progress: Schema.optional(Schema.Finite),
})
export type ActivityStep = Schema.Schema.Type<typeof ActivityStep>

export const SessionActivity = Schema.Struct({
  sessionID: SessionID,
  activityID: Schema.String,
  type: ActivityType,
  phase: Schema.String,
  step: ActivityStep,
  target: Schema.String,
  detail: Schema.String,
  startedAt: Schema.Finite,
  updatedAt: Schema.Finite,
  heartbeatAt: Schema.Finite,
  status: ActivityStatus,
})
export type SessionActivity = Schema.Schema.Type<typeof SessionActivity>

export function validateSessionActivity(input: unknown): SessionActivity {
  const decoded = Schema.decodeUnknownSync(SessionActivity)(input)
  if (decoded.updatedAt < decoded.startedAt) {
    throw new Error("Invalid SessionActivity: updatedAt must be greater than or equal to startedAt")
  }
  return decoded
}

export const Updated = Event.define({
  type: "session.activity.updated",
  schema: {
    activity: SessionActivity,
  },
})

export const Heartbeat = Event.define({
  type: "session.heartbeat",
  schema: {
    sessionID: SessionID,
    timestamp: Schema.Finite,
    heartbeatAt: Schema.Finite,
  },
})

export const Definitions = Event.inventory(Updated, Heartbeat)
