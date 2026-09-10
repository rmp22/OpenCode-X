import { isSatisfied, validate } from "./reducer"
import { GRAPH_VERSION, type Graph, type GraphPatch, type NodeStatus, type WorkEdge, type WorkNode } from "./types"

const TERMINAL = new Set<NodeStatus>(["completed", "superseded", "cancelled"])

export type ReconcileResult = {
  readonly graph: Graph
  readonly changed: boolean
  readonly supersededNodeIDs: readonly string[]
}

export function apply(graph: Graph, patch: GraphPatch, now = Date.now()): ReconcileResult {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]))
  const edges = new Map(graph.edges.map((edge) => [edgeKey(edge), edge]))
  const supersededNodeIDs: string[] = []

  for (const nodeID of patch.removeNodeIDs) {
    if (!nodes.delete(nodeID)) continue
    for (const key of edges.keys()) {
      const edge = edges.get(key)
      if (edge && (edge.from === nodeID || edge.to === nodeID)) edges.delete(key)
    }
  }

  for (const nodeID of patch.supersedeNodeIDs) {
    const current = nodes.get(nodeID)
    if (!current || TERMINAL.has(current.status)) continue
    nodes.set(nodeID, { ...current, status: "superseded", revision: current.revision + 1, updatedAt: now })
    supersededNodeIDs.push(nodeID)
  }

  for (const node of patch.addNodes) {
    const current = nodes.get(node.id)
    if (!current) {
      nodes.set(node.id, node)
      continue
    }
    if (current.status === "completed") continue
    nodes.set(node.id, { ...node, status: current.status, revision: current.revision, updatedAt: current.updatedAt })
  }

  for (const edge of patch.addEdges) edges.set(edgeKey(edge), edge)
  for (const edge of patch.removeEdges) edges.delete(edgeKey(edge))

  const refreshed = refreshReady([...nodes.values()], [...edges.values()], now)
  const changed =
    graph.intentKey !== patch.intentKey ||
    graph.intentRevision !== patch.intentRevision ||
    JSON.stringify(graph.nodes) !== JSON.stringify(refreshed.nodes) ||
    JSON.stringify(graph.edges) !== JSON.stringify(refreshed.edges)
  if (!changed) return { graph, changed: false, supersededNodeIDs: [] }

  const next: Graph = {
    ...graph,
    intentKey: patch.intentKey,
    intentRevision: patch.intentRevision,
    nodes: refreshed.nodes,
    edges: refreshed.edges,
    revision: graph.revision + 1,
    status: graphStatus(refreshed.nodes, patch),
    updatedAt: now,
  }
  if (!validate(next)) return { graph, changed: false, supersededNodeIDs: [] }
  return { graph: next, changed: true, supersededNodeIDs }
}

function edgeKey(edge: WorkEdge): string {
  return `${edge.from}\u0000${edge.to}\u0000${edge.kind}`
}

function refreshReady(
  nodes: readonly WorkNode[],
  edges: readonly WorkEdge[],
  now: number,
): { nodes: WorkNode[]; edges: WorkEdge[] } {
  const byID = new Map(nodes.map((node) => [node.id, node]))
  const dependencies = new Map<string, string[]>()
  for (const node of nodes) dependencies.set(node.id, [...node.dependencies])
  for (const edge of edges) {
    if (edge.kind !== "requires") continue
    dependencies.set(edge.to, [...(dependencies.get(edge.to) ?? []), edge.from])
  }
  const nextNodes = nodes.map((node) => {
    const required = [...new Set(dependencies.get(node.id) ?? [])]
    const nextDependencies =
      JSON.stringify(node.dependencies) === JSON.stringify(required) ? node.dependencies : required
    if (
      node.status !== "pending" ||
      !required.every((dependency) => TERMINAL.has(byID.get(dependency)?.status ?? "pending"))
    )
      return nextDependencies === node.dependencies ? node : { ...node, dependencies: nextDependencies, updatedAt: now }
    return { ...node, dependencies: nextDependencies, status: "ready" as const, updatedAt: now }
  })
  return { nodes: nextNodes, edges: [...edges] }
}

function graphStatus(nodes: readonly WorkNode[], patch: GraphPatch): Graph["status"] {
  const graph: Graph = {
    version: GRAPH_VERSION,
    id: "status",
    sessionID: "status",
    revision: 0,
    intentRevision: patch.intentRevision,
    intentKey: patch.intentKey,
    nodes,
    edges: [],
    status: "active",
    createdAt: 0,
    updatedAt: 0,
  }
  if (isSatisfied(graph)) return "satisfied"
  if (nodes.length > 0 && nodes.every((node) => TERMINAL.has(node.status))) return "cancelled"
  if (nodes.length === 0 || nodes.every((node) => node.status === "blocked" || node.status === "needs_input"))
    return "waiting"
  return "active"
}

export * as WorkGraphReconciler from "./reconciler"
