import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { join } from "node:path"
import { OCXDb } from "../../src/ocx/ocx-db"
import { Requirements } from "../../src/ocx/requirements"
import { TaskGraph } from "../../src/ocx/task-graph"
import { tmpdir } from "../fixture/fixture"

const repositoryID = "/workspace/example"
const input = {
  repositoryID,
  sessionID: "ses_graph",
  topic: "Implement retry handling",
  plan: [
    { do: "Map retry call sites", expect: "call sites are listed" },
    { do: "Add retry regression tests", expect: "test suite passes" },
  ],
  workstreams: [{ id: "runtime", goal: "Change runtime retry behavior" }],
  requirements: Requirements.fromText("Preserve the current public API.", "user", 1),
}

describe("durable task graph", () => {
  test("syncs a hierarchy, ordered dependencies, and linked requirements", () => {
    const graph = TaskGraph.sync(undefined, input)
    const goal = graph.nodes.find((node) => node.kind === "goal")
    const feature = graph.nodes.find((node) => node.kind === "feature")
    const tasks = graph.nodes.filter((node) => node.kind === "task")

    expect(goal).toBeDefined()
    expect(feature?.parentID).toBe(goal?.id)
    expect(tasks).toHaveLength(2)
    expect(tasks[0]?.parentID).toBe(feature?.id)
    expect(tasks[1]?.dependencyIDs).toEqual([tasks[0]?.id])
    const requirement = input.requirements[0]
    expect(requirement).toBeDefined()
    if (!requirement) return
    expect(tasks[0]?.requirementIDs).toEqual([requirement.id])
    expect(TaskGraph.ready(graph).map((node) => node.title)).toEqual(["Map retry call sites"])
  })

  test("keeps a repeated header idempotent and advances readiness after completion", () => {
    const graph = TaskGraph.sync(undefined, input)
    const repeated = TaskGraph.sync(graph, input)
    expect(repeated).toEqual(graph)

    const first = graph.nodes.find((node) => node.title === "Map retry call sites")
    const second = graph.nodes.find((node) => node.title === "Add retry regression tests")
    expect(first).toBeDefined()
    expect(second).toBeDefined()
    if (!first || !second) return

    const completed = TaskGraph.updateNode(graph, first.id, { status: "completed" })
    expect(completed).toBeDefined()
    if (!completed) return
    expect(TaskGraph.ready(completed).map((node) => node.id)).toEqual([second.id])
    const blocked = TaskGraph.updateNode(completed, second.id, { blockers: ["missing fixture"] })
    expect(blocked).toBeDefined()
    if (!blocked) return
    expect(TaskGraph.ready(blocked)).toEqual([])
  })

  test("rejects self-dependencies and dependency cycles", () => {
    const graph = TaskGraph.sync(undefined, input)
    const tasks = graph.nodes.filter((node) => node.kind === "task")
    const first = tasks[0]
    const second = tasks[1]
    expect(first).toBeDefined()
    expect(second).toBeDefined()
    if (!first || !second) return

    expect(TaskGraph.addDependency(graph, first.id, first.id)).toBeUndefined()
    expect(TaskGraph.addDependency(graph, first.id, second.id)).toBeUndefined()
  })

  test("keeps a valid current task when historical nodes reach the bound", () => {
    let graph: TaskGraph.Graph | undefined
    for (let index = 0; index < 128; index++) {
      graph = TaskGraph.sync(graph, {
        repositoryID,
        sessionID: `ses_old_${index}`,
        topic: `Implement task ${index}`,
        plan: [{ do: `Do work ${index}`, expect: "check passes" }],
        workstreams: [],
        requirements: [],
      })
    }
    expect(graph?.nodes).toHaveLength(256)
    if (!graph) return

    const next = TaskGraph.sync(graph, {
      repositoryID,
      sessionID: "ses_new",
      topic: "Implement latest task",
      plan: [{ do: "Do latest work", expect: "check passes" }],
      workstreams: [],
      requirements: [],
    })
    expect(next.nodes.length).toBeLessThanOrEqual(256)
    expect(next.nodes.some((node) => node.title === "Implement latest task")).toBe(true)
    expect(TaskGraph.parse(next)).toEqual(next)
  })

  test("round-trips graph and requirement ledger through sqlite", async () => {
    await using temp = await tmpdir()
    const store = await Effect.runPromise(OCXDb.open(join(temp.path, "nested", "workflow.db")))
    const graph = TaskGraph.sync(undefined, input)
    const requirement = input.requirements[0]
    expect(requirement).toBeDefined()
    if (!requirement) return
    const ledger = Requirements.verify(input.requirements, requirement.id, "passed", ["bun test"])

    store.setGraph(repositoryID, graph)
    store.setRequirementLedger(repositoryID, ledger)

    const reopened = await Effect.runPromise(OCXDb.open(join(temp.path, "nested", "workflow.db")))
    expect(reopened.getGraph(repositoryID)).toEqual(graph)
    expect(reopened.getRequirementLedger(repositoryID)).toEqual(ledger)
  })

  test("ignores malformed persisted graph data", async () => {
    await using temp = await tmpdir()
    const file = join(temp.path, "workflow.db")
    const store = await Effect.runPromise(OCXDb.open(file))
    store.setGraph(repositoryID, TaskGraph.sync(undefined, input))

    const { default: Database } = await import("bun:sqlite")
    const raw = new Database(file)
    raw.exec("UPDATE ocx_task_graph SET graph = '{broken'")
    raw.close()

    expect(store.getGraph(repositoryID)).toBeUndefined()
  })
})
