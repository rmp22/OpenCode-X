import type { Context as MutationContext } from "./mutation-guard"
import type { OCXDb } from "./ocx-db"
import { TaskModel } from "./task-model"

export type PhaseEvidence = {
  readonly source: string
  readonly type: "ledger" | "context" | "changed_paths" | "verification" | "owner" | "task_graph" | "diff" | "user_fact" | "repository_history" | "verification_output"
  readonly phase: string
  readonly detail: string
}

export type WorkflowContext = {
  readonly workflow?: string
  readonly phase?: string
  readonly phases?: ReadonlyArray<{ readonly id: string; readonly gate?: string }>
}

export type RuntimeEvidence = {
  readonly evidence: readonly PhaseEvidence[]
  readonly completedObligations: readonly string[]
}

export type RuntimeEvidenceInput = {
  readonly workflow: WorkflowContext
  readonly state?: OCXDb.State
  readonly mutationContext?: MutationContext
  readonly evidence?: readonly PhaseEvidence[]
  readonly completedObligations?: readonly string[]
}

function gateFor(workflow: WorkflowContext): string | undefined {
  return workflow.phases?.find((phase) => phase.id === workflow.phase)?.gate
}

function planComplete(state: OCXDb.State | undefined): boolean {
  const plan = state?.plan
  return Boolean(
    plan?.workstreams.length &&
      plan.workstreams.every(
        (workstream) =>
          workstream.steps.length > 0 && workstream.steps.every((step) => step.status === "completed"),
      ),
  )
}

function phaseSatisfied(input: RuntimeEvidenceInput): boolean {
  const state = input.state
  const stage = TaskModel.stageKind(input.workflow.phase)
  const planRequired = TaskModel.requiresExecutionPlan(input.workflow.workflow)

  if (stage === "understand") return state?.plan?.contextReady === true
  if (stage === "plan") return !planRequired || state?.plan !== undefined
  if (stage === "act") return state?.plan ? planComplete(state) : false
  if (stage === "review" || stage === "validate") return state?.playbookStage?.stage === "verification"
  return false
}

export function forAction(input: RuntimeEvidenceInput): RuntimeEvidence {
  const gate = gateFor(input.workflow)
  if (!gate || !phaseSatisfied(input)) {
    const evidence = input.evidence?.filter((item) => item.phase === input.workflow.phase) ?? []
    const completedObligations = input.completedObligations ?? []
    if (evidence.length > 0 && completedObligations.length > 0) return { evidence, completedObligations }
    return { evidence: [], completedObligations: [] }
  }
  return {
    evidence: [
      {
        source: "ocx-runtime",
        type: "context",
        phase: input.workflow.phase ?? "",
        detail: gate,
      },
    ],
    completedObligations: [gate],
  }
}

export * as WorkflowEvidence from "./workflow-evidence"
