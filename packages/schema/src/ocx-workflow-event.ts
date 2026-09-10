export * as OCXWorkflowEvent from "./ocx-workflow-event"

import { Schema } from "effect"
import { Event } from "./event"
import { SessionID } from "./session-id"

export const Phase = Schema.Struct({
  id: Schema.String,
  goal: Schema.String,
})
export type Phase = Schema.Schema.Type<typeof Phase>

export const Operation = Schema.Struct({
  surface: Schema.String,
  action: Schema.String,
  targets: Schema.optional(Schema.Array(Schema.String)),
})
export type Operation = Schema.Schema.Type<typeof Operation>

export const Updated = Event.define({
  type: "ocx.workflow.updated",
  schema: {
    sessionID: SessionID,
    workflow: Schema.String,
    variant: Schema.optional(Schema.String),
    phase: Schema.String,
    phases: Schema.Array(Phase),
    objective: Schema.optional(Schema.String),
    status: Schema.optional(Schema.Literals(["active", "waiting", "blocked", "complete"])),
    revision: Schema.optional(Schema.Number),
    intentRevision: Schema.optional(Schema.Number),
    operation: Schema.optional(Operation),
  },
})
