import type { Effect } from "effect"
import type { ActionEffect } from "../risk"

export interface StateEnvelope<TData = Record<string, unknown>> {
  readonly runID: string
  readonly laneID: string
  readonly stepIndex: number
  readonly data: Readonly<TData>
  readonly metadata: {
    readonly timestamp: number
    readonly activeTools: readonly string[]
    readonly parentNodeID?: string
  }
}

export type NodeExecutionResult<TOutput = unknown> = {
  readonly status: "success" | "failure" | "blocked"
  readonly output: TOutput
  readonly errorSignature?: string
  readonly diffHash?: string
  readonly evidence?: string
  readonly durationMs: number
}

export type NodeKind =
  | "inspect"
  | "plan"
  | "mutate"
  | "verify"
  | "repair"
  | "signoff"
  | "composite"
  | "terminal"

export type EdgeTransition =
  | {
      readonly _tag: "Goto"
      readonly targetNode: string
    }
  | {
      readonly _tag: "Loop"
      readonly targetNode: string
      readonly maxCycles: number
      readonly reason: string
    }
  | {
      readonly _tag: "Fork"
      readonly branches: readonly string[]
    }
  | {
      readonly _tag: "Join"
      readonly targetNode: string
    }
  | {
      readonly _tag: "Gate"
      readonly effect: ActionEffect
      readonly reason: string
      readonly payload: Record<string, unknown>
      readonly targetNode?: string
    }
  | {
      readonly _tag: "Complete"
      readonly verdict: "completed" | "failed"
      readonly finalOutput?: unknown
    }

export class GraphNodeError {
  readonly _tag = "GraphNodeError"
  constructor(readonly nodeID: string, readonly message: string, readonly cause?: unknown) {}
}

export interface GraphNode<TInput = unknown, TOutput = unknown, TState = unknown> {
  readonly id: string
  readonly label: string
  readonly kind?: NodeKind
  readonly allowedTools: readonly string[]
  readonly microPromptTemplate?: string
  readonly errorTarget?: string
  readonly declaredTargets?: readonly string[]
  readonly subGraph?: GraphDefinition<any>
  readonly budget?: {
    readonly maxTurns?: number
    readonly timeoutMs?: number
    readonly maxToolCalls?: number
  }
  readonly beforeStep?: (envelope: StateEnvelope<TInput>) => Effect.Effect<void>
  readonly execute: (
    input: TInput,
    state: TState,
  ) => Effect.Effect<NodeExecutionResult<TOutput>, GraphNodeError>
  readonly route: (
    result: NodeExecutionResult<TOutput>,
    state: TState,
    history: readonly NodeExecutionResult<unknown>[],
  ) => EdgeTransition
}

export interface GraphDefinition<TState = unknown> {
  readonly id: string
  readonly name: string
  readonly initialNodeId: string
  readonly nodes: ReadonlyMap<string, GraphNode<unknown, unknown, TState>>
}

export type GraphRunStatus =
  | "pending"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "aborted"
  | "cancelled"

export interface GraphExecutionResult {
  readonly runID: string
  readonly graphID: string
  readonly status: GraphRunStatus
  readonly finalOutput?: unknown
  readonly activeGateID?: string
  readonly executionHistory: readonly NodeExecutionResult<unknown>[]
  readonly durationMs: number
}

export * as GraphTypes from "./types"
