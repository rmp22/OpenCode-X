export * as ContextGraph from "./graph"

import { createHash } from "node:crypto"
import type {
  ComponentContext,
  ContextEdge,
  ContextEdgeID,
  ContextEntryID,
  ContextNode,
  ContextNodeID,
  ContextStatus,
  EdgeRelation,
  PipelineContext,
  PipelineID,
  RepositoryContext,
  RepositoryID,
} from "./types"
import { edgeID, nodeID, normalizeName } from "./types"

export type Graph = {
  readonly repositoryID: RepositoryID
  readonly nodes: readonly ContextNode[]
  readonly edges: readonly ContextEdge[]
  readonly pipelines: readonly PipelineContext[]
  readonly components: readonly ComponentContext[]
}

export type GraphIndexes = {
  readonly nodeByID: ReadonlyMap<ContextNodeID, ContextNode>
  readonly nodeByName: ReadonlyMap<string, ContextNodeID>
  readonly aliasToNode: ReadonlyMap<string, ContextNodeID>
  readonly fileToNodes: ReadonlyMap<string, readonly ContextNodeID[]>
  readonly symbolToNodes: ReadonlyMap<string, readonly ContextNodeID[]>
  readonly pipelineToNodes: ReadonlyMap<PipelineID, readonly ContextNodeID[]>
  readonly relationToEdges: ReadonlyMap<EdgeRelation, readonly ContextEdge[]>
  readonly ownerToEntries: ReadonlyMap<string, readonly ContextEntryID[]>
  readonly staleEntries: readonly ContextEntryID[]
}

export type Neighbor = {
  readonly node: ContextNode
  readonly edge: ContextEdge
  readonly distance: number
}

export function create(input: RepositoryContext | { readonly repositoryID: RepositoryID }): Graph {
  if ("manifest" in input)
    return {
      repositoryID: input.manifest.repositoryID,
      nodes: [...input.nodes],
      edges: [...input.edges],
      pipelines: [...input.pipelines],
      components: [...input.components],
    }
  return { repositoryID: input.repositoryID, nodes: [], edges: [], pipelines: [], components: [] }
}

export function fromContext(context: RepositoryContext): Graph {
  return create(context)
}

export function toContext(graph: Graph, base: RepositoryContext): RepositoryContext {
  return {
    ...base,
    nodes: [...graph.nodes],
    edges: [...graph.edges],
    pipelines: [...graph.pipelines],
    components: [...graph.components],
  }
}

export function upsertNode(graph: Graph, node: ContextNode): Graph {
  ensureRepository(graph.repositoryID, node.repositoryID)
  const normalized = {
    ...node,
    canonicalName: normalizeName(node.canonicalName),
    aliases: [...new Set(node.aliases.map(normalizeName))],
  }
  return { ...graph, nodes: replaceByID(graph.nodes, normalized) }
}

export function upsertEdge(graph: Graph, edge: ContextEdge): Graph {
  ensureRepository(graph.repositoryID, edge.repositoryID)
  if (edge.from === edge.to) throw new Error("context graph does not allow self edges")
  if (!graph.nodes.some((node) => node.id === edge.from) || !graph.nodes.some((node) => node.id === edge.to))
    throw new Error("context edge endpoints must exist")
  return { ...graph, edges: replaceByID(graph.edges, edge) }
}

export function upsertPipeline(graph: Graph, pipeline: PipelineContext): Graph {
  ensureRepository(graph.repositoryID, pipeline.repositoryID)
  if (pipeline.nodeIDs.some((id) => !graph.nodes.some((node) => node.id === id)))
    throw new Error("pipeline references an unknown node")
  if (pipeline.edgeIDs.some((id) => !graph.edges.some((edge) => edge.id === id)))
    throw new Error("pipeline references an unknown edge")
  return { ...graph, pipelines: replaceByID(graph.pipelines, pipeline) }
}

export function upsertComponent(graph: Graph, component: ComponentContext): Graph {
  ensureRepository(graph.repositoryID, component.repositoryID)
  return { ...graph, components: replaceByID(graph.components, component) }
}

export function remove(
  graph: Graph,
  entry: { readonly type: "node" | "edge" | "pipeline" | "component"; readonly id: string },
): Graph {
  if (entry.type === "node") {
    const nodes = graph.nodes.filter((node) => node.id !== entry.id)
    const removedEdges = new Set(
      graph.edges.filter((edge) => edge.from === entry.id || edge.to === entry.id).map((edge) => edge.id),
    )
    return {
      ...graph,
      nodes,
      edges: graph.edges.filter((edge) => !removedEdges.has(edge.id)),
      pipelines: graph.pipelines.map((pipeline) => ({
        ...pipeline,
        nodeIDs: pipeline.nodeIDs.filter((id) => id !== entry.id),
        edgeIDs: pipeline.edgeIDs.filter((id) => !removedEdges.has(id)),
      })),
    }
  }
  if (entry.type === "edge")
    return {
      ...graph,
      edges: graph.edges.filter((edge) => edge.id !== entry.id),
      pipelines: graph.pipelines.map((pipeline) => ({
        ...pipeline,
        edgeIDs: pipeline.edgeIDs.filter((id) => id !== entry.id),
      })),
    }
  if (entry.type === "pipeline")
    return { ...graph, pipelines: graph.pipelines.filter((pipeline) => pipeline.id !== entry.id) }
  return { ...graph, components: graph.components.filter((component) => component.id !== entry.id) }
}

export function buildIndexes(graph: Graph): GraphIndexes {
  const nodeByID = new Map(graph.nodes.map((node) => [node.id, node]))
  const nodeByName = new Map<string, ContextNodeID>()
  const aliasToNode = new Map<string, ContextNodeID>()
  const fileToNodes = new Map<string, ContextNodeID[]>()
  const symbolToNodes = new Map<string, ContextNodeID[]>()
  const pipelineToNodes = new Map<PipelineID, readonly ContextNodeID[]>()
  const relationToEdges = new Map<EdgeRelation, ContextEdge[]>()
  const ownerToEntries = new Map<string, ContextEntryID[]>()
  for (const node of graph.nodes.toSorted((a, b) => a.id.localeCompare(b.id))) {
    nodeByName.set(node.canonicalName.toLocaleLowerCase(), node.id)
    for (const alias of node.aliases) aliasToNode.set(alias.toLocaleLowerCase(), node.id)
    addIndex(fileToNodes, metadataStrings(node.metadata, "file", "files"), node.id)
    addIndex(symbolToNodes, metadataStrings(node.metadata, "symbol", "symbols"), node.id)
    addIndex(ownerToEntries, metadataStrings(node.metadata, "owner", "owners"), node.id)
    if (node.status === "stale" || node.status === "conflicted") addIndex(ownerToEntries, ["__status__"], node.id)
  }
  for (const pipeline of graph.pipelines.toSorted((a, b) => a.id.localeCompare(b.id))) {
    pipelineToNodes.set(pipeline.id, [...pipeline.nodeIDs])
    addIndex(ownerToEntries, pipeline.ownerIDs, pipeline.id)
    if (pipeline.status === "stale" || pipeline.status === "conflicted")
      addIndex(ownerToEntries, ["__status__"], pipeline.id)
  }
  for (const edge of graph.edges.toSorted((a, b) => a.id.localeCompare(b.id))) {
    const list = relationToEdges.get(edge.relation) ?? []
    list.push(edge)
    relationToEdges.set(edge.relation, list)
    if (edge.status === "stale" || edge.status === "conflicted") addIndex(ownerToEntries, ["__status__"], edge.id)
  }
  return {
    nodeByID,
    nodeByName,
    aliasToNode,
    fileToNodes,
    symbolToNodes,
    pipelineToNodes,
    relationToEdges,
    ownerToEntries,
    staleEntries: [
      ...new Set([
        ...graph.nodes.filter((node) => node.status === "stale" || node.status === "conflicted").map((node) => node.id),
        ...graph.edges.filter((edge) => edge.status === "stale" || edge.status === "conflicted").map((edge) => edge.id),
        ...graph.pipelines
          .filter((pipeline) => pipeline.status === "stale" || pipeline.status === "conflicted")
          .map((pipeline) => pipeline.id),
        ...graph.components
          .filter((component) => component.status === "stale" || component.status === "conflicted")
          .map((component) => component.id),
      ]),
    ].sort(),
  }
}

export function findNode(graph: Graph, value: string): ContextNode | undefined {
  const normalized = value.trim().toLocaleLowerCase()
  return graph.nodes.find(
    (node) =>
      node.id === value ||
      node.canonicalName.toLocaleLowerCase() === normalized ||
      node.aliases.some((alias) => alias.toLocaleLowerCase() === normalized),
  )
}

export function neighbors(graph: Graph, start: ContextNodeID, maxDistance = 1, limit = 32): Neighbor[] {
  if (!graph.nodes.some((node) => node.id === start)) return []
  const result: Neighbor[] = []
  const queue: Array<{ readonly id: ContextNodeID; readonly distance: number }> = [{ id: start, distance: 0 }]
  const visited = new Set<ContextNodeID>([start])
  while (queue.length > 0 && result.length < Math.max(0, limit)) {
    const current = queue.shift()
    if (!current || current.distance >= maxDistance) continue
    for (const edge of graph.edges
      .filter((item) => item.from === current.id || item.to === current.id)
      .toSorted((a, b) => a.id.localeCompare(b.id))) {
      const next = edge.from === current.id ? edge.to : edge.from
      if (visited.has(next)) continue
      visited.add(next)
      const node = graph.nodes.find((item) => item.id === next)
      if (!node) continue
      const distance = current.distance + 1
      result.push({ node, edge, distance })
      queue.push({ id: next, distance })
      if (result.length >= limit) break
    }
  }
  return result
}

export function entriesForFile(graph: Graph, file: string): ContextEntryID[] {
  const nodes = graph.nodes
    .filter((node) => metadataStrings(node.metadata, "file", "files").includes(file))
    .map((node) => node.id)
  const edges = graph.edges
    .filter((edge) => nodes.includes(edge.from) || nodes.includes(edge.to))
    .map((edge) => edge.id)
  const pipelines = graph.pipelines
    .filter(
      (pipeline) =>
        pipeline.nodeIDs.some((id) => nodes.includes(id)) || pipeline.edgeIDs.some((id) => edges.includes(id)),
    )
    .map((pipeline) => pipeline.id)
  const components = graph.components
    .filter((component) => component.filePaths.includes(file))
    .map((component) => component.id)
  return [...nodes, ...edges, ...pipelines, ...components]
}

export function markStatus(graph: Graph, ids: readonly ContextEntryID[], status: ContextStatus): Graph {
  const wanted = new Set(ids)
  return {
    ...graph,
    nodes: graph.nodes.map((node) => (wanted.has(node.id) ? { ...node, status } : node)),
    edges: graph.edges.map((edge) => (wanted.has(edge.id) ? { ...edge, status } : edge)),
    pipelines: graph.pipelines.map((pipeline) => (wanted.has(pipeline.id) ? { ...pipeline, status } : pipeline)),
    components: graph.components.map((component) => (wanted.has(component.id) ? { ...component, status } : component)),
  }
}

export function stableEdgeID(input: {
  readonly from: ContextNodeID
  readonly to: ContextNodeID
  readonly relation: EdgeRelation
}): ContextEdgeID {
  return edgeID(
    `edge-${createHash("sha256").update(`${input.from}\0${input.to}\0${input.relation}`).digest("hex").slice(0, 32)}`,
  )
}

function ensureRepository(expected: RepositoryID, actual: RepositoryID): void {
  if (expected !== actual) throw new Error("context graph repository mismatch")
}

function replaceByID<T extends { readonly id: string }>(items: readonly T[], next: T): T[] {
  return items.some((item) => item.id === next.id)
    ? items.map((item) => (item.id === next.id ? next : item))
    : [...items, next]
}

function metadataStrings(metadata: ContextNode["metadata"], ...keys: string[]): string[] {
  return keys.flatMap((key) => {
    const value = metadata[key]
    if (typeof value === "string") return [value]
    if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string")
    return []
  })
}

function addIndex<T extends ContextEntryID>(index: Map<string, T[]>, values: readonly string[], id: T): void {
  for (const value of values) {
    const key = value.toLocaleLowerCase()
    const list = index.get(key) ?? []
    if (!list.includes(id)) list.push(id)
    index.set(key, list)
  }
}
