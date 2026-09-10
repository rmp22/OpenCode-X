import { isSatisfied } from "./reducer"
import type { Graph, WorkNode } from "./types"

export type TodoProjectionItem = {
  readonly content: string
  readonly status: "pending" | "in_progress" | "completed" | "cancelled"
  readonly priority: "high" | "medium" | "low"
}

export function projectRemainingWork(graph: Graph): readonly WorkNode[] {
  return graph.nodes.filter(
    (node) => node.status !== "completed" && node.status !== "superseded" && node.status !== "cancelled",
  )
}

export function projectTodos(graph: Graph): readonly TodoProjectionItem[] {
  return graph.nodes.map((node) => ({
    content: `[${node.operation}] ${node.goal}`,
    status:
      node.status === "completed"
        ? ("completed" as const)
        : node.status === "cancelled" || node.status === "superseded"
          ? ("cancelled" as const)
          : node.status === "running"
            ? ("in_progress" as const)
            : ("pending" as const),
    priority: (node.risk?.level === "destructive" || node.risk?.level === "high" ? "high" : "medium") as "high" | "medium" | "low",
  }))
}

export function isWorkComplete(graph: Graph): boolean {
  return isSatisfied(graph)
}

export * as WorkGraphProjections from "./projections"
