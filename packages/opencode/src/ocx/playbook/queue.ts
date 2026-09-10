import type { StrategyName } from "@/ocx/strategy"
import type { PlaybookStage } from "./catalog"
import { PlaybookCatalog } from "./catalog"

export type PassStatus = "selected" | "ready" | "running" | "completed" | "failed" | "skipped" | "cancelled" | "invalidated"
export type SelectedBy = "model" | "runtime_required"

export type PlaybookPass = {
  readonly passID: string
  readonly playbookID: StrategyName
  readonly playbookHash: string
  readonly stage: PlaybookStage
  readonly order: number
  status: PassStatus
  readonly selectedRevision: string
  readonly selectedBy: SelectedBy
  bodyInjected?: boolean
  startedRevision?: string
  completedRevision?: string
  invalidatedRevision?: string
  invalidationReason?: string
  failureReason?: string
}

export type QueueState = {
  passes: PlaybookPass[]
  selectedAt?: number
  selectionRevision?: string
}

const queues = new Map<string, QueueState>()
const revisionCounters = new Map<string, number>()

function key(sessionID: string): string {
  return sessionID
}

function revisionOf(sessionID: string, attempt?: string): string {
  if (attempt) return attempt
  const next = (revisionCounters.get(sessionID) ?? 0) + 1
  revisionCounters.set(sessionID, next)
  return `${sessionID}:${next}`
}

export function getQueue(sessionID: string): QueueState | undefined {
  return queues.get(key(sessionID))
}

export function listPasses(sessionID: string): PlaybookPass[] {
  return queues.get(key(sessionID))?.passes ?? []
}

export function clearQueue(sessionID: string): void {
  queues.delete(key(sessionID))
  revisionCounters.delete(sessionID)
}

export function selectPasses(input: {
  sessionID: string
  selections: Array<{ id: StrategyName; stage?: PlaybookStage; selectedBy?: SelectedBy }>
  selectedBy?: SelectedBy
  selectedRevision?: string
}): PlaybookPass[] {
  const normalized: Array<{ id: StrategyName; stage: PlaybookStage; selectedBy: SelectedBy }> = input.selections.map((sel) => ({
    id: sel.id,
    stage: sel.stage ?? PlaybookCatalog.defaultStage(sel.id),
    selectedBy: sel.selectedBy ?? input.selectedBy ?? "model",
  }))

  const unique: typeof normalized = []
  const seen = new Set<string>()
  for (const sel of normalized) {
    const key = `${sel.id}:${sel.stage}`
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(sel)
  }

  const stageOrder: Record<PlaybookStage, number> = {
    pre_implementation: 0,
    post_implementation: 1,
    verification: 2,
    recovery: 3,
  }
  unique.sort((a, b) => stageOrder[a.stage] - stageOrder[b.stage])

  const revision = input.selectedRevision ?? revisionOf(input.sessionID)
  const existing = queues.get(key(input.sessionID))
  if (existing && existing.passes.length > 0) {
    const sameSelection =
      existing.passes.length === unique.length &&
      existing.passes.every(
        (p, i) =>
          p.playbookID === unique[i].id &&
          p.stage === unique[i].stage &&
          p.selectedBy === unique[i].selectedBy &&
          p.selectedRevision === revision,
      )
    if (sameSelection) return existing.passes
  }

  const passes: PlaybookPass[] = unique.map((sel, idx) => ({
    passID: `pp_${sel.id}_${sel.stage}_${idx}`,
    playbookID: sel.id,
    playbookHash: PlaybookCatalog.hashFor(sel.id),
    stage: sel.stage,
    order: idx,
    status: "selected" as PassStatus,
    selectedRevision: revision,
    selectedBy: sel.selectedBy,
  }))

  queues.set(key(input.sessionID), { passes, selectedAt: Date.now(), selectionRevision: revision })
  return passes
}

export function markReadyForStage(sessionID: string, stage: PlaybookStage): void {
  const q = queues.get(key(sessionID))
  if (!q) return
  for (const p of q.passes) if (p.status === "selected" && p.stage === stage) p.status = "ready"
}

export function markReadyForAudit(sessionID: string): void {
  const q = queues.get(key(sessionID))
  if (!q) return
  for (const p of q.passes) if (p.status === "selected") p.status = "ready"
}

export function nextReady(sessionID: string, stage: PlaybookStage): PlaybookPass | undefined {
  const q = queues.get(key(sessionID))
  if (!q) return undefined
  return q.passes.find((p) => p.stage === stage && p.status === "ready")
}

export function nextReadyForAudit(sessionID: string): PlaybookPass | undefined {
  const q = queues.get(key(sessionID))
  if (!q) return undefined
  return q.passes.find((p) => p.status === "ready")
}

export function auditComplete(sessionID: string): boolean {
  const passes = listPasses(sessionID)
  return passes.length === 0 || passes.every((p) => p.status === "completed" && p.bodyInjected === true)
}

export function activePass(sessionID: string): PlaybookPass | undefined {
  const q = queues.get(key(sessionID))
  if (!q) return undefined
  return q.passes.find((p) => p.status === "running")
}

export function activeCount(sessionID: string): number {
  const q = queues.get(key(sessionID))
  if (!q) return 0
  return q.passes.filter((p) => p.status === "running").length
}

export function startPass(sessionID: string, passID: string): PlaybookPass | undefined {
  const q = queues.get(key(sessionID))
  if (!q) return undefined
  if (activeCount(sessionID) >= 1) return undefined
  const pass = q.passes.find((p) => p.passID === passID)
  if (!pass) return undefined
  if (pass.status !== "ready") return undefined
  pass.status = "running"
  pass.startedRevision = revisionOf(sessionID)
  return pass
}

export function markBodyInjected(sessionID: string, passID: string): PlaybookPass | undefined {
  const q = queues.get(key(sessionID))
  if (!q) return undefined
  const pass = q.passes.find((item) => item.passID === passID)
  if (!pass || pass.status !== "running") return undefined
  pass.bodyInjected = true
  return pass
}

export function restorePass(
  sessionID: string,
  passID: string,
  outcome: "completed" | "failed" | "skipped" | "cancelled" | "invalidated",
  revision: string,
  reason?: string,
): PlaybookPass | undefined {
  const q = queues.get(key(sessionID))
  if (!q) return undefined
  const pass = q.passes.find((item) => item.passID === passID)
  if (!pass || pass.selectedRevision !== q.selectionRevision) return undefined
  if (!(["selected", "ready", "running"].includes(pass.status))) return pass
  pass.status = outcome
  pass.completedRevision = revision
  if (reason) pass.failureReason = reason
  return pass
}

export function completePass(
  sessionID: string,
  passID: string,
  outcome: "completed" | "failed" | "skipped" | "cancelled" = "completed",
  reason?: string,
): PlaybookPass | undefined {
  const q = queues.get(key(sessionID))
  if (!q) return undefined
  const pass = q.passes.find((p) => p.passID === passID)
  if (!pass) return undefined
  if (pass.status !== "running") return undefined
  pass.status = outcome
  pass.completedRevision = pass.selectedRevision
  if (reason) pass.failureReason = reason
  return pass
}

export function invalidatePass(
  sessionID: string,
  passID: string,
  reason: string,
  revision?: string,
): PlaybookPass | undefined {
  const q = queues.get(key(sessionID))
  if (!q) return undefined
  const pass = q.passes.find((p) => p.passID === passID)
  if (!pass) return undefined
  if (pass.status !== "completed") return undefined
  pass.status = "invalidated" as PassStatus
  pass.invalidatedRevision = revision ?? revisionOf(sessionID)
  pass.invalidationReason = reason
  return pass
}

export function shouldRerun(input: {
  sessionID: string
  playbookID: StrategyName
  stage: PlaybookStage
  revision: string
}): boolean {
  const q = queues.get(key(input.sessionID))
  if (!q) return true
  const existing = q.passes.find((p) => p.playbookID === input.playbookID && p.stage === input.stage)
  if (!existing) return true
  if (existing.status === "completed" && existing.completedRevision === input.revision) return false
  if (existing.status === "invalidated") return true
  if (existing.status === "failed" || existing.status === "cancelled") return true
  return false
}

export function readyPassesForStage(sessionID: string, stage: PlaybookStage): PlaybookPass[] {
  const q = queues.get(key(sessionID))
  if (!q) return []
  return q.passes.filter((p) => p.stage === stage && p.status === "ready")
}

export function snapshot(sessionID: string): QueueState | undefined {
  const q = queues.get(key(sessionID))
  if (!q) return undefined
  return { passes: [...q.passes], selectedAt: q.selectedAt, selectionRevision: q.selectionRevision }
}

export function clearAll(): void {
  queues.clear()
  revisionCounters.clear()
}

export * as PlaybookQueue from "./queue"
