import { randomUUID } from "node:crypto"
import { Effect } from "effect"
import { OCXDb } from "../ocx-db"
import { SemanticBridge, type SemanticResult } from "../semantic-bridge"
import { WorkGraphCompiler } from "./compiler"
import { WorkGraphReconciler } from "./reconciler"
import { WorkGraphReducer } from "./reducer"
import type { ActivityResult, Event, Graph } from "./types"

type ShadowInput = {
  readonly store: OCXDb.Store
  readonly sessionID: string
  readonly repositoryID?: string
  readonly request: string
}

type ActivityInput = {
  readonly store: OCXDb.Store
  readonly sessionID: string
  readonly result: ActivityResult
}

const tails = new Map<string, Promise<void>>()

export function dispatch<A>(sessionID: string, operation: () => Effect.Effect<A>): Effect.Effect<A> {
  const previous = tails.get(sessionID)
  const current = previous
    ? previous.catch(() => undefined).then(() => Effect.runPromise(operation()))
    : Effect.runPromise(operation())
  const tail = current.then(
    () => undefined,
    () => undefined,
  )
  tails.set(sessionID, tail)
  return Effect.promise(() => current).pipe(
    Effect.ensuring(
      Effect.sync(() => {
        if (tails.get(sessionID) === tail) tails.delete(sessionID)
      }),
    ),
  )
}

export function shadowTurn(input: ShadowInput): Effect.Effect<void> {
  return Effect.gen(function* () {
    const semantic = yield* SemanticBridge.analyzePrompt(input.request)
    yield* dispatch(input.sessionID, () => Effect.sync(() => reconcileAndPersist(input, semantic)))
  })
}

export function acceptActivityResult(
  input: ActivityInput,
): Effect.Effect<WorkGraphReducer.ActivityApplyResult | undefined> {
  return dispatch(input.sessionID, () =>
    Effect.sync(() => applyActivityResult(input.store, input.sessionID, input.result)),
  )
}

export function graph(store: Pick<OCXDb.Store, "getWorkGraph">, sessionID: string): Graph | undefined {
  return store.getWorkGraph(sessionID)
}

export function clear(sessionID: string): void {
  tails.delete(sessionID)
}

function reconcileAndPersist(input: ShadowInput, semantic: SemanticResult): void {
  const current = input.store.getWorkGraph(input.sessionID)
  const intentKey = WorkGraphCompiler.intentKeyFor(input.request)
  const intentRevision =
    current && current.intentKey === intentKey ? current.intentRevision : (current?.intentRevision ?? 0) + 1
  const base = current ?? WorkGraphReducer.empty(input.sessionID, input.repositoryID)
  const patch = WorkGraphCompiler.compile({
    request: input.request,
    sessionID: input.sessionID,
    ...(input.repositoryID ? { repositoryID: input.repositoryID } : {}),
    currentGraph: current,
    semantic,
    intentRevision,
  })
  if (!patch) return
  const result = WorkGraphReconciler.apply(base, patch)
  if (!result.changed) return

  const event = makeEvent({
    sessionID: input.sessionID,
    graph: result.graph,
    type: current ? "graph_reconciled" : "graph_created",
    sequence: nextSequence(input.store, input.sessionID),
    reason: patch.reason,
  })
  input.store.saveWorkGraph(result.graph, [event])
}

function applyActivityResult(
  store: OCXDb.Store,
  sessionID: string,
  result: ActivityResult,
): WorkGraphReducer.ActivityApplyResult | undefined {
  const current = store.getWorkGraph(sessionID)
  if (!current) return undefined
  const applied = WorkGraphReducer.applyActivityResult(current, result)
  const event = makeEvent({
    sessionID: current.sessionID,
    graph: applied.graph,
    type: "activity_result_recorded",
    sequence: nextSequence(store, current.sessionID),
    nodeID: result.nodeID,
    nodeRevision: result.nodeRevision,
    result,
  })
  store.saveWorkGraph(applied.graph, [event])
  return applied
}

function nextSequence(store: OCXDb.Store, sessionID: string): number {
  const events = store.workGraphEvents(sessionID)
  return (events.at(-1)?.sequence ?? 0) + 1
}

function makeEvent(input: {
  readonly sessionID: string
  readonly graph: Graph
  readonly type: Event["type"]
  readonly sequence: number
  readonly reason?: string
  readonly nodeID?: string
  readonly nodeRevision?: number
  readonly result?: ActivityResult
}): Event {
  const payload = input.result
    ? { result: input.result }
    : { graph: input.graph, ...(input.reason ? { reason: input.reason } : {}) }
  return {
    eventID: `wge_${randomUUID().replaceAll("-", "")}`,
    sessionID: input.sessionID,
    graphID: input.graph.id,
    sequence: input.sequence,
    type: input.type,
    graphRevision: input.graph.revision,
    intentRevision: input.graph.intentRevision,
    ...(input.nodeID ? { nodeID: input.nodeID } : {}),
    ...(input.nodeRevision !== undefined ? { nodeRevision: input.nodeRevision } : {}),
    idempotencyKey:
      input.result?.idempotencyKey ??
      (input.result ? `activity:${input.result.id}` : `graph:${input.graph.intentKey}:${input.graph.revision}`),
    timestamp: Date.now(),
    payload,
  }
}

export * as WorkGraphRuntime from "./runtime"
