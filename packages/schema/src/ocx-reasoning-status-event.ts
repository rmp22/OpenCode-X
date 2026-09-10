export * as OCXReasoningStatusEvent from "./ocx-reasoning-status-event"

import { Schema } from "effect"
import { Event } from "./event"
import { SessionID } from "./session-id"
import { optional } from "./schema"

export const Activity = Schema.Literals([
  "thinking",
  "planning",
  "inspecting",
  "searching",
  "editing",
  "running",
  "delegating",
  "waiting",
  "recovering",
  "verifying",
  "finalizing",
])
export type Activity = typeof Activity.Type

export const Source = Schema.Literals(["model", "tool", "workflow", "task", "recovery", "fallback"])
export type Source = typeof Source.Type

export const State = Schema.Literals(["active", "done", "interrupted", "failed"])
export type State = typeof State.Type

export const Status = Event.define({
  type: "ocx.reasoning.status",
  schema: {
    sessionID: SessionID,
    messageID: Schema.String,
    stepID: Schema.optional(Schema.String),
    activity: Activity,
    title: Schema.String,
    detail: Schema.optional(Schema.String),
    action: Schema.optional(Schema.String),
    target: Schema.optional(Schema.String),
    purpose: Schema.optional(Schema.String),
    semanticKey: Schema.String,
    source: Source,
    startedAt: Schema.Finite,
    updatedAt: Schema.Finite,
    state: State,
  },
})
export type Status = typeof Status.Type

export const Definitions = Event.inventory(Status)
