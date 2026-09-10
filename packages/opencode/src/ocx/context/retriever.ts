export * as ContextRetriever from "./retriever"

import { ContextGraph } from "./graph"
import { ContextPacketBuilder } from "./packet"
import type {
  ComponentContext,
  ContextBudget,
  ContextNode,
  ContextPacket,
  ContextQuery,
  PipelineContext,
  RepositoryContext,
} from "./types"
import { DEFAULT_CONTEXT_BUDGET } from "./types"

export type Candidate = {
  readonly type: "pipeline" | "node" | "component"
  readonly id: string
  readonly score: number
  readonly reason: string
}

export type RetrieveInput = {
  readonly context: RepositoryContext
  readonly query: ContextQuery
  readonly budget?: Partial<ContextBudget>
  readonly semanticScore?: (query: string, candidate: string) => number
}

export type RetrieveResult = {
  readonly packet: ContextPacket
  readonly candidates: readonly Candidate[]
}

const CONFIDENCE_SCORE: Record<string, number> = {
  VERIFIED: 5,
  SUPPORTED: 3,
  INFERRED: 1,
  UNKNOWN: 0,
  HYPOTHESIS: -5,
  STALE: -4,
  CONFLICTED: -6,
}

export function retrieve(input: RetrieveInput): RetrieveResult {
  const context = input.context
  if (context.manifest.repositoryID !== input.query.repositoryID)
    return {
      packet: ContextPacketBuilder.build({
        context,
        scope: "repository mismatch",
        pipelines: [],
        nodes: [],
        edges: [],
        budget: input.budget,
      }),
      candidates: [],
    }
  const graph = ContextGraph.fromContext(context)
  const queryText = [
    input.query.taskText ?? "",
    ...(input.query.scopeHints ?? []),
    ...(input.query.files ?? []),
    ...(input.query.symbols ?? []),
    input.query.module ?? "",
    input.query.pipeline ?? "",
  ].join(" ")
  const candidates = [
    ...context.pipelines.map((pipeline) => scorePipeline(pipeline, input.query, queryText, input.semanticScore)),
    ...context.nodes.map((node) => scoreNode(node, input.query, queryText, input.semanticScore)),
    ...context.components.map((component) => scoreComponent(component, input.query, queryText, input.semanticScore)),
  ]
    .filter((candidate) => candidate.score > 0)
    .toSorted((a, b) => b.score - a.score || a.type.localeCompare(b.type) || a.id.localeCompare(b.id))
  const budget = normalizeBudget(input.budget)
  const directNodes = selectNodes(context.nodes, candidates, input.query, budget.maxNodes)
  const selectedPipelines = selectPipelines(
    context.pipelines,
    candidates,
    budget.maxPipelines,
    directNodes.map((node) => node.id),
    input.query.pipeline === undefined,
  )
  const neighborNodes = directNodes.flatMap((node) => ContextGraph.neighbors(graph, node.id, 1, budget.maxNodes))
  const nodes = uniqueByID([
    ...selectedPipelines.flatMap((pipeline) =>
      pipeline.nodeIDs.flatMap((id) => {
        const node = findNode(context.nodes, id)
        return node ? [node] : []
      }),
    ),
    ...directNodes,
    ...neighborNodes.map((item) => item.node),
  ]).slice(0, budget.maxNodes)
  const selectedNodeIDs = new Set(nodes.map((node) => node.id))
  const edges = context.edges
    .filter((edge) => selectedNodeIDs.has(edge.from) && selectedNodeIDs.has(edge.to))
    .filter(
      (edge) => selectedPipelines.some((pipeline) => pipeline.edgeIDs.includes(edge.id)) || directNodes.length > 0,
    )
    .toSorted((a, b) => a.id.localeCompare(b.id))
    .slice(0, budget.maxEdges)
  const components = context.components
    .filter(
      (component) =>
        componentMatchesNodes(component, nodes) ||
        candidates.some((candidate) => candidate.type === "component" && candidate.id === component.id),
    )
    .toSorted((a, b) => a.id.localeCompare(b.id))
    .slice(0, budget.maxNodes)
  const packet = ContextPacketBuilder.build({
    context,
    scope: input.query.pipeline ?? input.query.module ?? input.query.scopeHints?.[0] ?? "task",
    pipelines: selectedPipelines,
    nodes,
    edges,
    components,
    budget,
  })
  return { packet, candidates }
}

export function byFile(
  context: RepositoryContext,
  repositoryID: ContextQuery["repositoryID"],
  file: string,
  budget?: Partial<ContextBudget>,
): RetrieveResult {
  return retrieve({ context, query: { repositoryID, files: [file] }, budget })
}

export function bySymbol(
  context: RepositoryContext,
  repositoryID: ContextQuery["repositoryID"],
  symbol: string,
  budget?: Partial<ContextBudget>,
): RetrieveResult {
  return retrieve({ context, query: { repositoryID, symbols: [symbol] }, budget })
}

export function byModule(
  context: RepositoryContext,
  repositoryID: ContextQuery["repositoryID"],
  module: string,
  budget?: Partial<ContextBudget>,
): RetrieveResult {
  return retrieve({ context, query: { repositoryID, module }, budget })
}

export function byPipeline(
  context: RepositoryContext,
  repositoryID: ContextQuery["repositoryID"],
  pipeline: string,
  budget?: Partial<ContextBudget>,
): RetrieveResult {
  return retrieve({ context, query: { repositoryID, pipeline }, budget })
}

function scorePipeline(
  pipeline: PipelineContext,
  query: ContextQuery,
  text: string,
  semanticScore: RetrieveInput["semanticScore"],
): Candidate {
  const direct =
    query.pipeline === pipeline.id || query.pipeline?.toLocaleLowerCase() === pipeline.name.toLocaleLowerCase()
  const fileMatch = (query.files ?? []).some((file) => pipelineMatchesFile(pipeline, file, query))
  const moduleMatch =
    query.module !== undefined && pipeline.name.toLocaleLowerCase().includes(query.module.toLocaleLowerCase())
  const tokenMatch = overlap(text, [pipeline.name, pipeline.kind, pipeline.summary, ...pipeline.unknowns])
  const semantic = semanticScore?.(text, `${pipeline.name} ${pipeline.summary}`) ?? 0
  return {
    type: "pipeline",
    id: pipeline.id,
    score:
      (direct ? 100 : 0) +
      (fileMatch ? 40 : 0) +
      (moduleMatch ? 30 : 0) +
      tokenMatch * 5 +
      semantic +
      CONFIDENCE_SCORE[pipeline.confidence] -
      stalePenalty(pipeline.status),
    reason: direct
      ? "exact pipeline match"
      : fileMatch
        ? "pipeline contains requested file"
        : "pipeline text or scope match",
  }
}

function scoreNode(
  node: ContextNode,
  query: ContextQuery,
  text: string,
  semanticScore: RetrieveInput["semanticScore"],
): Candidate {
  const files = metadataStrings(node.metadata, "file", "files")
  const symbols = metadataStrings(node.metadata, "symbol", "symbols")
  const directFile = (query.files ?? []).some((file) => files.includes(file))
  const directSymbol = (query.symbols ?? []).some((symbol) => symbols.includes(symbol) || node.canonicalName === symbol)
  const scope = (query.scopeHints ?? []).some(
    (hint) => node.canonicalName.toLocaleLowerCase().includes(hint.toLocaleLowerCase()) || files.includes(hint),
  )
  const overlapScore = overlap(text, [node.canonicalName, node.kind, ...files, ...symbols])
  const semantic = semanticScore?.(text, [node.canonicalName, ...files, ...symbols].join(" ")) ?? 0
  return {
    type: "node",
    id: node.id,
    score:
      (directSymbol ? 90 : 0) +
      (directFile ? 70 : 0) +
      (scope ? 25 : 0) +
      overlapScore * 4 +
      semantic +
      CONFIDENCE_SCORE[node.confidence] -
      stalePenalty(node.status),
    reason: directSymbol ? "exact symbol match" : directFile ? "exact file match" : "node scope or text match",
  }
}

function scoreComponent(
  component: ComponentContext,
  query: ContextQuery,
  text: string,
  semanticScore: RetrieveInput["semanticScore"],
): Candidate {
  const fileMatch = (query.files ?? []).some((file) => component.filePaths.includes(file))
  const symbolMatch = (query.symbols ?? []).some((symbol) => component.symbolNames.includes(symbol))
  const semantic = semanticScore?.(text, `${component.name} ${component.summary}`).valueOf() ?? 0
  return {
    type: "component",
    id: component.id,
    score:
      (symbolMatch ? 80 : 0) +
      (fileMatch ? 60 : 0) +
      overlap(text, [component.name, component.summary]) * 4 +
      semantic +
      CONFIDENCE_SCORE[component.confidence] -
      stalePenalty(component.status),
    reason: symbolMatch
      ? "exact component symbol match"
      : fileMatch
        ? "component contains requested file"
        : "component text match",
  }
}

function selectPipelines(
  pipelines: readonly PipelineContext[],
  candidates: readonly Candidate[],
  limit: number,
  relatedNodeIDs: readonly ContextNode["id"][],
  preferRelated: boolean,
): PipelineContext[] {
  const ranked = candidates
    .filter((candidate) => candidate.type === "pipeline")
    .map((candidate) => pipelines.find((pipeline) => pipeline.id === candidate.id))
    .filter((value): value is PipelineContext => value !== undefined)
  const related = pipelines.filter((pipeline) => pipeline.nodeIDs.some((id) => relatedNodeIDs.includes(id)))
  if (preferRelated && related.length > 0) return related.toSorted(compareFreshness).slice(0, limit)
  if (ranked.length > 0) return uniqueByID(ranked).slice(0, limit)
  return pipelines
    .filter((pipeline) => pipeline.status === "active")
    .toSorted((a, b) => a.id.localeCompare(b.id))
    .slice(0, limit)
}

function selectNodes(
  nodes: readonly ContextNode[],
  candidates: readonly Candidate[],
  query: ContextQuery,
  limit: number,
): ContextNode[] {
  const exact = nodes.filter((node) => {
    const files = metadataStrings(node.metadata, "file", "files")
    const symbols = metadataStrings(node.metadata, "symbol", "symbols")
    return (
      (query.symbols ?? []).some((symbol) => symbols.includes(symbol) || node.canonicalName === symbol) ||
      (query.files ?? []).some((file) => files.includes(file))
    )
  })
  if (exact.length > 0) return exact.toSorted(compareFreshness).slice(0, limit)
  const ranked = candidates
    .filter((candidate) => candidate.type === "node")
    .map((candidate) => nodes.find((node) => node.id === candidate.id))
    .filter((value): value is ContextNode => value !== undefined)
  if (ranked.length > 0) return uniqueByID(ranked).slice(0, limit)
  return nodes
    .filter((node) =>
      (query.files ?? []).some((file) => metadataStrings(node.metadata, "file", "files").includes(file)),
    )
    .slice(0, limit)
}

function componentMatchesNodes(component: ComponentContext, nodes: readonly ContextNode[]): boolean {
  const files = nodes.flatMap((node) => metadataStrings(node.metadata, "file", "files"))
  const symbols = nodes.flatMap((node) => metadataStrings(node.metadata, "symbol", "symbols"))
  return (
    component.filePaths.some((file) => files.includes(file)) ||
    component.symbolNames.some((symbol) => symbols.includes(symbol))
  )
}

function pipelineMatchesFile(pipeline: PipelineContext, file: string, query: ContextQuery): boolean {
  return query.files?.includes(file) === true || pipeline.name.toLocaleLowerCase().includes(file.toLocaleLowerCase())
}

function findNode(nodes: readonly ContextNode[], id: ContextNode["id"]): ContextNode | undefined {
  return nodes.find((node) => node.id === id)
}

function metadataStrings(metadata: ContextNode["metadata"], ...keys: string[]): string[] {
  return keys.flatMap((key) => {
    const value = metadata[key]
    if (typeof value === "string") return [value]
    if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string")
    return []
  })
}

function overlap(query: string, values: readonly string[]): number {
  const words = new Set(tokens(query))
  return new Set(values.flatMap(tokens)).size === 0
    ? 0
    : [...new Set(values.flatMap(tokens))].filter((word) => words.has(word)).length
}

function tokens(value: string): string[] {
  return value.toLocaleLowerCase().match(/[a-z0-9_]+/g) ?? []
}

function stalePenalty(status: string): number {
  return status === "stale" ? 12 : status === "conflicted" ? 20 : 0
}

function compareFreshness(
  left: { readonly status: string; readonly confidence: string; readonly id: string },
  right: { readonly status: string; readonly confidence: string; readonly id: string },
): number {
  return (
    stalePenalty(left.status) - stalePenalty(right.status) ||
    (CONFIDENCE_SCORE[right.confidence] ?? 0) - (CONFIDENCE_SCORE[left.confidence] ?? 0) ||
    left.id.localeCompare(right.id)
  )
}

function normalizeBudget(input: Partial<ContextBudget> | undefined): ContextBudget {
  const positive = (value: number | undefined, fallback: number) =>
    Number.isInteger(value) && value !== undefined && value > 0 ? value : fallback
  return {
    maxChars: positive(input?.maxChars, DEFAULT_CONTEXT_BUDGET.maxChars),
    maxPipelines: positive(input?.maxPipelines, DEFAULT_CONTEXT_BUDGET.maxPipelines),
    maxNodes: positive(input?.maxNodes, DEFAULT_CONTEXT_BUDGET.maxNodes),
    maxEdges: positive(input?.maxEdges, DEFAULT_CONTEXT_BUDGET.maxEdges),
    maxFiles: positive(input?.maxFiles, DEFAULT_CONTEXT_BUDGET.maxFiles),
    maxEvidence: positive(input?.maxEvidence, DEFAULT_CONTEXT_BUDGET.maxEvidence),
  }
}

function uniqueByID<T extends { readonly id: string }>(items: readonly T[]): T[] {
  const values = new Map(items.map((item) => [item.id, item]))
  return [...values.values()]
}
