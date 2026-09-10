import { Db } from "./db"
import type { LaneRow } from "./db"
import { Risk } from "./risk"
import type { ActionEffect, RiskProfile } from "./risk"
import { Gate } from "./gate"
import type { GateRecord } from "./gate"
import { Checklist } from "./checklist"
import type { ChecklistItem, ChecklistRun } from "./checklist"
import { Watchdog } from "./watchdog"
import type { LaneBudget } from "./watchdog"
import { UserPromptAnalyzer, type PromptSteeringAnalysis } from "./graph/router"

export type LaneKind = "investigation" | "implementation" | "review" | "custom"

export type LaneStatus =
  | "pending"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled"
  | "declared"
  | "investigating"
  | "executing"
  | "signing_out"
  | "abandoned"

export type Lane = {
  readonly id: string
  readonly sessionID: string
  readonly parentLaneID?: string
  readonly objective: string
  readonly kind: LaneKind
  readonly status: LaneStatus
  readonly risk: RiskProfile
  readonly targetFiles?: readonly string[]
  readonly activeGateID?: string
  readonly activeChecklistRunID?: string
  readonly recycledFrom?: {
    readonly failingItem: ChecklistItem
    readonly previousRunID?: string
  }
  readonly createdAt: number
  readonly updatedAt: number
}

const laneWatchdogs = new Map<string, Watchdog.LaneWatchdog>()
const laneActiveGates = new Map<string, string>()
const laneActiveChecklists = new Map<string, string>()
const laneRecycleHistory = new Map<string, { failingItem: ChecklistItem; previousRunID?: string }>()
const laneTargetFiles = new Map<string, readonly string[]>()
const laneParentMap = new Map<string, string>()

export function openLane(params: {
  sessionID: string
  parentLaneID?: string
  objective: string
  kind?: LaneKind
  risk?: RiskProfile
  budget?: LaneBudget
  targetFiles?: readonly string[]
}): Lane {
  const id = `lane_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const kind = params.kind ?? "implementation"
  const risk = params.risk ?? "standard"
  const initialStatus: LaneStatus = kind === "investigation" ? "investigating" : "executing"
  const now = Date.now()

  const row: LaneRow = {
    id,
    session_id: params.sessionID,
    objective: params.objective,
    kind,
    status: initialStatus,
    risk,
    created_at: now,
    updated_at: now,
  }

  Db.insertLane(row)
  laneWatchdogs.set(id, new Watchdog.LaneWatchdog(params.budget))
  if (params.targetFiles && params.targetFiles.length > 0) {
    laneTargetFiles.set(id, [...params.targetFiles])
  }
  if (params.parentLaneID) {
    laneParentMap.set(id, params.parentLaneID)
  }

  return {
    id,
    sessionID: params.sessionID,
    parentLaneID: params.parentLaneID,
    objective: params.objective,
    kind,
    status: initialStatus,
    risk,
    targetFiles: params.targetFiles ? [...params.targetFiles] : undefined,
    createdAt: now,
    updatedAt: now,
  }
}

export function declareLanes(
  sessionID: string,
  declarations: readonly {
    objective: string
    kind?: LaneKind
    risk?: RiskProfile
    budget?: LaneBudget
    targetFiles?: readonly string[]
  }[],
): Lane[] {
  return declarations.map((decl) => openLane({ sessionID, ...decl }))
}

export function getLane(laneID: string): Lane | undefined {
  const row = Db.getLane(laneID)
  if (!row) return undefined
  return {
    id: row.id,
    sessionID: row.session_id,
    parentLaneID: laneParentMap.get(laneID),
    objective: row.objective,
    kind: row.kind as LaneKind,
    status: row.status as LaneStatus,
    risk: row.risk as RiskProfile,
    targetFiles: laneTargetFiles.get(laneID),
    activeGateID: laneActiveGates.get(laneID),
    activeChecklistRunID: laneActiveChecklists.get(laneID),
    recycledFrom: laneRecycleHistory.get(laneID),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function listLanes(sessionID?: string): Lane[] {
  const rows = Db.listLanes(sessionID)
  return rows.map((row) => ({
    id: row.id,
    sessionID: row.session_id,
    parentLaneID: laneParentMap.get(row.id),
    objective: row.objective,
    kind: row.kind as LaneKind,
    status: row.status as LaneStatus,
    risk: row.risk as RiskProfile,
    targetFiles: laneTargetFiles.get(row.id),
    activeGateID: laneActiveGates.get(row.id),
    activeChecklistRunID: laneActiveChecklists.get(row.id),
    recycledFrom: laneRecycleHistory.get(row.id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }))
}

export function listActiveLanes(sessionID?: string): Lane[] {
  return listLanes(sessionID).filter(
    (lane) => lane.status !== "completed" && lane.status !== "abandoned",
  )
}

export function transitionLane(
  laneID: string,
  targetStatus: LaneStatus,
  reason?: string,
): Lane | undefined {
  const existing = Db.getLane(laneID)
  if (!existing) return undefined

  if (targetStatus === "completed" || targetStatus === "abandoned") {
    laneActiveGates.delete(laneID)
  }

  const updated = Db.updateLane(laneID, {
    status: targetStatus,
    updated_at: Date.now(),
  })
  if (!updated) return undefined

  return getLane(laneID)
}

export function startSignOutAudit(
  laneID: string,
  customItems?: readonly ChecklistItem[],
): ChecklistRun | undefined {
  const lane = getLane(laneID)
  if (!lane) return undefined

  transitionLane(laneID, "signing_out")
  const run = Checklist.createChecklistRun(laneID, "sign-out-audit", customItems)
  laneActiveChecklists.set(laneID, run.id)
  return run
}

export function recycleLane(
  laneID: string,
  failingItem: ChecklistItem,
): { lane: Lane; newRun: ChecklistRun } | undefined {
  const lane = getLane(laneID)
  if (!lane) return undefined

  laneRecycleHistory.set(laneID, {
    failingItem,
    previousRunID: laneActiveChecklists.get(laneID),
  })

  const nextStatus: LaneStatus = lane.kind === "investigation" ? "investigating" : "executing"
  transitionLane(laneID, nextStatus, `recycled due to failing sign-out item: ${failingItem.name}`)

  const newRun = Checklist.createChecklistRun(laneID, "sign-out-audit-recycled")
  laneActiveChecklists.set(laneID, newRun.id)

  const updatedLane = getLane(laneID)!
  return { lane: updatedLane, newRun }
}

export function recordLaneAction(
  laneID: string,
  toolName: string,
  input?: Record<string, unknown>,
): {
  allowed: boolean
  effect: ActionEffect
  isDeviation: boolean
  requiresGate: boolean
  gate?: GateRecord
  deviationReason?: string
} {
  const lane = getLane(laneID)
  if (!lane) {
    return {
      allowed: false,
      effect: "read",
      isDeviation: false,
      requiresGate: false,
    }
  }

  const watchdog = laneWatchdogs.get(laneID)
  if (watchdog) {
    watchdog.recordToolCall()
  }

  const effect = Risk.classifyEffect(toolName, input)

  if (effect === "blast-radius" || effect === "protected") {
    const gate = Gate.mintGate({
      laneID,
      effect,
      payload: { tool: toolName, input: input ?? {} },
    })
    laneActiveGates.set(laneID, gate.id)
    transitionLane(laneID, "paused", `frozen waiting on gate ${gate.id}`)

    return {
      allowed: false,
      effect,
      isDeviation: false,
      requiresGate: true,
      gate,
    }
  }

  const devCheck = Risk.checkInvestigationDeviation(lane.kind, effect)
  if (devCheck.isDeviation) {
    Db.insertDeviation({
      id: `dev_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      session_id: lane.sessionID,
      lane_id: lane.id,
      kind: "investigation-workspace-write",
      detail: { tool: toolName, input: input ?? {} },
      created_at: Date.now(),
    })

    return {
      allowed: true,
      effect,
      isDeviation: true,
      requiresGate: false,
      deviationReason: devCheck.reason,
    }
  }

  return {
    allowed: true,
    effect,
    isDeviation: false,
    requiresGate: false,
  }
}

export function resumeLaneFromGate(laneID: string, token: string): Lane | undefined {
  const lane = getLane(laneID)
  if (!lane || lane.status !== "paused") return lane
  laneActiveGates.delete(laneID)
  const resumeStatus: LaneStatus = lane.kind === "investigation" ? "investigating" : "executing"
  return transitionLane(laneID, resumeStatus, `resumed with token ${token}`)
}

export function getLaneWatchdog(laneID: string): Watchdog.LaneWatchdog | undefined {
  return laneWatchdogs.get(laneID)
}

export function getLaneDebrief(laneID: string): string | undefined {
  const lane = getLane(laneID)
  if (!lane) return undefined
  const runs = lane.activeChecklistRunID ? [Db.getChecklistRun(lane.activeChecklistRunID)] : Db.listChecklistRuns(laneID)
  const lastRun = runs[runs.length - 1]
  const deviations = Db.listDeviations(lane.sessionID, lane.id)
  const watchdog = laneWatchdogs.get(laneID)
  const usage = watchdog?.getUsage()

  const lines = [
    `# Lane Debrief: ${lane.objective}`,
    `- ID: ${lane.id}`,
    `- Kind: ${lane.kind} | Status: ${lane.status} | Risk: ${lane.risk}`,
    `- Duration: ${usage ? usage.elapsedMs : Date.now() - lane.createdAt}ms | Tool calls: ${usage ? usage.toolCalls : 0}`,
    `- Checklist: ${lastRun ? lastRun.verdict : "none"} (${lastRun && Array.isArray(lastRun.items) ? (lastRun.items as any[]).filter((i) => i.status === "pass").length : 0} passed)`,
    `- Deviations: ${deviations.length}`,
    ...(lane.recycledFrom ? [`- Recycled from failure: ${lane.recycledFrom.failingItem.name}`] : []),
  ]
  return lines.join("\n")
}

export function steerWithPrompt(
  sessionID: string,
  promptText: string,
  modelId?: string,
): { readonly lane: Lane; readonly analysis: PromptSteeringAnalysis } {
  const analysis = UserPromptAnalyzer.analyze(promptText, { isOngoingSession: true })
  const activeLanes = listLanes(sessionID).filter((l) => l.status !== "completed" && l.status !== "abandoned")

  if (activeLanes.length > 0) {
    const active = activeLanes[0]
    if (analysis.velocity === "careful" && active.risk !== "critical") {
      Db.updateLane(active.id, { risk: "critical", updated_at: Date.now() })
    }

    const current = getLane(active.id) ?? active
    return { lane: current, analysis }
  }

  const kind: LaneKind = analysis.archetype === "investigation" || analysis.archetype === "audit"
    ? "investigation"
    : "implementation"

  const risk: RiskProfile = analysis.velocity === "fast" ? "routine" : analysis.velocity === "careful" ? "critical" : "standard"

  const newLane = openLane({
    sessionID,
    objective: analysis.intentSummary,
    kind,
    risk,
  })

  return { lane: newLane, analysis }
}

export function checkResourceScopeConflict(
  targetFiles: readonly string[],
  activeLanes: readonly Lane[],
): { hasConflict: boolean; conflictingLaneID?: string; conflictingFile?: string } {
  if (!targetFiles || targetFiles.length === 0) return { hasConflict: false }
  for (const lane of activeLanes) {
    if (!lane.targetFiles || lane.targetFiles.length === 0) continue
    for (const file of targetFiles) {
      if (lane.targetFiles.includes(file)) {
        return { hasConflict: true, conflictingLaneID: lane.id, conflictingFile: file }
      }
    }
  }
  return { hasConflict: false }
}

export function forkLane(
  parentLaneID: string,
  options: {
    readonly objective: string
    readonly kind?: LaneKind
    readonly risk?: RiskProfile
    readonly budget?: LaneBudget
    readonly targetFiles?: readonly string[]
  },
): Lane {
  const parent = getLane(parentLaneID)
  if (!parent) throw new Error(`Parent lane '${parentLaneID}' not found`)
  return openLane({
    sessionID: parent.sessionID,
    parentLaneID,
    objective: options.objective,
    kind: options.kind ?? "investigation",
    risk: options.risk ?? parent.risk,
    budget: options.budget,
    targetFiles: options.targetFiles,
  })
}

export function cancelLane(laneID: string, reason = "Cancelled by user"): Lane | undefined {
  const lane = getLane(laneID)
  if (!lane) return undefined
  laneActiveGates.delete(laneID)
  laneActiveChecklists.delete(laneID)
  return transitionLane(laneID, "cancelled", reason)
}

export interface LaneSchedulerConfig {
  readonly maxConcurrentLanes?: number
}

export class LaneScheduler {
  readonly maxConcurrentLanes: number
  private readonly runningLaneIDs = new Set<string>()
  private readonly queue: string[] = []

  constructor(config: LaneSchedulerConfig = {}) {
    this.maxConcurrentLanes = config.maxConcurrentLanes ?? 4
  }

  schedule(laneID: string): { scheduled: boolean; queued: boolean; reason?: string } {
    const lane = getLane(laneID)
    if (!lane) return { scheduled: false, queued: false, reason: "Lane not found" }

    if (this.runningLaneIDs.has(laneID)) {
      return { scheduled: true, queued: false }
    }

    if (this.runningLaneIDs.size >= this.maxConcurrentLanes) {
      if (!this.queue.includes(laneID)) {
        this.queue.push(laneID)
      }
      transitionLane(laneID, "pending", "Queued behind max concurrent lanes")
      return { scheduled: false, queued: true, reason: "Max concurrency reached" }
    }

    const activeLanes = Array.from(this.runningLaneIDs)
      .map((id) => getLane(id))
      .filter((l): l is Lane => Boolean(l))

    const conflict = checkResourceScopeConflict(lane.targetFiles ?? [], activeLanes)
    if (conflict.hasConflict) {
      if (!this.queue.includes(laneID)) {
        this.queue.push(laneID)
      }
      transitionLane(laneID, "pending", `Resource conflict on '${conflict.conflictingFile}' with lane ${conflict.conflictingLaneID}`)
      return { scheduled: false, queued: true, reason: `Conflict with lane ${conflict.conflictingLaneID}` }
    }

    this.runningLaneIDs.add(laneID)
    transitionLane(laneID, "running")
    return { scheduled: true, queued: false }
  }

  release(laneID: string) {
    this.runningLaneIDs.delete(laneID)
    const pending = [...this.queue]
    this.queue.length = 0
    for (const id of pending) {
      const result = this.schedule(id)
      if (!result.scheduled && !this.queue.includes(id)) {
        this.queue.push(id)
      }
    }
  }

  getRunningLanes(): readonly string[] {
    return Array.from(this.runningLaneIDs)
  }

  getQueue(): readonly string[] {
    return [...this.queue]
  }
}

export function resetLaneRegistry() {
  laneWatchdogs.clear()
  laneActiveGates.clear()
  laneActiveChecklists.clear()
  laneRecycleHistory.clear()
  laneTargetFiles.clear()
  laneParentMap.clear()
}

export * as Lanes from "./lanes"
