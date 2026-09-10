import { Effect } from "effect"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import { OCXPipeline } from "@/ocx/ocx-pipeline"
import { SemanticRuntime } from "@/ocx/semantic-runtime"
import { TodoSync } from "@/ocx/todo/sync"
import { Ledger } from "@/ocx/ledger"
import type { Header as SessionHeader } from "@/ocx/header"
import type { TurnServices } from "./types"
import * as State from "./state"
import { PlaybookQueue } from "@/ocx/playbook/queue"
import { ActivityRuntime } from "@/ocx/activity/runtime"
import { WorkGraphRuntime } from "@/ocx/work-graph/runtime"

export function begin(
  services: TurnServices,
  messages: ReadonlyArray<SessionV1.WithParts>,
  userId: string,
) {
  return Effect.gen(function* () {
    ActivityRuntime.beginTurn(services.sessionID)
    const stored = services.store.get(services.sessionID)
    if (stored?.done || stored?.status === "complete") {
      services.store.set(services.sessionID, {
        ...stored,
        done: false,
        status: "active",
        plan: undefined,
        playbookStage: undefined,
        revision: (stored.revision ?? 0) + 1,
      })
      yield* services.todoSet(services.sessionID, []).pipe(Effect.ignore)
      State.clearSession(services.sessionID)
      PlaybookQueue.clearQueue(services.sessionID)
    }
    const key = State.turnKey(services.sessionID, userId)
    if (services.ocxWorkGraph === true)
      yield* WorkGraphRuntime.shadowTurn({
        store: services.store,
        sessionID: services.sessionID,
        repositoryID: services.cwd,
        request: OCXPipeline.promptText(messages) ?? "",
      }).pipe(Effect.catchCause(() => Effect.void))
    const cached = State.pipelineOf(key)
    if (cached) return cached

    const request = OCXPipeline.promptText(messages) ?? ""
    const pipeline = yield* SemanticRuntime.withProviderModel(
      services.model,
      OCXPipeline.run(
        { store: services.store, todo: { get: services.todoGet } },
        { sessionID: services.sessionID, prompt: request },
      ),
    )
    const header = State.headerOf(State.turnKey(services.sessionID, userId))
    const titled = header?.topic ? { ...pipeline, topic: header.topic } : pipeline
    State.setPipeline(key, titled)

    yield* services.publishWorkflow({
      workflow: titled.workflow.name,
      phase: titled.workflow.phase,
      phases: titled.workflow.phases,
      ...(titled.workflow.variant ? { variant: titled.workflow.variant } : {}),
      ...(titled.workflow.objective ? { objective: titled.workflow.objective } : {}),
      ...(titled.workflow.status ? { status: titled.workflow.status } : {}),
      ...(titled.workflow.revision !== undefined ? { revision: titled.workflow.revision } : {}),
      ...(titled.workflow.intentRevision !== undefined ? { intentRevision: titled.workflow.intentRevision } : {}),
      ...(titled.workflow.operation ? { operation: titled.workflow.operation } : {}),
    })
    return titled
  })
}

export function headerOpen(services: TurnServices, userId: string): boolean {
  return !State.hasHeader(State.turnKey(services.sessionID, userId))
}

export function isDone(services: Pick<TurnServices, "sessionID" | "store">): boolean {
  return services.store.get(services.sessionID)?.done === true
}

export function syncPlanTodos(
  services: Pick<TurnServices, "sessionID" | "todoGet" | "todoSet"> & {
    readonly store?: TurnServices["store"]
  },
  key: string,
  header: SessionHeader | undefined,
  messages: ReadonlyArray<SessionV1.WithParts> = [],
) {
  return Effect.gen(function* () {
    const executionPlan = services.store?.get(services.sessionID)?.plan
    if (!executionPlan && (!header || header.plan.length < 2)) return
    const existing = yield* services.todoGet(services.sessionID).pipe(
      Effect.catch(() => Effect.succeed([] as { status: string; content: string; priority: string }[])),
    )
    const legacyPlan = header?.plan ?? []
    const merged = executionPlan
      ? TodoSync.reconcileExecutionPlan(existing, executionPlan)
      : State.isTodosSynced(key)
        ? existing
        : TodoSync.mergePlan(existing, legacyPlan)
    const reconciled = executionPlan
      ? merged
      : TodoSync.reconcilePlan(merged, legacyPlan, Ledger.ledger(messages))
    const changed = reconciled.length !== existing.length || reconciled.some((item, index) => {
      const prior = existing[index]
      return !prior || prior.content !== item.content || prior.status !== item.status || prior.priority !== item.priority
    })
    if (changed) yield* services.todoSet(services.sessionID, reconciled).pipe(Effect.ignore)
    State.markTodosSynced(key)
  })
}

export * as Frame from "./frame"
