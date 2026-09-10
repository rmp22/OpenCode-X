import { Effect } from "effect"
import type { EventV2 } from "@opencode-ai/core/event"
import { OCXActivityEvent } from "@opencode-ai/schema/ocx-activity-event"
import type { SessionID } from "@opencode-ai/schema/session-id"
import type { ActivityKind, ActivityLease, ActivityOwnerType, ActivityState } from "./types"
import { priorityForKind } from "./types"

export type RuntimeState = {
  leases: Map<string, ActivityLease>
  lastEmittedProjection: Map<string, string>
  seq: Map<string, number>
  lastActivityID?: string
  lastHeartbeatAt?: number
  lastEvidenceAt?: number
  isStalled?: boolean
  lastEmittedAt?: number
  lastEmittedState?: string
}

const runtimes = new Map<string, RuntimeState>()
const terminalSessions = new Set<string>()

function key(sessionID: string): string {
  return sessionID
}

function getState(sessionID: string): RuntimeState {
  let st = runtimes.get(key(sessionID))
  if (!st) {
    st = { leases: new Map(), lastEmittedProjection: new Map(), seq: new Map() }
    runtimes.set(key(sessionID), st)
  }
  return st
}

function now(): number {
  return Date.now()
}

function makeID(): string {
  return `act_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
}

function findActiveForOwner(st: RuntimeState, ownerType: ActivityOwnerType, ownerID: string): ActivityLease | undefined {
  for (const lease of st.leases.values()) if (lease.ownerType === ownerType && lease.ownerID === ownerID && lease.state === "active") return lease
  return undefined
}

export function createLease(input: {
  sessionID: string
  ownerType: ActivityOwnerType
  ownerID: string
  kind: ActivityKind
  title: string
  detail?: string
  attemptID?: string
  priority?: number
  progressCurrent?: number
  progressTotal?: number
}): ActivityLease {
  const st = getState(input.sessionID)
  if (terminalSessions.has(input.sessionID)) {
    const lease: ActivityLease = {
      id: makeID(),
      sessionID: input.sessionID,
      ...(input.attemptID ? { attemptID: input.attemptID } : {}),
      ownerType: input.ownerType,
      ownerID: input.ownerID,
      kind: input.kind,
      title: sanitizeTitle(input.title),
      ...(input.detail ? { detail: input.detail } : {}),
      priority: input.priority ?? priorityForKind(input.kind),
      state: "superseded",
      startedAt: now(),
      endedAt: now(),
      updatedAt: now(),
      ...(input.progressCurrent !== undefined ? { progressCurrent: input.progressCurrent } : {}),
      ...(input.progressTotal !== undefined ? { progressTotal: input.progressTotal } : {}),
    }
    st.leases.set(lease.id, lease)
    enforceBound(input.sessionID)
    return lease
  }
  const existing = findActiveForOwner(st, input.ownerType, input.ownerID)
  if (existing) {
    existing.title = sanitizeTitle(input.title)
    if (input.detail !== undefined) existing.detail = input.detail
    existing.updatedAt = now()
    if (input.progressCurrent !== undefined) existing.progressCurrent = input.progressCurrent
    if (input.progressTotal !== undefined) existing.progressTotal = input.progressTotal
    if (input.priority !== undefined) existing.priority = input.priority
    supersedeLowerPriority(input.sessionID, existing.priority)
    return existing
  }
  const id = makeID()
  const lease: ActivityLease = {
    id,
    sessionID: input.sessionID,
    ...(input.attemptID ? { attemptID: input.attemptID } : {}),
    ownerType: input.ownerType,
    ownerID: input.ownerID,
    kind: input.kind,
    title: sanitizeTitle(input.title),
    ...(input.detail ? { detail: input.detail } : {}),
    priority: input.priority ?? priorityForKind(input.kind),
    state: "active",
    startedAt: now(),
    updatedAt: now(),
    ...(input.progressCurrent !== undefined ? { progressCurrent: input.progressCurrent } : {}),
    ...(input.progressTotal !== undefined ? { progressTotal: input.progressTotal } : {}),
  }
  st.leases.set(id, lease)
  supersedeLowerPriority(input.sessionID, lease.priority)
  enforceBound(input.sessionID)
  return lease
}

function supersedeLowerPriority(sessionID: string, newPriority: number): void {
  const st = getState(sessionID)
  for (const lease of st.leases.values()) {
    if (lease.state !== "active") continue
    if (lease.priority < newPriority) {
      if ((lease.ownerType === "assistant" || lease.ownerType === "reasoning") && newPriority >= 90) {
        lease.state = "superseded"
        lease.endedAt = now()
        lease.updatedAt = now()
      }
    }
  }
}

export function updateLease(
  sessionID: string,
  leaseID: string,
  patch: Partial<Pick<ActivityLease, "kind" | "title" | "detail" | "progressCurrent" | "progressTotal">>,
): ActivityLease | undefined {
  const st = getState(sessionID)
  const lease = st.leases.get(leaseID)
  if (!lease || lease.state !== "active") return undefined
  const nextKind = patch.kind ?? lease.kind
  const nextTitle = patch.title !== undefined ? sanitizeTitle(patch.title) : lease.title
  const nextDetail = patch.detail !== undefined ? patch.detail : lease.detail
  if (
    nextKind === lease.kind &&
    nextTitle === lease.title &&
    nextDetail === lease.detail &&
    patch.progressCurrent === lease.progressCurrent &&
    patch.progressTotal === lease.progressTotal
  )
    return lease
  if (patch.kind !== undefined) {
    lease.kind = nextKind
    lease.priority = priorityForKind(nextKind)
  }
  if (patch.title !== undefined) {
    if (!nextTitle.trim()) return lease
    lease.title = nextTitle
  }
  if (patch.detail !== undefined) lease.detail = nextDetail
  if (patch.progressCurrent !== undefined) lease.progressCurrent = patch.progressCurrent
  if (patch.progressTotal !== undefined) lease.progressTotal = patch.progressTotal
  lease.updatedAt = now()
  return lease
}

export function completeLease(sessionID: string, leaseID: string, state: ActivityState = "completed"): ActivityLease | undefined {
  const st = getState(sessionID)
  const lease = st.leases.get(leaseID)
  if (!lease) return undefined
  if (lease.state !== "active") return lease
  lease.state = state
  lease.endedAt = now()
  lease.updatedAt = now()
  enforceBound(sessionID)
  return lease
}

export function supersedeLeasesForOwner(sessionID: string, ownerID: string): void {
  const st = getState(sessionID)
  for (const lease of st.leases.values()) {
    if (lease.ownerID === ownerID && lease.state === "active") {
      lease.state = "superseded"
      lease.endedAt = now()
      lease.updatedAt = now()
    }
  }
}

export function beginTurn(sessionID: string): void {
  terminalSessions.delete(sessionID)
}

export function markTerminal(sessionID: string): void {
  terminalSessions.add(sessionID)
  cancelActive(sessionID)
}

export function isTerminal(sessionID: string): boolean {
  return terminalSessions.has(sessionID)
}

export function cancelActive(sessionID: string): void {
  const st = getState(sessionID)
  for (const lease of st.leases.values()) if (lease.state === "active") {
    lease.state = "cancelled"
    lease.endedAt = now()
    lease.updatedAt = now()
  }
}

export function clearTransient(sessionID: string): void {
  terminalSessions.delete(sessionID)
  const st = getState(sessionID)
  for (const lease of st.leases.values()) {
    if (lease.state === "active") {
      lease.state = "cancelled"
      lease.endedAt = now()
      lease.updatedAt = now()
    }
  }
  st.leases.clear()
  st.lastEmittedProjection.clear()
  st.lastActivityID = undefined
}

function enforceBound(sessionID: string): void {
  const st = getState(sessionID)
  const terminals = [...st.leases.values()].filter((l) => l.state !== "active")
  if (terminals.length <= 32) return
  terminals.sort((a, b) => (a.endedAt ?? 0) - (b.endedAt ?? 0))
  const toRemove = terminals.length - 32
  for (let i = 0; i < toRemove; i++) st.leases.delete(terminals[i].id)
}

export function reconcile(sessionID: string, opts: { idle?: boolean; liveOwnerIDs?: Set<string> } = {}): void {
  const st = getState(sessionID)
  if (opts.idle) {
    for (const lease of st.leases.values()) {
      if (lease.state === "active") {
        lease.state = "cancelled"
        lease.endedAt = now()
        lease.updatedAt = now()
      }
    }
    return
  }
  if (opts.liveOwnerIDs) {
    for (const lease of st.leases.values()) {
      if (lease.state === "active" && !opts.liveOwnerIDs.has(lease.ownerID)) {
        lease.state = "superseded"
        lease.endedAt = now()
        lease.updatedAt = now()
      }
    }
  }
  const actives = [...st.leases.values()].filter((l) => l.state === "active")
  if (actives.length > 1) {
    actives.sort((a, b) => b.priority - a.priority || b.startedAt - a.startedAt)
    for (let i = 1; i < actives.length; i++) {
      actives[i].state = "superseded"
      actives[i].endedAt = now()
      actives[i].updatedAt = now()
    }
  }
  enforceBound(sessionID)
}

export function activeLeases(sessionID: string): ActivityLease[] {
  const st = getState(sessionID)
  return [...st.leases.values()].filter((l) => l.state === "active")
}

export function allLeases(sessionID: string): ActivityLease[] {
  const st = getState(sessionID)
  return [...st.leases.values()]
}

export function selectPrimary(sessionID: string): ActivityLease | undefined {
  const actives = activeLeases(sessionID)
  if (actives.length === 0) return undefined
  actives.sort((a, b) => b.priority - a.priority || b.startedAt - a.startedAt)
  return actives[0]
}

export function primaryCount(sessionID: string): number {
  return selectPrimary(sessionID) ? 1 : 0
}

export function publishPrimary(
  sessionID: string,
  events: Pick<EventV2.Interface, "publish">,
): Effect.Effect<void> {
  const st = getState(sessionID)
  const primary = selectPrimary(sessionID)
  const lastKey = st.lastEmittedProjection.get(sessionID)
  if (!primary) {
    if (!lastKey || lastKey.startsWith("none|")) return Effect.void
    const seq = (st.seq.get(sessionID) ?? 0) + 1
    const projection = `none|${seq}`
    if (lastKey === projection) return Effect.void
    st.lastEmittedProjection.set(sessionID, projection)
    st.seq.set(sessionID, seq)
    const previousID = st.lastActivityID
    st.lastActivityID = undefined
    return events
      .publish(OCXActivityEvent.Activity, {
        sessionID: sessionID as unknown as SessionID,
        seq,
        activityID: previousID ?? null,
        ownerType: "generic",
        ownerID: previousID ?? "none",
        kind: "thinking",
        state: "none",
        updatedAt: now(),
      })
      .pipe(Effect.ignore)
  }
  const isStateChange = primary.state !== st.lastEmittedState
  const currentTime = now()
  if (!isStateChange && currentTime - (st.lastEmittedAt ?? 0) < 100) {
    return Effect.void
  }
  const projection = `${primary.id}|${primary.kind}|${primary.title}|${primary.detail ?? ""}|${primary.state}|${primary.priority}|${primary.progressCurrent ?? ""}|${primary.progressTotal ?? ""}`
  if (lastKey === projection) return Effect.void
  const seq = (st.seq.get(sessionID) ?? 0) + 1
  st.lastEmittedProjection.set(sessionID, projection)
  st.seq.set(sessionID, seq)
  st.lastActivityID = primary.id
  st.lastEmittedAt = currentTime
  st.lastEmittedState = primary.state
  return events
    .publish(OCXActivityEvent.Activity, {
      sessionID: primary.sessionID as unknown as SessionID,
      seq,
      activityID: primary.id,
      ownerType: primary.ownerType,
      ownerID: primary.ownerID,
      kind: primary.kind,
      state: primary.state,
      title: primary.title,
      ...(primary.detail ? { detail: primary.detail } : {}),
      ...(primary.progressCurrent !== undefined ? { progressCurrent: primary.progressCurrent } : {}),
      ...(primary.progressTotal !== undefined ? { progressTotal: primary.progressTotal } : {}),
      updatedAt: primary.updatedAt,
    })
    .pipe(Effect.ignore)
}

export function updatePrimaryDetail(sessionID: string, detail: string | undefined): ActivityLease | undefined {
  const primary = selectPrimary(sessionID)
  if (!primary) return undefined
  return updateLease(sessionID, primary.id, { detail: detail ?? "" })
}

export function kindForTool(toolName: string): ActivityKind {
  if (["write", "edit", "apply_patch"].includes(toolName)) return "editing"
  if (toolName === "task") return "delegation"
  if (["webfetch", "websearch"].includes(toolName)) return "research"
  if (["read", "glob", "grep"].includes(toolName)) return "exploring"
  if (["audit", "browser", "ocx_asset", "ocx_render"].includes(toolName)) return "verification"
  return "tool"
}

export function titleForTool(toolName: string, target?: string): string {
  const label = kindForTool(toolName)
    .replace(/^(.)/, (value) => value.toUpperCase())
  return target ? `${label} · ${target}` : label
}

export function publishStage(
  input: { readonly sessionID: string; readonly stage: string; readonly active: boolean; readonly summary?: string },
  events: Pick<EventV2.Interface, "publish">,
): Effect.Effect<void> {
  const isPlaybook = input.stage === "playbook" || (input.summary ? /Playbook/i.test(input.summary) : false)
  const ownerID = isPlaybook ? `playbook:${input.sessionID}` : `stage:${input.stage}`
  let terminal: ActivityLease | undefined
  if (input.active) {
    const match = input.summary?.match(/Playbook\s+(\d+)\/(\d+)\s+·\s+([^\n]+)/)
    const progressCurrent = match ? parseInt(match[1], 10) : undefined
    const progressTotal = match ? parseInt(match[2], 10) : undefined
    createLease({
      sessionID: input.sessionID,
      ownerType: isPlaybook ? "playbook" : "generic",
      ownerID,
      kind: isPlaybook ? "playbook" : kindForStage(input.stage),
      title: titleForStage(input.stage, input.summary),
      ...(input.summary ? { detail: input.summary } : {}),
      ...(progressCurrent !== undefined ? { progressCurrent } : {}),
      ...(progressTotal !== undefined ? { progressTotal } : {}),
    })
  } else {
    const lease = activeLeases(input.sessionID).find((item) => item.ownerID === ownerID)
    if (lease) terminal = completeLease(input.sessionID, lease.id, "completed")
  }
  const state = getState(input.sessionID)
  const completed = terminal
  const terminalEvent = completed
    ? (() => {
        const seq = (state.seq.get(input.sessionID) ?? 0) + 1
        state.seq.set(input.sessionID, seq)
        state.lastEmittedProjection.set(input.sessionID, `${completed.id}|${completed.kind}|${completed.state}|${seq}`)
        state.lastActivityID = completed.id
        return events
          .publish(OCXActivityEvent.Activity, {
            sessionID: input.sessionID as SessionID,
            seq,
            activityID: completed.id,
            ownerType: completed.ownerType,
            ownerID: completed.ownerID,
            kind: completed.kind,
            state: completed.state,
            title: completed.title,
            ...(completed.detail ? { detail: completed.detail } : {}),
            updatedAt: completed.updatedAt,
          })
          .pipe(Effect.ignore)
      })()
    : Effect.void
  return Effect.all([terminalEvent, publishPrimary(input.sessionID, events)], { discard: true })
}

function kindForStage(stage: string): ActivityKind {
  if (stage === "playbook") return "playbook"
  if (["guard", "verify", "fullcheck", "check"].includes(stage)) return "verification"
  if (["research", "gather", "evidence"].includes(stage)) return "research"
  if (["git", "commit", "push", "sync"].includes(stage)) return "git"
  if (["automation", "execute", "run"].includes(stage)) return "automation"
  if (["design", "prototype"].includes(stage)) return "design"
  if (["review", "audit"].includes(stage)) return "review"
  if (stage === "todo" || stage === "cot") return "thinking"
  return "thinking"
}

function titleForStage(stage: string, summary?: string): string {
  if (summary && /^(?:Playbook|Workstream)\s+\d+\/\d+/.test(summary)) return summary
  switch (stage) {
    case "topic":
      return "Intake"
    case "optimize":
      return "Preparing"
    case "thinking":
      return "Thinking"
    case "workflow":
      return "Task routing"
    case "todo":
      return "Planning"
    case "guard":
      return "Verifying"
    case "reasoning":
      return "Thinking"
    case "cot":
      return "Planning"
    default:
      return "Working"
  }
}

export function sanitizeTitle(value: string): string {
  const trimmed = value.trim().replace(/\s+/g, " ")
  if (!trimmed) return "Working"
  if (trimmed.toLowerCase() === "title") return "Working"
  return trimmed
}

export function recordHeartbeat(
  sessionID: string,
  evidence?: { bytesRead?: number; linesModified?: number; toolRuntimeMs?: number },
): number {
  const state = getState(sessionID)
  const now = Date.now()
  state.lastHeartbeatAt = now
  const primary = activeLeases(sessionID)[0]
  if (primary) {
    primary.updatedAt = now
    if (evidence?.toolRuntimeMs) {
      primary.detail = `${primary.detail ?? primary.title} (${Math.round(evidence.toolRuntimeMs / 1000)}s)`
    }
  }
  return now
}

export function recordActiveWorkEvidence(
  sessionID: string,
  _type: "token" | "process_output" | "tool_event",
  _bytesOrCount = 1,
): void {
  const state = getState(sessionID)
  state.lastEvidenceAt = Date.now()
  state.isStalled = false
}

export function isSessionStalled(
  sessionID: string,
  thresholdMs = 30000,
  now = Date.now(),
): boolean {
  const leases = activeLeases(sessionID)
  if (leases.length === 0) return false
  const state = getState(sessionID)
  const primary = leases[0]
  const lastActive = Math.max(
    state.lastHeartbeatAt ?? 0,
    state.lastEvidenceAt ?? 0,
    primary.updatedAt,
    primary.startedAt,
  )
  const elapsed = now - lastActive
  const stalled = elapsed > thresholdMs
  if (stalled) {
    state.isStalled = true
  }
  return stalled
}

export function clearStalledOnUserSteering(sessionID: string): void {
  const state = getState(sessionID)
  state.isStalled = false
  state.lastEvidenceAt = Date.now()
}

export function triggerStallRecovery(
  sessionID: string,
): { stalled: boolean; action: "cancel_tool" | "interrupt_fiber" | "surface_to_user"; message?: string } {
  const state = getState(sessionID)
  const stalled = state.isStalled || isSessionStalled(sessionID)
  if (stalled) {
    state.isStalled = true
    const primary = activeLeases(sessionID)[0]
    const recovery = {
      stalled: true,
      action: "cancel_tool" as const,
      message: `Operation stalled on ${primary?.title ?? "current task"}: no progress evidence or heartbeat received for > 30 seconds.`,
    }
    return recovery
  }
  const recovery = {
    stalled: false,
    action: "surface_to_user" as const,
  }
  return recovery
}

export function openActivity(
  sessionID: string,
  activityID: string,
  options?: {
    readonly title?: string
    readonly kind?: string
    readonly phase?: string
    readonly priority?: number
    readonly target?: string
    readonly detail?: string
  },
): ActivityLease {
  const st = getState(sessionID)
  const existing = st.leases.get(activityID)
  if (existing) {
    existing.title = sanitizeTitle(options?.title ?? existing.title)
    if (options?.detail !== undefined) existing.detail = options.detail
    existing.updatedAt = now()
    if (options?.priority !== undefined) existing.priority = options.priority
    existing.state = "active"
    return existing
  }
  const kind = (options?.kind as ActivityKind) ?? "tool"
  const lease: ActivityLease = {
    id: activityID,
    sessionID,
    ownerType: "generic",
    ownerID: activityID,
    kind,
    title: sanitizeTitle(options?.title ?? activityID),
    ...(options?.detail ? { detail: options.detail } : options?.target ? { detail: `target: ${options.target}` } : {}),
    priority: options?.priority ?? priorityForKind(kind),
    state: "active",
    startedAt: now(),
    updatedAt: now(),
  }
  st.leases.set(activityID, lease)
  supersedeLowerPriority(sessionID, lease.priority)
  enforceBound(sessionID)
  return lease
}

export function updateActivity(
  sessionID: string,
  activityID: string,
  patch: Partial<Pick<ActivityLease, "kind" | "title" | "detail" | "progressCurrent" | "progressTotal">>,
): ActivityLease | undefined {
  return updateLease(sessionID, activityID, patch)
}

export function closeActivity(
  sessionID: string,
  activityID: string,
  status: ActivityState = "completed",
): ActivityLease | undefined {
  return completeLease(sessionID, activityID, status)
}

export function openSubagentActivity(
  sessionID: string,
  parentSessionID: string,
  subagentType: string,
  taskDescription: string,
  parentActivityID?: string,
): ActivityLease {
  openActivity(parentSessionID, `subagent_${sessionID}`, {
    kind: "tool",
    title: `Delegated to ${subagentType}: ${taskDescription}`,
    detail: "Running child agent",
    priority: 80,
  })

  const childLease = openActivity(sessionID, "agent_task", {
    kind: "tool",
    title: `[${subagentType}] ${taskDescription}`,
    detail: "Active",
    priority: 90,
  })

  const enriched: ActivityLease = {
    ...childLease,
    parentSessionID,
    parentActivityID,
    subagentType,
  }
  getState(sessionID).leases.set(childLease.id, enriched)
  return enriched
}

export function completeSubagentActivity(
  sessionID: string,
  parentSessionID: string,
  success: boolean,
  resultSummary?: string,
): void {
  closeActivity(sessionID, "agent_task", success ? "completed" : "failed")
  const detail = success
    ? (resultSummary ? "Completed: " + resultSummary : "Completed")
    : (resultSummary ? "Failed: " + resultSummary : "Failed")
  updateActivity(parentSessionID, `subagent_${sessionID}`, {
    detail,
  })
  closeActivity(parentSessionID, `subagent_${sessionID}`, success ? "completed" : "failed")
}

export function propagateParentCancellation(parentSessionID: string): readonly string[] {
  const cancelledChildSessions: string[] = []
  for (const [sessionID, state] of runtimes.entries()) {
    for (const lease of state.leases.values()) {
      if (lease.parentSessionID === parentSessionID && lease.state === "active") {
        lease.state = "cancelled"
        lease.endedAt = Date.now()
        cancelledChildSessions.push(sessionID)
      }
    }
  }
  closeActivity(parentSessionID, `subagent_${parentSessionID}`, "cancelled")
  return cancelledChildSessions
}

export function reconcileTerminal(
  sessionID: string,
  outcome: "completed" | "failed" | "cancelled" = "completed",
): readonly ActivityLease[] {
  const leases = activeLeases(sessionID)
  const terminated: ActivityLease[] = []
  for (const lease of leases) {
    lease.state = outcome
    lease.endedAt = Date.now()
    terminated.push(lease)
  }
  clearTransient(sessionID)
  return terminated
}

export function reconcileReconnection(
  sessionID: string,
  isTerminal: boolean,
): { readonly active: boolean; readonly primaryActivity?: ActivityLease } {
  if (isTerminal) {
    reconcileTerminal(sessionID)
    const res = { active: false }
    return res
  }
  const primary = selectPrimary(sessionID)
  const res = {
    active: primary !== undefined,
    primaryActivity: primary,
  }
  return res
}

export function recoverOrphanedSessions(activeSessionIDs: readonly string[]): readonly string[] {
  const recovered: string[] = []
  for (const sessionID of activeSessionIDs) {
    reconcileTerminal(sessionID, "failed")
    recovered.push(sessionID)
  }
  return recovered
}

export class ActivityEventThrottler {
  private lastEmitTime = 0

  shouldEmit(isStateChange: boolean, minIntervalMs = 100, now = Date.now()): boolean {
    if (isStateChange) {
      this.lastEmitTime = now
      return true
    }
    const elapsed = now - this.lastEmitTime
    if (elapsed >= minIntervalMs) {
      this.lastEmitTime = now
      return true
    }
    return false
  }

  enqueueWithBounding<T extends { readonly isStateChange?: boolean }>(
    queue: T[],
    event: T,
    maxQueueDepth = 50,
  ): void {
    if (queue.length >= maxQueueDepth && !event.isStateChange) {
      return
    }
    queue.push(event)
  }
}

export function clearAll(): void {
  runtimes.clear()
  terminalSessions.clear()
}

export * as ActivityRuntime from "./runtime"
