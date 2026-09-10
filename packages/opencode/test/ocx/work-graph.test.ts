import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { join } from "node:path"
import { OCXDb } from "../../src/ocx/ocx-db"
import { WorkGraphCompiler } from "../../src/ocx/work-graph/compiler"
import { WorkGraphReconciler } from "../../src/ocx/work-graph/reconciler"
import { WorkGraphReducer } from "../../src/ocx/work-graph/reducer"
import { WorkGraphRuntime } from "../../src/ocx/work-graph/runtime"
import { OPERATION_KINDS, type ActivityResult, type Event, type GraphPatch } from "../../src/ocx/work-graph/types"
import { tmpdir } from "../fixture/fixture"

function compile(request: string, currentGraph?: Parameters<typeof WorkGraphCompiler.compile>[0]["currentGraph"]) {
  const patch = WorkGraphCompiler.compile({
    request,
    sessionID: "session-1",
    repositoryID: "/work/project",
    currentGraph,
    intentRevision: 1,
    now: 1,
  })
  expect(patch).toBeDefined()
  return patch!
}

function graphFor(request: string, currentGraph?: Parameters<typeof WorkGraphCompiler.compile>[0]["currentGraph"]) {
  const patch = compile(request, currentGraph)
  const base = currentGraph ?? WorkGraphReducer.empty("session-1", "/work/project", 1)
  return WorkGraphReconciler.apply(base, patch, 2).graph
}

function eventFor(graph: ReturnType<typeof graphFor>): Event {
  return {
    eventID: "event-1",
    sessionID: graph.sessionID,
    graphID: graph.id,
    sequence: 1,
    type: "graph_created",
    graphRevision: graph.revision,
    intentRevision: graph.intentRevision,
    idempotencyKey: "graph:first",
    timestamp: graph.updatedAt,
    payload: { graph },
  }
}

describe("WorkGraph kernel", () => {
  test("inquiry recipes never emit a codegen operation", () => {
    expect((OPERATION_KINDS as readonly string[]).includes("codegen")).toBe(false)
    for (const request of ["Explain this module", "Research the migration", "Review this change", "Update the docs"]) {
      const node = compile(request).addNodes[0]!
      expect(["create_code", "modify_code", "create_test", "modify_test"]).not.toContain(node.operation)
    }
  })

  test("classifies explicit inquiry intent before semantic candidates", () => {
    expect(compile("docs").addNodes[0]!.intent).toEqual(["document"])
    expect(compile("review this diff").addNodes[0]!.operation).toBe("review_code")
    expect(compile("debug the failure").addNodes[0]!.operation).toBe("diagnose")
  })

  test("blocks dependent nodes until their prerequisite is terminal", () => {
    const first = compile("Explain the current behavior").addNodes[0]!
    const second = { ...compile("Research the compatibility risk").addNodes[0]!, dependencies: [first.id] }
    const patch: GraphPatch = {
      ...compile("Explain the current behavior"),
      addNodes: [first, second],
      addEdges: [{ from: first.id, to: second.id, kind: "requires" }],
    }
    const graph = WorkGraphReconciler.apply(WorkGraphReducer.empty("session-1", "/work/project", 1), patch, 2).graph
    expect(WorkGraphReducer.ready(graph).map((node) => node.id)).toEqual([first.id])
    const running = WorkGraphReducer.transition(graph, first.id, "running", 3)!
    const evaluating = WorkGraphReducer.transition(running, first.id, "evaluating", 4)!
    const completed = WorkGraphReducer.transition(evaluating, first.id, "completed", 5)!
    expect(WorkGraphReducer.ready(completed).map((node) => node.id)).toEqual([second.id])
  })

  test("rejects stale activity results without changing the graph", () => {
    const graph = graphFor("Explain the current behavior")
    const node = graph.nodes[0]!
    const running = WorkGraphReducer.transition(graph, node.id, "running", 3)!
    const result: ActivityResult = {
      id: "activity-1",
      nodeID: node.id,
      status: "succeeded",
      graphRevision: graph.revision,
      intentRevision: graph.intentRevision,
      nodeRevision: node.revision,
      evidence: [],
    }
    const applied = WorkGraphReducer.applyActivityResult(running, result, 4)
    expect(applied.stale).toBe(true)
    expect(applied.applied).toBe(false)
    expect(applied.graph).toEqual(running)
  })

  test("persists and replays a graph snapshot and event in memory", () => {
    const graph = graphFor("Review this change")
    const event = eventFor(graph)
    const store = OCXDb.memory()
    store.saveWorkGraph(graph, [event])
    expect(store.getWorkGraph(graph.sessionID)).toEqual(graph)
    expect(WorkGraphReducer.replay(store.workGraphEvents(graph.sessionID))).toEqual(graph)
    expect(() => store.saveWorkGraph(graph, [event])).not.toThrow()
  })

  test("round-trips a graph snapshot and event through SQLite", async () => {
    await using temp = await tmpdir()
    const graph = graphFor("Research the compatibility risk")
    const event = eventFor(graph)
    const first = await Effect.runPromise(OCXDb.open(join(temp.path, "nested", "work-graph.db")))
    first.saveWorkGraph(graph, [event])
    const second = await Effect.runPromise(OCXDb.open(join(temp.path, "nested", "work-graph.db")))
    expect(second.getWorkGraph(graph.sessionID)).toEqual(graph)
    expect(second.workGraphEvents(graph.sessionID)).toEqual([event])
  })

  test("serializes graph writes per session", async () => {
    const trace: string[] = []
    let release: (() => void) | undefined
    const first = WorkGraphRuntime.dispatch("session-serial", () =>
      Effect.promise(
        () =>
          new Promise<number>((resolve) => {
            trace.push("first")
            release = () => resolve(1)
          }),
      ),
    )
    const second = WorkGraphRuntime.dispatch("session-serial", () =>
      Effect.sync(() => {
        trace.push("second")
        return 2
      }),
    )
    const firstResult = Effect.runPromise(first)
    const secondResult = Effect.runPromise(second)
    await Promise.resolve()
    expect(trace).toEqual(["first"])
    release?.()
    expect(await Promise.all([firstResult, secondResult])).toEqual([1, 2])
    expect(trace).toEqual(["first", "second"])
    WorkGraphRuntime.clear("session-serial")
  })
})
