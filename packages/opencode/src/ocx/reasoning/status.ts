export type ReasoningActivity =
  | "thinking"
  | "planning"
  | "inspecting"
  | "searching"
  | "editing"
  | "running"
  | "delegating"
  | "waiting"
  | "recovering"
  | "verifying"
  | "finalizing"

export type ReasoningStatusSource = "model" | "tool" | "workflow" | "task" | "recovery" | "fallback"

export type ReasoningStatusState = "active" | "done" | "interrupted" | "failed"

export type ReasoningStatus = {
  id: string
  sessionID: string
  messageID: string
  stepID?: string
  activity: ReasoningActivity
  title: string
  detail?: string
  action?: string
  target?: string
  purpose?: string
  semanticKey: string
  source: ReasoningStatusSource
  startedAt: number
  updatedAt: number
  state: ReasoningStatusState
}

export type ModelReasoningHint = {
  activity?: ReasoningActivity
  action: string
  target?: string
  purpose?: string
}

export type ReasoningStatusContext = {
  activity: ReasoningActivity
  action?: string
  target?: string
  purpose?: string
  capability?: string
  workflowPhase?: string
  workstreamID?: string
  recoveryClass?: string
  ownerScope?: string
  taskObjective?: string
  toolName?: string
}

const FALLBACK_TITLES = new Set(["thinking", "working", "continuing", "checking things", "analyzing the problem"])

export function isEmptyTitle(value: string): boolean {
  return value.trim().length === 0
}

export function semanticKey(ctx: ReasoningStatusContext): string {
  const parts = [
    ctx.activity ?? "",
    ctx.action ?? "",
    normalizeTarget(ctx.target ?? ""),
    ctx.capability ?? "",
    ctx.workflowPhase ?? "",
    ctx.workstreamID ?? "",
    ctx.recoveryClass ?? "",
    ctx.ownerScope ?? "",
  ]
  return parts.join("|")
}

function normalizeTarget(value: string): string {
  if (!value) return ""
  const trimmed = value.trim()
  if (trimmed.startsWith("/")) {
    const last = trimmed.split("/").pop() ?? trimmed
    return last.split("?")[0].split("#")[0]
  }
  try {
    const url = new URL(trimmed)
    return url.hostname + url.pathname.split("/").pop()
  } catch {}
  return trimmed.slice(0, 80)
}

export function scoreSource(source: ReasoningStatusSource): number {
  switch (source) {
    case "model":
      return 90
    case "tool":
      return 80
    case "recovery":
      return 75
    case "workflow":
      return 60
    case "task":
      return 50
    case "fallback":
      return 10
  }
}

export function shouldReplace(current: ReasoningStatus, candidate: { semanticKey: string; source: ReasoningStatusSource; title: string }): boolean {
  if (candidate.semanticKey !== current.semanticKey) return true
  if (FALLBACK_TITLES.has(candidate.title.toLowerCase())) return false
  const candidateScore = scoreSource(candidate.source)
  const currentScore = scoreSource(current.source)
  if (candidateScore > currentScore) return true
  if (candidate.title === current.title) return false
  return candidateScore >= currentScore
}

export function createFallback(input: { sessionID: string; messageID: string; taskObjective?: string; startedAt?: number }): ReasoningStatus {
  const now = input.startedAt ?? Date.now()
  const title = input.taskObjective ? `Analyzing ${sanitizeTaskObjective(input.taskObjective)}` : "Planning the next step"
  return {
    id: `rs_${now}_${Math.random().toString(36).slice(2, 8)}`,
    sessionID: input.sessionID,
    messageID: input.messageID,
    activity: "thinking",
    title,
    semanticKey: semanticKey({ activity: "thinking", action: "analyze", target: input.taskObjective ?? "" }),
    source: "fallback",
    startedAt: now,
    updatedAt: now,
    state: "active",
  }
}

function sanitizeTaskObjective(value: string): string {
  const cleaned = value.trim().replace(/\s+/g, " ").slice(0, 60)
  if (!cleaned) return "the request"
  const words = cleaned.split(" ").slice(0, 6).join(" ")
  return words.length < cleaned.length ? words : cleaned
}

export function terminalize(status: ReasoningStatus, state: ReasoningStatusState): ReasoningStatus {
  return { ...status, state, updatedAt: Date.now() }
}

export function isActive(status: ReasoningStatus): boolean {
  return status.state === "active"
}

export * as ReasoningStatus from "./status"
