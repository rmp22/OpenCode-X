export type ExecutionLane =
  | "interactive"
  | "probe"
  | "batch"
  | "autonomous"
  | "fast"
  | "standard"
  | "deep"
  | "research"

export type LaneConfig = {
  readonly lane: ExecutionLane
  readonly concurrency: number
  readonly timeoutMs: number
  readonly priority: number
  readonly allowedToolCategories?: readonly string[]
  readonly tokenBudget?: number
  readonly maxRetries?: number
}

export type LaneTask<T = unknown> = {
  readonly id: string
  readonly lane: ExecutionLane
  readonly execute: () => Promise<T>
  readonly timeoutMs?: number
  readonly toolCategory?: string
  readonly tokenCost?: number
  readonly createdAt: number
}

export type LaneTaskResult<T = unknown> =
  | { readonly success: true; readonly data: T; readonly result: T; readonly durationMs: number }
  | { readonly success: false; readonly error: string; readonly durationMs: number }

export * as LaneTypes from "./types"
