export type DomainOwnerType =
  | "ui"
  | "database"
  | "build"
  | "auth"
  | "security"
  | "testing"
  | "core"
  | "general"
  | "explore"

export interface SubagentTask {
  id: string
  owner: DomainOwnerType
  prompt: string
  depth: number
  parentSessionId?: string
}

export interface SubagentResult {
  taskId: string
  owner: DomainOwnerType
  output: string
  subsystemMemoryUpdates?: Record<string, unknown>
  success: boolean
}

export class MaxSubagentRecursionError extends Error {
  readonly _tag = "MaxSubagentRecursionError"
  constructor(public readonly depth: number, public readonly maxDepth: number) {
    super(`Subagent recursion depth ${depth} exceeded maximum allowed depth of ${maxDepth}`)
  }
}
