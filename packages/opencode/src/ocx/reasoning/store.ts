import { ReasoningRuntime } from "./runtime"
import type { ReasoningStatus } from "./status"
import { OCXReasoningStatusEvent } from "@opencode-ai/schema/ocx-reasoning-status-event"
import type { EventV2Bridge } from "@/event-v2-bridge"
import { Effect } from "effect"

const runtimes = new Map<string, ReasoningRuntime>()
const statusBySession = new Map<string, ReasoningStatus>()

function key(sessionID: string): string {
  return sessionID
}

export function getRuntime(sessionID: string): ReasoningRuntime {
  let rt = runtimes.get(key(sessionID))
  if (!rt) {
    rt = new ReasoningRuntime()
    runtimes.set(key(sessionID), rt)
  }
  return rt
}

export function currentStatus(sessionID: string): ReasoningStatus | undefined {
  return statusBySession.get(key(sessionID))
}

function setStatus(sessionID: string, status: ReasoningStatus): void {
  statusBySession.set(key(sessionID), status)
}

export function startStatus(input: { sessionID: string; messageID: string; taskObjective?: string }): ReasoningStatus {
  const rt = getRuntime(input.sessionID)
  const status = rt.start({ sessionID: input.sessionID, messageID: input.messageID, taskObjective: input.taskObjective })
  setStatus(input.sessionID, status)
  return status
}

export function updateFromTool(input: {
  sessionID: string
  messageID: string
  toolName: string
  args?: Record<string, unknown>
  capability?: string
  workflowPhase?: string
  workstreamID?: string
  ownerScope?: string
}): ReasoningStatus {
  const rt = getRuntime(input.sessionID)
  const status = rt.updateFromTool(input)
  setStatus(input.sessionID, status)
  return status
}

export function updateFromModelHint(input: {
  sessionID: string
  messageID: string
  activity?: ReasoningStatus["activity"]
  action: string
  target?: string
  purpose?: string
  workflowPhase?: string
  workstreamID?: string
  currentTool?: string
  currentTarget?: string
}): ReasoningStatus | undefined {
  const rt = getRuntime(input.sessionID)
  const status = rt.updateFromModelHint(input)
  if (status) setStatus(input.sessionID, status)
  return status
}

export function updateFromRecovery(input: { sessionID: string; messageID: string; failureSummary: string; workflowPhase?: string }): ReasoningStatus {
  const rt = getRuntime(input.sessionID)
  const status = rt.updateFromRecovery(input)
  setStatus(input.sessionID, status)
  return status
}

export function updateFromVerification(input: { sessionID: string; messageID: string; target?: string }): ReasoningStatus {
  const rt = getRuntime(input.sessionID)
  const status = rt.updateFromVerification(input)
  setStatus(input.sessionID, status)
  return status
}

export function terminalizeStatus(
  sessionID: string,
  state: "done" | "failed" | "interrupted" = "done",
): ReasoningStatus | undefined {
  const rt = runtimes.get(key(sessionID))
  if (!rt) return undefined
  const status = rt.complete(state)
  if (status) setStatus(sessionID, status)
  return status
}

export function interruptStatus(sessionID: string): ReasoningStatus | undefined {
  return terminalizeStatus(sessionID, "interrupted")
}

export function clearStatus(sessionID: string): void {
  runtimes.delete(key(sessionID))
  statusBySession.delete(key(sessionID))
}

export function publishStatus(status: ReasoningStatus, events: { publish: (...args: any[]) => Effect.Effect<any, any, any> }): Effect.Effect<void> {
  return (events.publish as any)(OCXReasoningStatusEvent.Status, {
    sessionID: status.sessionID as any,
    messageID: status.messageID,
    ...(status.stepID ? { stepID: status.stepID } : {}),
    activity: status.activity,
    title: status.title,
    ...(status.detail ? { detail: status.detail } : {}),
    ...(status.action ? { action: status.action } : {}),
    ...(status.target ? { target: status.target } : {}),
    ...(status.purpose ? { purpose: status.purpose } : {}),
    semanticKey: status.semanticKey,
    source: status.source,
    startedAt: status.startedAt,
    updatedAt: status.updatedAt,
    state: status.state,
  }).pipe(Effect.ignore) as Effect.Effect<void>
}

export function publishCurrent(sessionID: string, events: { publish: (...args: any[]) => Effect.Effect<any, any, any> }): Effect.Effect<void> {
  const st = currentStatus(sessionID)
  if (!st) return Effect.void
  return publishStatus(st, events)
}

export * as ReasoningStore from "./store"
