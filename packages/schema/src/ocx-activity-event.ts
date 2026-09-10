export * as OCXActivityEvent from "./ocx-activity-event"

import { Schema } from "effect"
import { Event } from "./event"
import { SessionID } from "./session-id"

export const Stage = Schema.Literals(["prepass", "topic", "optimize", "thinking", "workflow", "todo", "guard", "reasoning", "cot"])
export type Stage = Schema.Schema.Type<typeof Stage>

export const Kind = Schema.Literals([
  "thinking",
  "playbook",
  "exploring",
  "research",
  "git",
  "automation",
  "design",
  "review",
  "editing",
  "tool",
  "delegation",
  "recovery",
  "verification",
  "waiting",
  "blocked",
])
export type Kind = Schema.Schema.Type<typeof Kind>

export const State = Schema.Literals([
  "active",
  "completed",
  "failed",
  "blocked",
  "cancelled",
  "superseded",
  "none",
])
export type State = Schema.Schema.Type<typeof State>

export const OwnerType = Schema.Literals([
  "assistant",
  "reasoning",
  "playbook",
  "tool",
  "delegation",
  "verification",
  "recovery",
  "generic",
])
export type OwnerType = Schema.Schema.Type<typeof OwnerType>

export const Projection = Schema.Struct({
  sessionID: SessionID,
  seq: Schema.Int,
  activityID: Schema.NullOr(Schema.String),
  ownerType: OwnerType,
  ownerID: Schema.String,
  kind: Kind,
  state: State,
  title: Schema.optional(Schema.String),
  detail: Schema.optional(Schema.String),
  progressCurrent: Schema.optional(Schema.Finite),
  progressTotal: Schema.optional(Schema.Finite),
  updatedAt: Schema.Finite,
})
export type Projection = Schema.Schema.Type<typeof Projection>

export const Activity = Event.define({
  type: "ocx.activity",
  schema: {
    sessionID: SessionID,
    seq: Schema.optional(Schema.Int),
    activityID: Schema.optional(Schema.NullOr(Schema.String)),
    ownerType: Schema.optional(OwnerType),
    ownerID: Schema.optional(Schema.String),
    kind: Schema.optional(Kind),
    state: Schema.optional(State),
    title: Schema.optional(Schema.String),
    detail: Schema.optional(Schema.String),
    progressCurrent: Schema.optional(Schema.Finite),
    progressTotal: Schema.optional(Schema.Finite),
    updatedAt: Schema.optional(Schema.Finite),
    stage: Schema.optional(Stage),
    active: Schema.optional(Schema.Boolean),
    summary: Schema.optional(Schema.String),
  },
})
