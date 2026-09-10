import { Effect, Duration } from "effect"
import { Db } from "../db"
import { Gate, mintInterventionRequest } from "../gate"
import type { GateRecord, GateResolution } from "../gate"
import { LoopGuard } from "./guard"
import type {
  EdgeTransition,
  GraphDefinition,
  GraphExecutionResult,
  GraphNode,
  GraphRunStatus,
  NodeExecutionResult,
  StateEnvelope,
} from "./types"
import { GraphNodeError } from "./types"

export interface EngineRunOptions<TState> {
  readonly runID?: string
  readonly laneID?: string
  readonly initialState: TState
  readonly startNodeId?: string
  readonly initialHistory?: readonly NodeExecutionResult<unknown>[]
  readonly maxConcurrency?: number
  readonly onNodeStart?: (nodeId: string, envelope: StateEnvelope<unknown>) => void
  readonly onNodeComplete?: (nodeId: string, result: NodeExecutionResult<unknown>) => void
  readonly onGatePause?: (gate: GateRecord) => void
  readonly onGateResume?: (gateID: string, resolution: GateResolution) => void
}

interface ActiveRunContext<TState> {
  readonly runID: string
  readonly laneID: string
  readonly graph: GraphDefinition<TState>
  readonly history: NodeExecutionResult<unknown>[]
  readonly loopGuards: Map<string, LoopGuard>
  state: TState
  currentNodeId: string
  status: GraphRunStatus
  activeGateID?: string
  stepIndex: number
  startTime: number
}

const activeRuns = new Map<string, ActiveRunContext<unknown>>()

export function getActiveRun(runID: string): ActiveRunContext<unknown> | undefined {
  return activeRuns.get(runID)
}

interface BranchExecutionResult<TState> {
  readonly branchId: string
  readonly joinTarget?: string
  readonly history: readonly NodeExecutionResult<unknown>[]
  readonly finalOutput?: unknown
  readonly state: TState
}

function executeBranchPath<TState>(
  initialNodeId: string,
  initialState: TState,
  graph: GraphDefinition<TState>,
  meta: {
    readonly runID: string
    readonly laneID: string
    readonly onNodeStart?: (nodeId: string, envelope: StateEnvelope<unknown>) => void
    readonly onNodeComplete?: (nodeId: string, result: NodeExecutionResult<unknown>) => void
  },
): Effect.Effect<BranchExecutionResult<TState>, GraphNodeError> {
  return Effect.gen(function* () {
    let currentNodeId: string | undefined = initialNodeId
    let currentState = initialState
    const history: NodeExecutionResult<unknown>[] = []
    let joinTarget: string | undefined

    while (currentNodeId) {
      const node = graph.nodes.get(currentNodeId) as GraphNode<unknown, unknown, TState> | undefined
      if (!node) {
        return yield* Effect.fail(
          new GraphNodeError(currentNodeId, `Node '${currentNodeId}' not found in graph '${graph.id}'`),
        )
      }

      const envelope: StateEnvelope<unknown> = {
        runID: meta.runID,
        laneID: meta.laneID,
        stepIndex: history.length,
        data: currentState as Record<string, unknown>,
        metadata: {
          timestamp: Date.now(),
          activeTools: node.allowedTools,
        },
      }

      if (meta.onNodeStart) {
        meta.onNodeStart(node.id, envelope)
      }

      if (node.beforeStep) {
        yield* Effect.catch(node.beforeStep(envelope), (err) =>
          Effect.fail(new GraphNodeError(node.id, `beforeStep failed: ${String(err)}`, err)),
        )
      }

      const nodeStartTime = Date.now()
      const nodeTimeoutMs = node.budget?.timeoutMs ?? 180_000

      const result: NodeExecutionResult<unknown> = yield* Effect.timeoutOrElse(
        node.execute(currentState, currentState),
        {
          duration: Duration.millis(nodeTimeoutMs),
          orElse: () =>
            Effect.fail(new GraphNodeError(node.id, `Execution timed out after ${nodeTimeoutMs}ms`)),
        },
      )

      history.push(result)

      if (result.output !== undefined && result.output !== null) {
        if (typeof result.output === "object" && typeof currentState === "object" && currentState !== null) {
          currentState = { ...currentState, ...result.output }
        } else if (typeof currentState !== "object" || currentState === null) {
          currentState = result.output as TState
        }
      }

      Db.insertNodeExecution({
        id: `nexec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        graph_run_id: meta.runID,
        node_id: node.id,
        iteration: history.length,
        status: result.status,
        input_payload: currentState,
        output_payload: result.output,
        error_signature: result.errorSignature,
        diff_hash: result.diffHash,
        duration_ms: Date.now() - nodeStartTime,
        created_at: Date.now(),
      })

      if (meta.onNodeComplete) {
        meta.onNodeComplete(node.id, result)
      }

      const transition = node.route(result, currentState, history)

      if (transition._tag === "Goto") {
        currentNodeId = transition.targetNode
      } else if (transition._tag === "Join") {
        joinTarget = transition.targetNode
        currentNodeId = undefined
      } else {
        currentNodeId = undefined
      }
    }

    const lastOutput = history[history.length - 1]?.output
    return {
      branchId: initialNodeId,
      joinTarget,
      history,
      finalOutput: lastOutput,
      state: currentState,
    }
  })
}

export function validateGraph<TState>(graph: GraphDefinition<TState>): Effect.Effect<void, GraphNodeError> {
  return Effect.gen(function* () {
    if (!graph.initialNodeId || !graph.nodes.has(graph.initialNodeId)) {
      return yield* Effect.fail(
        new GraphNodeError(
          graph.initialNodeId || "unknown",
          `Initial node '${graph.initialNodeId}' not found in graph '${graph.id}'`,
        ),
      )
    }

    for (const [nodeId, node] of graph.nodes) {
      if (node.declaredTargets) {
        for (const target of node.declaredTargets) {
          if (!graph.nodes.has(target)) {
            return yield* Effect.fail(
              new GraphNodeError(nodeId, `Declared target node '${target}' not found in graph '${graph.id}'`),
            )
          }
        }
      }
      if (node.errorTarget && !graph.nodes.has(node.errorTarget)) {
        return yield* Effect.fail(
          new GraphNodeError(nodeId, `Error target node '${node.errorTarget}' not found in graph '${graph.id}'`),
        )
      }
    }
  })
}

export function createGraphEngine() {
  const run = <TState>(
    graph: GraphDefinition<TState>,
    options: EngineRunOptions<TState>,
  ): Effect.Effect<GraphExecutionResult, GraphNodeError> =>
    Effect.gen(function* () {
      yield* validateGraph(graph)

      const runID = options.runID ?? `grun_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      const laneID = options.laneID ?? `lane_standalone_${runID}`
      const startTime = Date.now()

      const startNodeId = options.startNodeId ?? graph.initialNodeId
      if (!graph.nodes.has(startNodeId)) {
        return yield* Effect.fail(
          new GraphNodeError(startNodeId, `Start node '${startNodeId}' not found in graph '${graph.id}'`),
        )
      }

      const context: ActiveRunContext<TState> = {
        runID,
        laneID,
        graph,
        history: options.initialHistory ? [...options.initialHistory] : [],
        loopGuards: new Map(),
        state: options.initialState,
        currentNodeId: startNodeId,
        status: "running",
        stepIndex: options.initialHistory?.length ?? 0,
        startTime,
      }

      activeRuns.set(runID, context as ActiveRunContext<unknown>)

      Db.insertGraphRun({
        id: runID,
        lane_id: laneID,
        graph_id: graph.id,
        status: "running",
        active_node_ids: [context.currentNodeId],
        context_envelope: { state: context.state, stepIndex: 0 },
        created_at: startTime,
        updated_at: startTime,
      })

      while (context.status === "running") {
        const node = graph.nodes.get(context.currentNodeId) as
          | GraphNode<unknown, unknown, TState>
          | undefined

        if (!node) {
          context.status = "failed"
          return yield* Effect.fail(
            new GraphNodeError(
              context.currentNodeId,
              `Node '${context.currentNodeId}' not found in graph '${graph.id}'`,
            ),
          )
        }

        const envelope: StateEnvelope<unknown> = {
          runID,
          laneID,
          stepIndex: context.stepIndex,
          data: context.state as Record<string, unknown>,
          metadata: {
            timestamp: Date.now(),
            activeTools: node.allowedTools,
            parentNodeID: context.history[context.history.length - 1] ? context.currentNodeId : undefined,
          },
        }

        if (options.onNodeStart) {
          options.onNodeStart(context.currentNodeId, envelope)
        }

        if (node.beforeStep) {
          yield* Effect.catch(node.beforeStep(envelope), (err) =>
            Effect.fail(
              new GraphNodeError(
                node.id,
                `beforeStep failed for node '${node.id}': ${String(err)}`,
                err,
              ),
            ),
          )
        }

        const nodeStartTime = Date.now()
        const nodeTimeoutMs = node.budget?.timeoutMs ?? 180_000

        let result: NodeExecutionResult<unknown>
        if (node.subGraph) {
          const subEngine = createGraphEngine()
          const subRun = yield* subEngine.run(node.subGraph as GraphDefinition<unknown>, {
            initialState: context.state,
            maxConcurrency: options.maxConcurrency,
          })
          result = {
            status: subRun.status === "completed" ? "success" : "failure",
            output: subRun.finalOutput,
            durationMs: subRun.durationMs,
          }
        } else {
          const execEffect = Effect.timeoutOrElse(node.execute(context.state, context.state), {
            duration: Duration.millis(nodeTimeoutMs),
            orElse: () =>
              Effect.fail(
                new GraphNodeError(
                  node.id,
                  `Execution timed out after ${nodeTimeoutMs}ms on node '${node.id}'`,
                ),
              ),
          })
          result = yield* Effect.catch(execEffect, (err) => {
            if (node.errorTarget && graph.nodes.has(node.errorTarget)) {
              return Effect.succeed<NodeExecutionResult<unknown>>({
                status: "failure",
                output: null,
                errorSignature: err instanceof Error ? err.message : String(err),
                durationMs: Date.now() - nodeStartTime,
              })
            }
            return Effect.fail(err instanceof GraphNodeError ? err : new GraphNodeError(node.id, String(err)))
          })
        }

        context.history.push(result)
        context.stepIndex += 1

        if (result.output !== undefined && result.output !== null) {
          if (typeof result.output === "object" && typeof context.state === "object" && context.state !== null) {
            context.state = {
              ...context.state,
              ...result.output,
            }
          } else if (typeof context.state !== "object" || context.state === null) {
            context.state = result.output as TState
          }
        }

        if (result.status === "failure" && node.errorTarget && graph.nodes.has(node.errorTarget)) {
          context.currentNodeId = node.errorTarget
          continue
        }

        Db.insertNodeExecution({
          id: `nexec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          graph_run_id: runID,
          node_id: node.id,
          iteration: context.stepIndex,
          status: result.status,
          input_payload: context.state,
          output_payload: result.output,
          error_signature: result.errorSignature,
          diff_hash: result.diffHash,
          duration_ms: Date.now() - nodeStartTime,
          created_at: Date.now(),
        })

        if (options.onNodeComplete) {
          options.onNodeComplete(context.currentNodeId, result)
        }

        const transition: EdgeTransition = node.route(result, context.state, context.history)

        switch (transition._tag) {
          case "Goto": {
            if (!graph.nodes.has(transition.targetNode)) {
              const err = new GraphNodeError(
                node.id,
                `Goto target node '${transition.targetNode}' not found in graph '${graph.id}'`,
              )
              context.status = "failed"
              Db.updateGraphRun(runID, {
                status: "failed",
                context_envelope: { state: context.state, error: err.message, stepIndex: context.stepIndex },
                updated_at: Date.now(),
              })
              return yield* Effect.fail(err)
            }
            context.currentNodeId = transition.targetNode
            break
          }
          case "Loop": {
            if (!graph.nodes.has(transition.targetNode)) {
              const err = new GraphNodeError(
                node.id,
                `Loop target node '${transition.targetNode}' not found in graph '${graph.id}'`,
              )
              context.status = "failed"
              Db.updateGraphRun(runID, {
                status: "failed",
                context_envelope: { state: context.state, error: err.message, stepIndex: context.stepIndex },
                updated_at: Date.now(),
              })
              return yield* Effect.fail(err)
            }

            const edgeKey = `${node.id}->${transition.targetNode}`
            let loopGuard = context.loopGuards.get(edgeKey)
            if (!loopGuard) {
              loopGuard = new LoopGuard({ maxCycles: transition.maxCycles })
              const existingRecords = Db.listLoopGuardRecords(runID).filter((r) => r.edge_id === edgeKey)
              if (existingRecords.length > 0) {
                const latest = existingRecords[existingRecords.length - 1]
                const errorHashes = latest.historical_error_hashes as string[] | undefined
                const lastHash = errorHashes && errorHashes.length > 0 ? errorHashes[errorHashes.length - 1] : undefined
                loopGuard.restore(latest.cycle_count, lastHash)
              }
              context.loopGuards.set(edgeKey, loopGuard)
            }

            const evaluation = loopGuard.recordIteration(result.errorSignature, result.diffHash)

            Db.insertLoopGuardRecord({
              id: `lgr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
              graph_run_id: runID,
              edge_id: edgeKey,
              cycle_count: loopGuard.currentIteration,
              historical_error_hashes: [result.errorSignature ?? ""],
              historical_diff_hashes: [result.diffHash ?? ""],
              tripped: evaluation.tripped,
              trip_reason: evaluation.reason,
              created_at: Date.now(),
            })

            if (evaluation.tripped) {
              const gate = mintInterventionRequest({
                laneID,
                stallType: "loop_exhausted",
                reason: evaluation.reason ?? `Max cycle budget of ${transition.maxCycles} exceeded on edge '${edgeKey}'`,
                suggestedActions: ["replan", "diagnose_environment", "ask_user"],
              })

              context.status = "paused"
              context.activeGateID = gate.id
              if (options.onGatePause) {
                options.onGatePause(gate)
              }
              break
            }

            context.currentNodeId = transition.targetNode
            break
          }
          case "Gate": {
            const gate = Gate.mintGate({
              laneID,
              effect: transition.effect,
              payload: transition.payload,
            })
            context.status = "paused"
            context.activeGateID = gate.id
            if (transition.targetNode) {
              if (!graph.nodes.has(transition.targetNode)) {
                const err = new GraphNodeError(
                  node.id,
                  `Gate target node '${transition.targetNode}' not found in graph '${graph.id}'`,
                )
                context.status = "failed"
              Db.updateGraphRun(runID, {
                status: "failed",
                context_envelope: { state: context.state, error: err.message, stepIndex: context.stepIndex },
                updated_at: Date.now(),
              })
                return yield* Effect.fail(err)
              }
              context.currentNodeId = transition.targetNode
            }
            if (options.onGatePause) {
              options.onGatePause(gate)
            }
            break
          }
          case "Fork": {
            for (const branchId of transition.branches) {
              if (!graph.nodes.has(branchId)) {
                context.status = "failed"
                return yield* Effect.fail(
                  new GraphNodeError(node.id, `Fork branch node '${branchId}' not found in graph '${graph.id}'`),
                )
              }
            }

            Db.updateGraphRun(runID, {
              status: "running",
              active_node_ids: [...transition.branches],
              context_envelope: { state: context.state, stepIndex: context.stepIndex },
              updated_at: Date.now(),
            })

            const branchResults = yield* Effect.all(
              transition.branches.map((branchId) =>
                executeBranchPath(branchId, context.state, graph, {
                  runID,
                  laneID,
                  onNodeStart: options.onNodeStart,
                  onNodeComplete: options.onNodeComplete,
                }),
              ),
              { concurrency: options.maxConcurrency ?? 4 },
            )

            const joinTargets = new Set<string>()
            for (const bRes of branchResults) {
              context.history.push(...bRes.history)
              if (bRes.joinTarget) {
                joinTargets.add(bRes.joinTarget)
              }
              if (bRes.finalOutput && typeof context.state === "object" && context.state !== null) {
                context.state = {
                  ...context.state,
                  ...(typeof bRes.finalOutput === "object" ? bRes.finalOutput : { [bRes.branchId]: bRes.finalOutput }),
                }
              }
            }

            if (joinTargets.size > 1) {
              context.status = "failed"
              return yield* Effect.fail(
                new GraphNodeError(
                  node.id,
                  `Conflicting join targets in fork branches: ${Array.from(joinTargets).join(", ")}`,
                ),
              )
            }

            if (joinTargets.size === 1) {
              const joinTarget = Array.from(joinTargets)[0]
              if (!graph.nodes.has(joinTarget)) {
                context.status = "failed"
                return yield* Effect.fail(
                  new GraphNodeError(node.id, `Join target node '${joinTarget}' not found in graph '${graph.id}'`),
                )
              }
              context.currentNodeId = joinTarget
            }
            break
          }
          case "Join": {
            if (!graph.nodes.has(transition.targetNode)) {
              const err = new GraphNodeError(
                node.id,
                `Join target node '${transition.targetNode}' not found in graph '${graph.id}'`,
              )
              context.status = "failed"
              Db.updateGraphRun(runID, {
                status: "failed",
                context_envelope: { state: context.state, error: err.message, stepIndex: context.stepIndex },
                updated_at: Date.now(),
              })
              return yield* Effect.fail(err)
            }
            context.currentNodeId = transition.targetNode
            break
          }
          case "Complete": {
            context.status = transition.verdict === "completed" ? "completed" : "failed"
            break
          }
        }

        Db.updateGraphRun(runID, {
          status: context.status,
          active_node_ids: [context.currentNodeId],
          context_envelope: { state: context.state, stepIndex: context.stepIndex },
          updated_at: Date.now(),
        })
      }

      const durationMs = Date.now() - startTime
      const lastOutput = context.history[context.history.length - 1]?.output

      return {
        runID,
        graphID: graph.id,
        status: context.status,
        finalOutput: lastOutput,
        activeGateID: context.activeGateID,
        executionHistory: context.history,
        durationMs,
      }
    })

  const resumeWithToken = <TState>(
    runID: string,
    gateID: string,
    answer: string,
    options?: {
      readonly resumeNodeId?: string
      readonly graph?: GraphDefinition<TState>
      readonly onGateResume?: (gateID: string, resolution: GateResolution) => void
    },
  ): Effect.Effect<GraphExecutionResult, GraphNodeError> =>
    Effect.gen(function* () {
      let context = activeRuns.get(runID) as ActiveRunContext<TState> | undefined
      if (!context) {
        const persistedRun = Db.getGraphRun(runID)
        if (!persistedRun) {
          return yield* Effect.fail(new GraphNodeError("engine", `Graph run '${runID}' not found`))
        }
        if (!options?.graph) {
          return yield* Effect.fail(
            new GraphNodeError(
              "engine",
              `Graph run '${runID}' was reconstructed from DB but requires graph definition`,
            ),
          )
        }
        const activeNodes = persistedRun.active_node_ids as string[] | undefined
        const envelope = persistedRun.context_envelope as Record<string, unknown> | undefined
        const activeNode = activeNodes?.[0] ?? options.graph.initialNodeId
        context = {
          runID,
          laneID: persistedRun.lane_id,
          graph: options.graph,
          history: [],
          loopGuards: new Map(),
          state: (envelope?.state as TState) ?? ({} as TState),
          currentNodeId: activeNode,
          status: "paused",
          stepIndex: (envelope?.stepIndex as number | undefined) ?? 0,
          startTime: persistedRun.created_at,
        }
        activeRuns.set(runID, context as ActiveRunContext<unknown>)
      }

      if (context.status !== "paused") {
        return yield* Effect.fail(
          new GraphNodeError(
            "engine",
            `Graph run '${runID}' is not paused (current status: ${context.status})`,
          ),
        )
      }

      const resolutionResult = Gate.resolveGate(gateID, answer)
      if (!resolutionResult.success || !resolutionResult.resolution) {
        return yield* Effect.fail(
          new GraphNodeError(
            "engine",
            resolutionResult.error ?? `Failed to resolve gate '${gateID}'`,
          ),
        )
      }

      const resolution = resolutionResult.resolution!
      if (options?.onGateResume) {
        options.onGateResume(gateID, resolution)
      }

      if (resolution.decision === "kill") {
        context.status = "aborted"
        context.activeGateID = undefined
        Db.updateGraphRun(runID, { status: "aborted", updated_at: Date.now() })
        return {
          runID,
          graphID: context.graph.id,
          status: "aborted",
          executionHistory: context.history,
          durationMs: Date.now() - context.startTime,
        }
      }

      context.status = "running"
      context.activeGateID = undefined
      const resumeTarget = options?.resumeNodeId ?? context.currentNodeId
      context.currentNodeId = resumeTarget

      Db.updateGraphRun(runID, { status: "running", updated_at: Date.now() })
      activeRuns.delete(runID)

      return yield* run(context.graph, {
        runID: context.runID,
        laneID: context.laneID,
        initialState: context.state,
        startNodeId: resumeTarget,
        initialHistory: context.history,
      })
    })

  const cancel = (runID: string, reason = "Cancelled by user"): Effect.Effect<void, GraphNodeError> =>
    Effect.gen(function* () {
      const context = activeRuns.get(runID)
      if (context) {
        context.status = "cancelled"
        activeRuns.delete(runID)
      }
      Db.updateGraphRun(runID, {
        status: "cancelled",
        context_envelope: { error: reason },
        updated_at: Date.now(),
      })
    })

  return {
    run,
    resumeWithToken,
    cancel,
  }
}

export * as Engine from "./engine"
