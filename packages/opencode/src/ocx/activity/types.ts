export type ActivityKind =
  | "thinking"
  | "playbook"
  | "exploring"
  | "research"
  | "git"
  | "automation"
  | "design"
  | "review"
  | "editing"
  | "tool"
  | "delegation"
  | "recovery"
  | "verification"
  | "waiting"
  | "blocked"

export type ActivityState = "active" | "completed" | "failed" | "cancelled" | "superseded"

export type ActivityOwnerType =
  | "assistant"
  | "reasoning"
  | "playbook"
  | "tool"
  | "delegation"
  | "verification"
  | "recovery"
  | "generic"

export type ActivityLease = {
  readonly id: string
  readonly sessionID: string
  readonly parentSessionID?: string
  readonly parentActivityID?: string
  readonly subagentType?: string
  readonly attemptID?: string
  readonly ownerType: ActivityOwnerType
  readonly ownerID: string
  kind: ActivityKind
  title: string
  detail?: string
  priority: number
  state: ActivityState
  startedAt: number
  updatedAt: number
  endedAt?: number
  progressCurrent?: number
  progressTotal?: number
}

export function priorityForKind(kind: ActivityKind): number {
  switch (kind) {
    case "blocked":
      return 100
    case "recovery":
      return 95
    case "playbook":
      return 90
    case "verification":
    case "review":
      return 80
    case "editing":
    case "git":
    case "automation":
    case "design":
      return 70
    case "exploring":
    case "research":
      return 65
    case "tool":
      return 60
    case "delegation":
      return 55
    case "waiting":
      return 30
    case "thinking":
      return 10
    default:
      return 0
  }
}

export * as ActivityTypes from "./types"
