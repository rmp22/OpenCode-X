export * as ContextRenderer from "./renderer"

import { ContextGraph } from "./graph"
import { TrustBoundary } from "../trust-boundary"
import type {
  ComponentContext,
  ContextHistoryRecord,
  ContextPacket,
  EvidenceRef,
  PipelineContext,
  RepositoryContext,
} from "./types"

export function renderCompact(context: RepositoryContext, pipeline?: string, maxChars = 12_000): string {
  const selected = selectPipeline(context.pipelines, pipeline)
  const lines = [
    "CONTEXT MAP",
    `Repository: ${safe(context.manifest.displayName)} (${safe(context.manifest.repositoryID)})`,
    `Freshness: ${freshness(context)}`,
    ...(selected
      ? renderPipelineFlow(context, selected)
      : context.pipelines.toSorted((a, b) => a.id.localeCompare(b.id)).map((item) => pipelineLine(item))),
    ...(context.pipelines.length === 0 ? ["No stored pipelines."] : []),
  ]
  return bound(lines, maxChars)
}

export function renderDetailed(context: RepositoryContext, pipeline?: string, maxChars = 16_000): string {
  const selected = selectPipeline(context.pipelines, pipeline)
  const lines = [
    renderCompact(context, pipeline, maxChars),
    "",
    "COMPONENTS",
    ...context.components.toSorted((a, b) => a.id.localeCompare(b.id)).map(renderComponent),
    "",
    "UNKNOWN AND CONFLICTS",
    ...unknownLines(context, selected),
  ]
  return bound(lines, maxChars)
}

export function renderMap(context: RepositoryContext, maxChars = 12_000): string {
  return renderCompact(context, undefined, maxChars)
}

export function renderPipelines(context: RepositoryContext, maxChars = 12_000): string {
  return bound(
    [
      "PIPELINES",
      ...context.pipelines
        .toSorted((a, b) => a.id.localeCompare(b.id))
        .map(
          (pipeline) =>
            `${safe(pipeline.id)} [${safe(pipeline.status)}/${safe(pipeline.confidence)}] ${safe(pipeline.name)}: ${safe(pipeline.summary)}`,
        ),
    ],
    maxChars,
  )
}

export function renderComponents(context: RepositoryContext, maxChars = 12_000): string {
  return bound(
    ["COMPONENTS", ...context.components.toSorted((a, b) => a.id.localeCompare(b.id)).map(renderComponent)],
    maxChars,
  )
}

export const renderComponentMap = renderComponents

export function renderFiles(context: RepositoryContext, maxChars = 12_000): string {
  const files = [
    ...new Set([
      ...context.components.flatMap((component) => component.filePaths),
      ...context.nodes.flatMap((node) => metadataStrings(node.metadata, "file", "files")),
      ...context.evidence.map((evidence) => evidence.file),
    ]),
  ].sort()
  return bound(["FILES", ...files.map((file) => `- ${safe(file)}`)], maxChars)
}

export const renderFileMap = renderFiles

export function renderEvidence(context: RepositoryContext, maxChars = 16_000): string {
  const evidence = context.evidence.toSorted((a, b) => a.id.localeCompare(b.id))
  return bound(
    ["EVIDENCE", ...(evidence.length === 0 ? ["No source evidence is stored."] : evidence.map(renderEvidenceRef))],
    maxChars,
  )
}

export const renderEvidenceView = renderEvidence

export function renderStale(context: RepositoryContext, maxChars = 12_000): string {
  const graph = ContextGraph.fromContext(context)
  const indexes = ContextGraph.buildIndexes(graph)
  return bound(
    [
      "STALE CONTEXT",
      ...(indexes.staleEntries.length === 0
        ? ["No stale or conflicted entries."]
        : indexes.staleEntries.map((id) => `- ${safe(id)}`)),
    ],
    maxChars,
  )
}

export const renderStaleView = renderStale

export function renderHistory(history: readonly ContextHistoryRecord[], maxChars = 12_000): string {
  return bound(
    [
      "CONTEXT HISTORY",
      ...(history.length === 0
        ? ["No context changes recorded."]
        : history.map(
            (item) =>
              `- ${item.time} ${safe(item.transactionID)}: ${safe(item.reason)}\n  ${safe(item.oldSummary)} -> ${safe(item.newSummary)}`,
          )),
    ],
    maxChars,
  )
}

export function renderAgentPacket(packet: ContextPacket, maxChars = 2_000): string {
  const lines = [
    "=== OCX CONTEXT PACKET ===",
    `Scope: ${safe(packet.scope)} | Freshness: ${safe(packet.freshness)}`,
    ...(packet.files.length > 0 ? ["Referenced files:", ...packet.files.map((file) => `- ${safe(file)}`)] : []),
    ...(packet.symbols.length > 0
      ? ["Key symbols:", ...packet.symbols.slice(0, 10).map((symbol) => `- ${safe(symbol)}`)]
      : []),
    ...(packet.invariants.length > 0
      ? [
          "Verified context:",
          ...packet.invariants.map((claim) => `- [${safe(claim.confidence)}] ${safe(claim.text)}`),
        ]
      : []),
    ...(packet.ownerIDs.length > 0 ? ["Domain owners:", ...packet.ownerIDs.map((id) => `- ${safe(id)}`)] : []),
    "Peeking: Use read or grep on the referenced files above if specific code context is needed.",
    "=== END OCX CONTEXT PACKET ===",
  ]
  return bound(lines, maxChars)
}

function selectPipeline(pipelines: readonly PipelineContext[], value: string | undefined): PipelineContext | undefined {
  if (!value) return undefined
  const normalized = value.toLocaleLowerCase()
  return pipelines.find((pipeline) => pipeline.id === value || pipeline.name.toLocaleLowerCase() === normalized)
}

function renderPipelineFlow(context: RepositoryContext, pipeline: PipelineContext): string[] {
  const graph = ContextGraph.fromContext(context)
  const lines = [pipelineLine(pipeline), `  ${safe(pipeline.summary)}`]
  const entryIDs = pipeline.entryPoints.map((entry) => entry.nodeID)
  for (const entryID of entryIDs) flow(graph, pipeline, entryID, 0, new Set(), lines)
  return lines
}

function flow(
  graph: ContextGraph.Graph,
  pipeline: PipelineContext,
  nodeID: PipelineContext["entryPoints"][number]["nodeID"],
  depth: number,
  path: ReadonlySet<string>,
  lines: string[],
): void {
  const node = graph.nodes.find((item) => item.id === nodeID)
  if (!node || depth > 24) return
  const prefix = "  ".repeat(depth + 1)
  if (path.has(node.id)) {
    lines.push(`${prefix}↺ ${safe(node.canonicalName)}`)
    return
  }
  const nextPath = new Set(path)
  nextPath.add(node.id)
  lines.push(`${prefix}${safe(node.canonicalName)} [${safe(node.status)}/${safe(node.confidence)}]`)
  const edges = graph.edges
    .filter((edge) => edge.from === node.id && pipeline.edgeIDs.includes(edge.id))
    .toSorted((a, b) => a.id.localeCompare(b.id))
  for (const edge of edges) {
    const next = graph.nodes.find((item) => item.id === edge.to)
    if (!next) continue
    lines.push(`${prefix}  -${safe(edge.relation)}-> ${safe(next.canonicalName)}`)
    flow(graph, pipeline, next.id, depth + 1, nextPath, lines)
  }
}

function pipelineLine(pipeline: PipelineContext): string {
  return `${safe(pipeline.id)} [${safe(pipeline.status)}/${safe(pipeline.confidence)}] ${safe(pipeline.name)}`
}

function renderComponent(component: ComponentContext): string {
  return `- ${safe(component.id)} [${safe(component.status)}/${safe(component.confidence)}] ${safe(component.name)}: ${safe(component.summary)}`
}

function renderEvidenceRef(evidence: EvidenceRef): string {
  const location = [
    evidence.file,
    evidence.symbol,
    evidence.lineStart ? `${evidence.lineStart}-${evidence.lineEnd ?? evidence.lineStart}` : undefined,
  ]
    .filter(Boolean)
    .join(":")
  return `- ${safe(evidence.id)} [${safe(evidence.type)}] ${safe(location)} (${safe(evidence.contentHash.slice(0, 16))}): ${safe(evidence.observation)}`
}

function unknownLines(context: RepositoryContext, pipeline: PipelineContext | undefined): string[] {
  const values = pipeline?.unknowns ?? context.pipelines.flatMap((item) => item.unknowns)
  return values.length > 0 ? values.map((item) => `- ${safe(item)}`) : ["- none recorded"]
}

function freshness(context: RepositoryContext): string {
  if (
    context.nodes.some((node) => node.status === "stale") ||
    context.edges.some((edge) => edge.status === "stale") ||
    context.pipelines.some((pipeline) => pipeline.status === "stale") ||
    context.components.some((component) => component.status === "stale") ||
    context.nodes.some((node) => node.status === "conflicted") ||
    context.edges.some((edge) => edge.status === "conflicted") ||
    context.pipelines.some((pipeline) => pipeline.status === "conflicted") ||
    context.components.some((component) => component.status === "conflicted")
  )
    return "stale"
  if (
    context.nodes.some((node) => node.status === "unknown") ||
    context.pipelines.some((pipeline) => pipeline.status === "unknown")
  )
    return "partial"
  return context.evidence.length === 0 ? "unknown" : "current"
}

function metadataStrings(metadata: RepositoryContext["nodes"][number]["metadata"], ...keys: string[]): string[] {
  return keys.flatMap((key) => {
    const value = metadata[key]
    if (typeof value === "string") return [value]
    if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string")
    return []
  })
}

function bound(lines: readonly string[], maxChars: number): string {
  const limit = Number.isInteger(maxChars) && maxChars > 0 ? maxChars : 12_000
  const result: string[] = []
  let size = 0
  for (const line of lines) {
    const next = size + line.length + (result.length > 0 ? 1 : 0)
    if (next > limit) break
    result.push(line)
    size = next
  }
  return result.join("\n")
}

function safe(value: string): string {
  return TrustBoundary.escape(value, 4_000)
}
