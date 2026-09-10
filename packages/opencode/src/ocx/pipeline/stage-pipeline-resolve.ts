import type { TurnServices } from "@/ocx/turn/types"
import * as State from "@/ocx/turn/state"

export function syncPipelineWorkflowFromStore(services: TurnServices, key: string): void {
  const pipeline = State.pipelineOf(key)
  const stored = services.store.get(services.sessionID)
  if (!pipeline || !stored?.workflow || !stored.phase) return
  const matches =
    pipeline.workflow.name === stored.workflow &&
    pipeline.workflow.phase === stored.phase &&
    pipeline.workflow.variant === stored.variant &&
    pipeline.workflow.revision === stored.revision
  if (matches) return

  State.setPipeline(key, {
    ...pipeline,
    workflow: {
      ...pipeline.workflow,
      name: stored.workflow,
      ...(stored.variant ? { variant: stored.variant } : {}),
      phase: stored.phase,
      phases: stored.phases?.length ? stored.phases : pipeline.workflow.phases,
      ...(stored.objective ? { objective: stored.objective } : {}),
      ...(stored.status ? { status: stored.status } : {}),
      ...(stored.revision !== undefined ? { revision: stored.revision } : {}),
      ...(stored.intentRevision !== undefined ? { intentRevision: stored.intentRevision } : {}),
    },
  })
}

export * as StagePipelineResolve from "./stage-pipeline-resolve"
