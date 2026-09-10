export * as ContextTransactionManager from "./transaction"

import { randomUUID } from "node:crypto"
import { ContextGraph } from "./graph"
import type {
  ComponentContext,
  Confidence,
  ContextEdge,
  ContextEntryID,
  ContextNode,
  ContextOperation,
  ContextUpdateTransaction,
  EvidenceID,
  EvidenceRef,
  PipelineContext,
  RepositoryContext,
  TransactionStatus,
} from "./types"
import { CONTEXT_SCHEMA_VERSION, evidenceID, isConfidence, isEdgeRelation, normalizeRelativePath } from "./types"

export type ValidationResult = { readonly valid: true } | { readonly valid: false; readonly errors: readonly string[] }

export type Conflict = {
  readonly existingID: string
  readonly incomingID: string
  readonly relation: string
  readonly reason: string
}

export type ApplyResult = {
  readonly context: RepositoryContext
  readonly status: Exclude<TransactionStatus, "PROPOSED" | "VALIDATED" | "REJECTED">
  readonly conflicts: readonly Conflict[]
  readonly history: {
    readonly oldSummary: string
    readonly newSummary: string
    readonly evidenceIDs: readonly EvidenceID[]
  }
}

export class InvalidContextTransactionError extends Error {
  readonly errors: readonly string[]

  constructor(errors: readonly string[]) {
    super(`invalid context transaction: ${errors.join("; ")}`)
    this.name = "InvalidContextTransactionError"
    this.errors = errors
  }
}

const CONFIDENCE_RANK: Record<Confidence, number> = {
  HYPOTHESIS: 0,
  UNKNOWN: 1,
  INFERRED: 2,
  SUPPORTED: 3,
  VERIFIED: 4,
  STALE: -1,
  CONFLICTED: -2,
}

export function canTransition(from: Confidence, to: Confidence): boolean {
  if (from === to) return true
  if (to === "STALE") return from === "VERIFIED" || from === "SUPPORTED" || from === "INFERRED" || from === "UNKNOWN"
  if (from === "STALE") return to === "VERIFIED" || to === "SUPPORTED" || to === "INFERRED"
  if (from === "HYPOTHESIS") return to === "SUPPORTED" || to === "VERIFIED"
  if (from === "UNKNOWN") return to === "INFERRED" || to === "SUPPORTED" || to === "VERIFIED"
  if (from === "INFERRED") return to === "SUPPORTED" || to === "VERIFIED"
  if (from === "SUPPORTED") return to === "VERIFIED"
  return false
}

export function validate(transaction: ContextUpdateTransaction, context: RepositoryContext): ValidationResult {
  const errors: string[] = []
  if (transaction.schemaVersion !== CONTEXT_SCHEMA_VERSION) errors.push("schema version is unsupported")
  if (transaction.repositoryID !== context.manifest.repositoryID) errors.push("repository does not match context")
  if (transaction.status !== "PROPOSED" && transaction.status !== "VALIDATED")
    errors.push("transaction is not applicable")
  if (!transaction.origin.taskID.trim()) errors.push("origin task id is required")
  if (!transaction.reason.trim()) errors.push("transaction reason is required")
  if (transaction.operations.length === 0 || transaction.operations.length > 500)
    errors.push("transaction operation count is out of range")

  const evidenceIDs = new Set<EvidenceID>(context.evidence.map((item) => item.id))
  const nodeIDs = new Set(context.nodes.map((item) => item.id))
  const edgeIDs = new Set(context.edges.map((item) => item.id))
  const pipelineIDs = new Set(context.pipelines.map((item) => item.id))
  const componentIDs = new Set(context.components.map((item) => item.id))
  for (const operation of transaction.operations) {
    if (operation.op === "upsert_evidence") evidenceIDs.add(operation.evidence.id)
    if (operation.op === "upsert_node") nodeIDs.add(operation.node.id)
    if (operation.op === "upsert_edge") edgeIDs.add(operation.edge.id)
    if (operation.op === "upsert_pipeline") pipelineIDs.add(operation.pipeline.id)
    if (operation.op === "upsert_component") componentIDs.add(operation.component.id)
  }
  for (const operation of transaction.operations) {
    if (operation.op === "upsert_evidence") {
      validateEvidence(operation.evidence, errors)
      continue
    }
    if (operation.op === "upsert_node") {
      validateNode(operation.node, transaction.repositoryID, evidenceIDs, errors)
      continue
    }
    if (operation.op === "upsert_edge") {
      validateEdge(operation.edge, transaction.repositoryID, nodeIDs, evidenceIDs, errors)
      continue
    }
    if (operation.op === "upsert_pipeline") {
      validatePipeline(operation.pipeline, transaction.repositoryID, nodeIDs, edgeIDs, evidenceIDs, errors)
      continue
    }
    if (operation.op === "upsert_component") {
      validateComponent(operation.component, transaction.repositoryID, evidenceIDs, errors)
      continue
    }
    if (operation.op === "mark_stale") {
      for (const id of operation.entryIDs) {
        if (!hasEntryID(id, nodeIDs, edgeIDs, pipelineIDs, componentIDs))
          errors.push(`stale entry does not exist: ${id}`)
      }
      continue
    }
    if (!hasEntryID(operation.id, nodeIDs, edgeIDs, pipelineIDs, componentIDs))
      errors.push(`removed entry does not exist: ${operation.id}`)
  }
  return errors.length > 0 ? { valid: false, errors: [...new Set(errors)] } : { valid: true }
}

export function apply(context: RepositoryContext, transaction: ContextUpdateTransaction): ApplyResult {
  const validation = validate(transaction, context)
  if (!validation.valid) throw new InvalidContextTransactionError(validation.errors)

  let graph = ContextGraph.fromContext(context)
  const evidence = new Map(context.evidence.map((item) => [item.id, item]))
  const conflicts: Conflict[] = []
  const operations = [...transaction.operations].toSorted((left, right) => operationOrder(left) - operationOrder(right))
  for (const operation of operations) {
    if (operation.op === "upsert_evidence") {
      evidence.set(operation.evidence.id, operation.evidence)
      continue
    }
    if (operation.op === "upsert_node") {
      graph = ContextGraph.upsertNode(
        graph,
        mergeNode(
          graph.nodes.find((item) => item.id === operation.node.id),
          operation.node,
        ),
      )
      continue
    }
    if (operation.op === "upsert_edge") {
      const result = mergeEdge(graph, operation.edge)
      graph = result.graph
      if (result.conflict) conflicts.push(result.conflict)
      continue
    }
    if (operation.op === "upsert_component") {
      graph = ContextGraph.upsertComponent(
        graph,
        mergeComponent(
          graph.components.find((item) => item.id === operation.component.id),
          operation.component,
        ),
      )
      continue
    }
    if (operation.op === "upsert_pipeline") {
      graph = ContextGraph.upsertPipeline(
        graph,
        mergePipeline(
          graph.pipelines.find((item) => item.id === operation.pipeline.id),
          operation.pipeline,
        ),
      )
      continue
    }
    if (operation.op === "mark_stale") {
      graph = staleGraph(graph, operation.entryIDs)
      continue
    }
    graph = ContextGraph.remove(graph, { type: operation.entryType, id: operation.id })
  }

  const nextContext = ContextGraph.toContext(graph, {
    ...context,
    manifest: {
      ...context.manifest,
      ...(transaction.sourceRevision ? { lastSeenRevision: transaction.sourceRevision } : {}),
      updatedAt: Date.now(),
    },
    evidence: [...evidence.values()].toSorted((a, b) => a.id.localeCompare(b.id)),
  })
  return {
    context: nextContext,
    status: conflicts.length > 0 ? "CONFLICTED" : "APPLIED",
    conflicts,
    history: {
      oldSummary: summarize(context),
      newSummary: summarize(nextContext),
      evidenceIDs: transaction.operations.flatMap((operation) => evidenceFor(operation)),
    },
  }
}

export function create(input: {
  readonly repositoryID: ContextUpdateTransaction["repositoryID"]
  readonly baseRevision?: string
  readonly sourceRevision?: string
  readonly origin: ContextUpdateTransaction["origin"]
  readonly reason: string
  readonly operations: readonly ContextOperation[]
  readonly now?: number
}): ContextUpdateTransaction {
  return {
    id: `ctx_tx_${randomUUID().replaceAll("-", "")}`,
    schemaVersion: CONTEXT_SCHEMA_VERSION,
    repositoryID: input.repositoryID,
    ...(input.baseRevision ? { baseRevision: input.baseRevision } : {}),
    ...(input.sourceRevision ? { sourceRevision: input.sourceRevision } : {}),
    origin: input.origin,
    reason: input.reason,
    status: "PROPOSED",
    operations: [...input.operations],
    createdAt: input.now ?? Date.now(),
  }
}

function validateEvidence(evidence: EvidenceRef, errors: string[]): void {
  try {
    evidenceID(evidence.id)
    normalizeRelativePath(evidence.file)
  } catch {
    errors.push(`evidence identity or path is invalid: ${evidence.id}`)
  }
  if (evidence.schemaVersion !== CONTEXT_SCHEMA_VERSION) errors.push(`evidence schema is unsupported: ${evidence.id}`)
  if (!evidence.file || !evidence.contentHash || !evidence.observation.trim())
    errors.push(`evidence is incomplete: ${evidence.id}`)
  if (evidence.lineStart !== undefined && (!Number.isInteger(evidence.lineStart) || evidence.lineStart < 1))
    errors.push(`evidence line is invalid: ${evidence.id}`)
  if (evidence.lineEnd !== undefined && (!Number.isInteger(evidence.lineEnd) || evidence.lineEnd < 1))
    errors.push(`evidence line is invalid: ${evidence.id}`)
  if (evidence.lineStart !== undefined && evidence.lineEnd !== undefined && evidence.lineEnd < evidence.lineStart)
    errors.push(`evidence line range is reversed: ${evidence.id}`)
}

function validateNode(
  node: ContextNode,
  repository: ContextUpdateTransaction["repositoryID"],
  evidenceIDs: ReadonlySet<EvidenceID>,
  errors: string[],
): void {
  if (node.schemaVersion !== CONTEXT_SCHEMA_VERSION || node.repositoryID !== repository)
    errors.push(`node repository or schema mismatch: ${node.id}`)
  if (!node.canonicalName.trim()) errors.push(`node name is empty: ${node.id}`)
  validateConfidence(node.confidence, node.evidenceIDs, evidenceIDs, errors, `node ${node.id}`)
}

function validateEdge(
  edge: ContextEdge,
  repository: ContextUpdateTransaction["repositoryID"],
  nodeIDs: ReadonlySet<ContextNode["id"]>,
  evidenceIDs: ReadonlySet<EvidenceID>,
  errors: string[],
): void {
  if (edge.schemaVersion !== CONTEXT_SCHEMA_VERSION || edge.repositoryID !== repository)
    errors.push(`edge repository or schema mismatch: ${edge.id}`)
  if (edge.from === edge.to) errors.push(`edge is self-referential: ${edge.id}`)
  if (!nodeIDs.has(edge.from) || !nodeIDs.has(edge.to)) errors.push(`edge endpoint is missing: ${edge.id}`)
  if (!isEdgeRelation(edge.relation)) errors.push(`edge relation is invalid: ${edge.id}`)
  validateConfidence(edge.confidence, edge.evidenceIDs, evidenceIDs, errors, `edge ${edge.id}`)
}

function validatePipeline(
  pipeline: PipelineContext,
  repository: ContextUpdateTransaction["repositoryID"],
  nodeIDs: ReadonlySet<ContextNode["id"]>,
  edgeIDs: ReadonlySet<ContextEdge["id"]>,
  evidenceIDs: ReadonlySet<EvidenceID>,
  errors: string[],
): void {
  if (pipeline.schemaVersion !== CONTEXT_SCHEMA_VERSION || pipeline.repositoryID !== repository)
    errors.push(`pipeline repository or schema mismatch: ${pipeline.id}`)
  if (pipeline.nodeIDs.some((id) => !nodeIDs.has(id))) errors.push(`pipeline node is missing: ${pipeline.id}`)
  if (pipeline.edgeIDs.some((id) => !edgeIDs.has(id))) errors.push(`pipeline edge is missing: ${pipeline.id}`)
  validateConfidence(pipeline.confidence, pipeline.evidenceIDs, evidenceIDs, errors, `pipeline ${pipeline.id}`)
  for (const claim of pipeline.constraints)
    validateConfidence(claim.confidence, claim.evidenceIDs, evidenceIDs, errors, `claim ${claim.id}`)
}

function validateComponent(
  component: ComponentContext,
  repository: ContextUpdateTransaction["repositoryID"],
  evidenceIDs: ReadonlySet<EvidenceID>,
  errors: string[],
): void {
  if (component.schemaVersion !== CONTEXT_SCHEMA_VERSION || component.repositoryID !== repository)
    errors.push(`component repository or schema mismatch: ${component.id}`)
  validateConfidence(component.confidence, component.evidenceIDs, evidenceIDs, errors, `component ${component.id}`)
}

function validateConfidence(
  confidence: Confidence,
  evidence: readonly EvidenceID[],
  known: ReadonlySet<EvidenceID>,
  errors: string[],
  label: string,
): void {
  if (!isConfidence(confidence)) errors.push(`${label} confidence is invalid`)
  if (confidence === "HYPOTHESIS") errors.push(`${label} hypothesis cannot enter canonical context`)
  if (confidence === "VERIFIED" && evidence.length === 0) errors.push(`${label} VERIFIED claim has no evidence`)
  for (const id of evidence) if (!known.has(id)) errors.push(`${label} references missing evidence: ${id}`)
}

function hasEntryID(
  id: string,
  nodes: ReadonlySet<string>,
  edges: ReadonlySet<string>,
  pipelines: ReadonlySet<string>,
  components: ReadonlySet<string>,
): boolean {
  return nodes.has(id) || edges.has(id) || pipelines.has(id) || components.has(id)
}

function operationOrder(operation: ContextOperation): number {
  if (operation.op === "upsert_evidence") return 0
  if (operation.op === "upsert_node") return 1
  if (operation.op === "upsert_edge") return 2
  if (operation.op === "upsert_component") return 3
  if (operation.op === "upsert_pipeline") return 4
  if (operation.op === "mark_stale") return 5
  return 6
}

function mergeNode(existing: ContextNode | undefined, incoming: ContextNode): ContextNode {
  if (!existing) return incoming
  const stronger = chooseConfidence(existing.confidence, incoming.confidence, existing.status, incoming.status)
  const useIncoming =
    stronger === incoming.confidence && (incoming.confidence !== existing.confidence || incoming.status !== "stale")
  return {
    ...(useIncoming ? incoming : existing),
    metadata: { ...existing.metadata, ...incoming.metadata },
    evidenceIDs: union(existing.evidenceIDs, incoming.evidenceIDs),
    aliases: union(existing.aliases, incoming.aliases),
    confidence: stronger,
    status: stronger === "STALE" ? "stale" : useIncoming ? incoming.status : existing.status,
  }
}

function mergeEdge(
  graph: ContextGraph.Graph,
  incoming: ContextEdge,
): { readonly graph: ContextGraph.Graph; readonly conflict?: Conflict } {
  const existing = graph.edges.find((edge) => edge.id === incoming.id)
  if (existing) return { graph: ContextGraph.upsertEdge(graph, mergeEdgeValue(existing, incoming)) }
  const incompatible = graph.edges.find(
    (edge) =>
      edge.from === incoming.from &&
      edge.relation === incoming.relation &&
      edge.to !== incoming.to &&
      isStrong(edge.confidence) &&
      isStrong(incoming.confidence) &&
      edge.status !== "stale" &&
      incoming.status !== "stale",
  )
  if (!incompatible) return { graph: ContextGraph.upsertEdge(graph, incoming) }
  const conflictIDs = union(incompatible.conflictIDs ?? [], [incompatible.id, incoming.id])
  const existingConflict = {
    ...incompatible,
    status: "conflicted" as const,
    confidence: "CONFLICTED" as const,
    conflictIDs,
  }
  const incomingConflict = {
    ...incoming,
    status: "conflicted" as const,
    confidence: "CONFLICTED" as const,
    conflictIDs,
  }
  return {
    graph: ContextGraph.upsertEdge(ContextGraph.upsertEdge(graph, existingConflict), incomingConflict),
    conflict: {
      existingID: incompatible.id,
      incomingID: incoming.id,
      relation: incoming.relation,
      reason: "incompatible strong edges share a source and relation",
    },
  }
}

function mergeEdgeValue(existing: ContextEdge, incoming: ContextEdge): ContextEdge {
  const confidence = chooseConfidence(existing.confidence, incoming.confidence, existing.status, incoming.status)
  return {
    ...(confidence === incoming.confidence ? incoming : existing),
    evidenceIDs: union(existing.evidenceIDs, incoming.evidenceIDs),
    confidence,
    status: confidence === "STALE" ? "stale" : confidence === incoming.confidence ? incoming.status : existing.status,
  }
}

function mergePipeline(existing: PipelineContext | undefined, incoming: PipelineContext): PipelineContext {
  if (!existing) return incoming
  const confidence = chooseConfidence(existing.confidence, incoming.confidence, existing.status, incoming.status)
  return {
    ...(confidence === incoming.confidence ? incoming : existing),
    nodeIDs: union(existing.nodeIDs, incoming.nodeIDs),
    edgeIDs: union(existing.edgeIDs, incoming.edgeIDs),
    constraints: unionByID(existing.constraints, incoming.constraints),
    unknowns: union(existing.unknowns, incoming.unknowns),
    relatedPipelineIDs: union(existing.relatedPipelineIDs, incoming.relatedPipelineIDs),
    ownerIDs: union(existing.ownerIDs, incoming.ownerIDs),
    evidenceIDs: union(existing.evidenceIDs, incoming.evidenceIDs),
    confidence,
    status: confidence === "STALE" ? "stale" : confidence === incoming.confidence ? incoming.status : existing.status,
  }
}

function mergeComponent(existing: ComponentContext | undefined, incoming: ComponentContext): ComponentContext {
  if (!existing) return incoming
  const confidence = chooseConfidence(existing.confidence, incoming.confidence, existing.status, incoming.status)
  return {
    ...(confidence === incoming.confidence ? incoming : existing),
    filePaths: union(existing.filePaths, incoming.filePaths),
    symbolNames: union(existing.symbolNames, incoming.symbolNames),
    ownerIDs: union(existing.ownerIDs, incoming.ownerIDs),
    evidenceIDs: union(existing.evidenceIDs, incoming.evidenceIDs),
    confidence,
    status: confidence === "STALE" ? "stale" : confidence === incoming.confidence ? incoming.status : existing.status,
  }
}

function staleGraph(graph: ContextGraph.Graph, ids: readonly ContextEntryID[]): ContextGraph.Graph {
  const wanted = new Set(ids)
  return {
    ...graph,
    nodes: graph.nodes.map((item) => (wanted.has(item.id) ? { ...item, confidence: "STALE", status: "stale" } : item)),
    edges: graph.edges.map((item) => (wanted.has(item.id) ? { ...item, confidence: "STALE", status: "stale" } : item)),
    pipelines: graph.pipelines.map((item) =>
      wanted.has(item.id) ? { ...item, confidence: "STALE", status: "stale" } : item,
    ),
    components: graph.components.map((item) =>
      wanted.has(item.id) ? { ...item, confidence: "STALE", status: "stale" } : item,
    ),
  }
}

function chooseConfidence(left: Confidence, right: Confidence, leftStatus: string, rightStatus: string): Confidence {
  if (leftStatus === "stale" && rightStatus !== "stale") return right
  if (rightStatus === "stale" && leftStatus !== "stale") return left
  return CONFIDENCE_RANK[right] >= CONFIDENCE_RANK[left] ? right : left
}

function isStrong(value: Confidence): boolean {
  return value === "VERIFIED" || value === "SUPPORTED"
}

function union<T>(left: readonly T[], right: readonly T[]): T[] {
  return [...new Set([...left, ...right])]
}

function unionByID<T extends { readonly id: string }>(left: readonly T[], right: readonly T[]): T[] {
  const values = new Map(left.map((item) => [item.id, item]))
  for (const item of right) values.set(item.id, item)
  return [...values.values()]
}

function evidenceFor(operation: ContextOperation): EvidenceID[] {
  if (operation.op === "upsert_evidence") return [operation.evidence.id]
  if (operation.op === "upsert_node") return [...operation.node.evidenceIDs]
  if (operation.op === "upsert_edge") return [...operation.edge.evidenceIDs]
  if (operation.op === "upsert_pipeline")
    return [...operation.pipeline.evidenceIDs, ...operation.pipeline.constraints.flatMap((claim) => claim.evidenceIDs)]
  if (operation.op === "upsert_component") return [...operation.component.evidenceIDs]
  return []
}

function summarize(context: RepositoryContext): string {
  return `${context.nodes.length} nodes, ${context.edges.length} edges, ${context.pipelines.length} pipelines, ${context.components.length} components, ${context.evidence.length} evidence records`
}
