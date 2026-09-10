import type { WorkModel, WorkstreamUnit, WorkStep, WorkItemStatus } from "./model"
import { createWorkModel } from "./model"
import type { TaskGraph } from "../task-graph"

export function mapTaskStatus(status: string): WorkItemStatus {
  switch (status.toLowerCase()) {
    case "completed":
    case "done":
    case "pass":
      return "completed"
    case "in_progress":
    case "active":
    case "running":
      return "in_progress"
    case "blocked":
    case "failed":
      return "blocked"
    case "pending":
    case "ready":
    case "planned":
    default:
      return "pending"
  }
}

export function workstreamToWorkModel(
  sessionID: string,
  goal: string,
  workstreams: ReadonlyArray<{
    readonly id: string
    readonly goal?: string
    readonly name?: string
    readonly status?: string
    readonly steps?: ReadonlyArray<{
      readonly id: string
      readonly title?: string
      readonly action?: string
      readonly status?: string
      readonly checks?: ReadonlyArray<{ readonly id?: string; readonly description: string; readonly status?: string }>
    }>
  }>,
): WorkModel {
  const units: WorkstreamUnit[] = workstreams.map((ws, wsIdx) => {
    const wsStatus = mapTaskStatus(ws.status ?? "pending")
    const steps: WorkStep[] = (ws.steps ?? []).map((step, sIdx) => {
      const stepStatus = mapTaskStatus(step.status ?? "pending")
      const checks = (step.checks ?? []).map((c, cIdx) => ({
        id: c.id ?? `check_${wsIdx}_${sIdx}_${cIdx}`,
        description: c.description,
        status: (c.status === "pass" || c.status === "completed" ? "pass" : c.status === "fail" ? "fail" : "pending") as "pending" | "pass" | "fail",
      }))
      const stepItem: WorkStep = {
        id: step.id ?? `step_${wsIdx}_${sIdx}`,
        title: step.title ?? step.action ?? `Step ${sIdx + 1}`,
        action: step.action ?? step.title ?? "",
        status: stepStatus,
        checks,
      }
      return stepItem
    })
    const wsUnit: WorkstreamUnit = {
      id: ws.id ?? `ws_${wsIdx}`,
      title: ws.goal ?? ws.name ?? `Workstream ${wsIdx + 1}`,
      status: wsStatus,
      steps,
    }
    return wsUnit
  })

  const model = createWorkModel({
    id: `wm_${sessionID}`,
    sessionID,
    goal,
    workstreams: units,
  })
  return model
}

export function taskGraphToWorkModel(graph: TaskGraph.Graph, sessionID = "default"): WorkModel {
  const goals = graph.nodes.filter((n) => n.kind === "goal")
  const goalTitle = goals[0]?.title ?? `Graph for ${graph.repositoryID}`

  const featureNodes = graph.nodes.filter((n) => n.kind === "feature")
  const taskNodes = graph.nodes.filter((n) => n.kind === "task")

  const units: WorkstreamUnit[] = featureNodes.map((feat) => {
    const childTasks = taskNodes.filter((t) => t.parentID === feat.id)
    const steps: WorkStep[] = childTasks.map((task) => ({
      id: task.id,
      title: task.title,
      action: task.title,
      status: mapTaskStatus(task.status),
      checks: task.acceptanceCriteria.map((ac, idx) => ({
        id: `ac_${task.id}_${idx}`,
        description: ac,
        status: task.status === "completed" ? "pass" : "pending",
      })),
      graphNodeId: task.id,
    }))

    const unit: WorkstreamUnit = {
      id: feat.id,
      title: feat.title,
      status: mapTaskStatus(feat.status),
      steps,
    }
    return unit
  })

  if (units.length === 0 && taskNodes.length > 0) {
    units.push({
      id: "default_stream",
      title: goalTitle,
      status: "in_progress",
      steps: taskNodes.map((task) => ({
        id: task.id,
        title: task.title,
        action: task.title,
        status: mapTaskStatus(task.status),
        checks: task.acceptanceCriteria.map((ac, idx) => ({
          id: `ac_${task.id}_${idx}`,
          description: ac,
          status: task.status === "completed" ? "pass" : "pending",
        })),
        graphNodeId: task.id,
      })),
    })
  }

  const model = createWorkModel({
    id: `wm_${graph.repositoryID}_${sessionID}`,
    sessionID,
    goal: goalTitle,
    workstreams: units,
  })
  return model
}

export function todosToWorkModel(
  sessionID: string,
  goal: string,
  todos: ReadonlyArray<{ readonly content: string; readonly status: string }>,
): WorkModel {
  const steps: WorkStep[] = todos.map((t, idx) => ({
    id: `todo_${idx}`,
    title: t.content,
    action: t.content,
    status: mapTaskStatus(t.status),
    checks: [],
  }))

  const unit: WorkstreamUnit = {
    id: "ws_todos",
    title: goal,
    status: steps.every((s) => s.status === "completed") ? "completed" : "in_progress",
    steps,
  }

  const model = createWorkModel({
    id: `wm_todos_${sessionID}`,
    sessionID,
    goal,
    workstreams: [unit],
  })
  return model
}

export * as WorkAdapters from "./adapters"
