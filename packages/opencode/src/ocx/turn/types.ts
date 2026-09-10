import type { Effect } from "effect"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import type { LLM } from "@/session/llm"
import type { Provider } from "@/provider/provider"
import type { OCXDb } from "@/ocx/ocx-db"
import type { LadderRun } from "@/ocx/verify-ladder"
import type { Operation, WorkflowStatus, WorkflowVariant } from "@/ocx/workflow"

export type Stage = "topic" | "optimize" | "thinking" | "workflow" | "guard" | "reasoning" | "playbook"

export type StagePulse = (stage: Stage, active: boolean, summary?: string) => Effect.Effect<void>

export type TurnServices = {
  readonly store: OCXDb.Store
  readonly todoGet: (sessionID: string) => Effect.Effect<{ status: string; content: string; priority: string }[]>
  readonly todoSet: (
    sessionID: string,
    todos: ReadonlyArray<{ status: string; content: string; priority: string }>,
  ) => Effect.Effect<void>
  readonly llm: LLM.Interface
  readonly model: Provider.Model
  readonly user: SessionV1.User
  readonly sessionID: string
  readonly cwd: string
  readonly contextEnabled?: boolean
  readonly contextAgentRetrieval?: boolean
  readonly contextFreshnessChecks?: boolean
  readonly ocxVerifyLadder: boolean
  readonly ocxWorkGraph?: boolean
  readonly ocxReviewEnvelope: boolean
  readonly ocxFlakeGate: boolean
  readonly ocxPractices: boolean
  readonly ocxPatchSelection: boolean
  readonly verify?: (input: { readonly changed: readonly string[]; readonly cwd: string }) => Effect.Effect<LadderRun>
  readonly reviewerModel?: Provider.Model
  readonly publishActivity: StagePulse
  readonly publishWorkflow: (workflow: {
    workflow: string
    phase: string
    phases: ReadonlyArray<{ readonly id: string; readonly goal: string }>
    variant?: WorkflowVariant
    objective?: string
    status?: WorkflowStatus
    revision?: number
    intentRevision?: number
    operation?: Operation
  }) => Effect.Effect<void>
  readonly updatePart: (part: SessionV1.Part) => Effect.Effect<void>
}

export * as Types from "./types"
