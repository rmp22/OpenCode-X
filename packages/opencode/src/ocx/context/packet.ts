export * as ContextPacketBuilder from "./packet"

import type {
  ComponentContext,
  ContextBudget,
  ContextClaim,
  ContextEdge,
  ContextNode,
  ContextPacket,
  PipelineContext,
  RepositoryContext,
} from "./types"
import { DEFAULT_CONTEXT_BUDGET } from "./types"

export type PacketInput = {
  readonly context: RepositoryContext
  readonly scope: string
  readonly pipelines: readonly PipelineContext[]
  readonly nodes: readonly ContextNode[]
  readonly edges: readonly ContextEdge[]
  readonly components?: readonly ComponentContext[]
  readonly budget?: Partial<ContextBudget>
  readonly freshness?: ContextPacket["freshness"]
  readonly recentChanges?: readonly string[]
}

export function build(input: PacketInput): ContextPacket {
  const budget = normalizeBudget(input.budget)
  const pipelines = uniqueByID(input.pipelines).slice(0, budget.maxPipelines)
  const nodes = uniqueByID(input.nodes).slice(0, budget.maxNodes)
  const edges = uniqueByID(input.edges).slice(0, budget.maxEdges)
  const components = uniqueByID(input.components ?? []).slice(0, budget.maxNodes)
  const files = uniqueStrings([
    ...nodes.flatMap((node) => metadataStrings(node.metadata, "file", "files")),
    ...components.flatMap((component) => component.filePaths),
  ]).slice(0, budget.maxFiles)
  const symbols = uniqueStrings([
    ...nodes.flatMap((node) => metadataStrings(node.metadata, "symbol", "symbols")),
    ...components.flatMap((component) => component.symbolNames),
  ]).slice(0, budget.maxFiles)
  const invariants = uniqueByID(pipelines.flatMap((pipeline) => pipeline.constraints)).slice(0, budget.maxEvidence)
  const unknowns = uniqueStrings(pipelines.flatMap((pipeline) => pipeline.unknowns)).slice(0, budget.maxEvidence)
  const ownerIDs = uniqueStrings([
    ...pipelines.flatMap((pipeline) => pipeline.ownerIDs),
    ...components.flatMap((component) => component.ownerIDs),
    ...nodes.flatMap((node) => metadataStrings(node.metadata, "owner", "owners")),
  ]).slice(0, budget.maxEvidence)
  const evidenceIDs = uniqueIDs([
    ...pipelines.flatMap((pipeline) => [
      ...pipeline.evidenceIDs,
      ...pipeline.constraints.flatMap((claim) => claim.evidenceIDs),
    ]),
    ...nodes.flatMap((node) => node.evidenceIDs),
    ...edges.flatMap((edge) => edge.evidenceIDs),
    ...components.flatMap((component) => component.evidenceIDs),
  ]).slice(0, budget.maxEvidence)
  const freshness = input.freshness ?? freshnessFor([...pipelines, ...nodes, ...edges, ...components])
  const packet: ContextPacket = {
    repositoryID: input.context.manifest.repositoryID,
    scope: input.scope,
    freshness,
    pipelineIDs: pipelines.map((pipeline) => pipeline.id),
    nodeIDs: nodes.map((node) => node.id),
    edgeIDs: edges.map((edge) => edge.id),
    files,
    symbols,
    invariants,
    unknowns,
    ownerIDs,
    recentChanges: uniqueStrings(input.recentChanges ?? []).slice(0, budget.maxEvidence),
    evidenceIDs,
  }
  return fit(packet, budget.maxChars)
}

function fit(packet: ContextPacket, maxChars: number): ContextPacket {
  const limit = positive(maxChars, DEFAULT_CONTEXT_BUDGET.maxChars)
  if (JSON.stringify(packet).length <= limit) return packet
  const fields: (keyof ContextPacket)[] = [
    "recentChanges",
    "unknowns",
    "evidenceIDs",
    "symbols",
    "files",
    "edgeIDs",
    "nodeIDs",
  ]
  let result = packet
  for (const field of fields) {
    if (JSON.stringify(result).length <= limit) break
    const value = result[field]
    if (!Array.isArray(value)) continue
    result = { ...result, [field]: value.slice(0, Math.max(0, value.length - 1)) }
  }
  if (JSON.stringify(result).length <= limit) return result
  const minimal: ContextPacket = {
    ...result,
    pipelineIDs: [],
    nodeIDs: [],
    edgeIDs: [],
    files: [],
    symbols: [],
    invariants: [],
    unknowns: [],
    ownerIDs: [],
    recentChanges: [],
    evidenceIDs: [],
    scope: result.scope.slice(0, Math.max(0, limit)),
  }
  return minimal
}

function normalizeBudget(input: Partial<ContextBudget> | undefined): ContextBudget {
  return {
    maxChars: positive(input?.maxChars, DEFAULT_CONTEXT_BUDGET.maxChars),
    maxPipelines: positive(input?.maxPipelines, DEFAULT_CONTEXT_BUDGET.maxPipelines),
    maxNodes: positive(input?.maxNodes, DEFAULT_CONTEXT_BUDGET.maxNodes),
    maxEdges: positive(input?.maxEdges, DEFAULT_CONTEXT_BUDGET.maxEdges),
    maxFiles: positive(input?.maxFiles, DEFAULT_CONTEXT_BUDGET.maxFiles),
    maxEvidence: positive(input?.maxEvidence, DEFAULT_CONTEXT_BUDGET.maxEvidence),
  }
}

function positive(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && value !== undefined && value > 0 ? value : fallback
}

function freshnessFor(entries: readonly { readonly status: string }[]): ContextPacket["freshness"] {
  if (entries.length === 0) return "unknown"
  if (entries.some((entry) => entry.status === "stale" || entry.status === "conflicted")) return "stale"
  return "current"
}

function metadataStrings(metadata: ContextNode["metadata"], ...keys: string[]): string[] {
  return keys.flatMap((key) => {
    const value = metadata[key]
    if (typeof value === "string") return [value]
    if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string")
    return []
  })
}

function uniqueByID<T extends { readonly id: string }>(items: readonly T[]): T[] {
  const values = new Map(items.map((item) => [item.id, item]))
  return [...values.values()].toSorted((a, b) => a.id.localeCompare(b.id))
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))].sort()
}

function uniqueIDs<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].toSorted()
}
