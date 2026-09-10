import type { ExecutionGraph, GraphNode, GraphEdge, NodeId } from "./types"

export type ValidationError = {
  readonly code:
    | "cycle_detected"
    | "unreachable_terminal"
    | "dead_end_node"
    | "invalid_edge"
    | "missing_initial_node"
    | "duplicate_node_id"
    | "self_referential_edge"
  readonly message: string
  readonly details?: Record<string, unknown>
}

export function validateGraph(graph: ExecutionGraph): readonly ValidationError[] {
  const errors: ValidationError[] = []
  const nodeMap = new Map<NodeId, GraphNode>()
  for (const node of graph.nodes) {
    if (nodeMap.has(node.id)) {
      errors.push({
        code: "duplicate_node_id",
        message: `Duplicate node ID: ${node.id}`,
        details: { nodeId: node.id },
      })
    }
    nodeMap.set(node.id, node)
  }

  if (!nodeMap.has(graph.initialNodeId)) {
    errors.push({
      code: "missing_initial_node",
      message: `Initial node ${graph.initialNodeId} does not exist in graph nodes`,
      details: { initialNodeId: graph.initialNodeId },
    })
  }

  for (const edge of graph.edges) {
    if (!nodeMap.has(edge.from) || !nodeMap.has(edge.to)) {
      errors.push({
        code: "invalid_edge",
        message: `Edge connects non-existent nodes: ${edge.from} -> ${edge.to}`,
        details: { from: edge.from, to: edge.to },
      })
    }
    if (edge.from === edge.to) {
      errors.push({
        code: "self_referential_edge",
        message: `Edge is self-referential: ${edge.from} -> ${edge.to}`,
        details: { from: edge.from, to: edge.to },
      })
    }
  }

  const outgoing = new Map<NodeId, GraphEdge[]>()
  for (const edge of graph.edges) {
    const list = outgoing.get(edge.from) ?? []
    list.push(edge)
    outgoing.set(edge.from, list)
  }

  for (const node of graph.nodes) {
    if (node.kind !== "terminal") {
      const edges = outgoing.get(node.id) ?? []
      if (edges.length === 0) {
        errors.push({
          code: "dead_end_node",
          message: `Non-terminal node ${node.id} has no outgoing edges`,
          details: { nodeId: node.id },
        })
      }
    }
  }

  const reachableFromInitial = new Set<NodeId>()
  const queue: NodeId[] = [graph.initialNodeId]
  reachableFromInitial.add(graph.initialNodeId)
  while (queue.length > 0) {
    const current = queue.shift()!
    const edges = outgoing.get(current) ?? []
    for (const edge of edges) {
      if (!reachableFromInitial.has(edge.to)) {
        reachableFromInitial.add(edge.to)
        queue.push(edge.to)
      }
    }
  }

  for (const terminalId of graph.terminalNodeIds) {
    if (!reachableFromInitial.has(terminalId)) {
      errors.push({
        code: "unreachable_terminal",
        message: `Terminal node ${terminalId} is not reachable from initial node ${graph.initialNodeId}`,
        details: { terminalId, initialNodeId: graph.initialNodeId },
      })
    }
  }

  const forwardAdj = new Map<NodeId, NodeId[]>()
  for (const edge of graph.edges) {
    if (!edge.isRetry) {
      const list = forwardAdj.get(edge.from) ?? []
      list.push(edge.to)
      forwardAdj.set(edge.from, list)
    }
  }

  const visited = new Set<NodeId>()
  const inStack = new Set<NodeId>()
  let hasCycle = false
  let cyclePath: NodeId[] = []

  function dfs(nodeId: NodeId, path: NodeId[]): boolean {
    visited.add(nodeId)
    inStack.add(nodeId)
    path.push(nodeId)

    const neighbors = forwardAdj.get(nodeId) ?? []
    for (const next of neighbors) {
      if (!visited.has(next)) {
        if (dfs(next, path)) return true
      } else if (inStack.has(next)) {
        hasCycle = true
        cyclePath = [...path, next]
        return true
      }
    }

    inStack.delete(nodeId)
    path.pop()
    return false
  }

  for (const node of graph.nodes) {
    if (!visited.has(node.id)) {
      if (dfs(node.id, [])) break
    }
  }

  if (hasCycle) {
    errors.push({
      code: "cycle_detected",
      message: `Cycle detected in graph forward edges: ${cyclePath.join(" -> ")}`,
      details: { cycle: cyclePath },
    })
  }

  return errors
}

export function isValidTransition(graph: ExecutionGraph, from: NodeId, to: NodeId): boolean {
  return graph.edges.some((edge) => edge.from === from && edge.to === to)
}

export * as GraphValidation from "./validation"
