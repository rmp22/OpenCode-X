export const CONTEXT_SCHEMA_VERSION = 1 as const

export const CONFIDENCE_VALUES = [
  "VERIFIED",
  "SUPPORTED",
  "INFERRED",
  "HYPOTHESIS",
  "STALE",
  "UNKNOWN",
  "CONFLICTED",
] as const
export type Confidence = (typeof CONFIDENCE_VALUES)[number]

export const CONTEXT_STATUS_VALUES = ["active", "stale", "unknown", "conflicted", "removed"] as const
export type ContextStatus = (typeof CONTEXT_STATUS_VALUES)[number]

export const NODE_KIND_VALUES = [
  "repository",
  "module",
  "file",
  "symbol",
  "component",
  "pipeline",
  "process",
  "thread",
  "configuration",
  "data_structure",
] as const
export type NodeKind = (typeof NODE_KIND_VALUES)[number]

export const EDGE_RELATION_VALUES = [
  "calls",
  "owns",
  "creates",
  "reads",
  "writes",
  "dispatches",
  "observes",
  "depends_on",
  "implements",
  "extends",
  "registers",
  "sends_to",
  "receives_from",
  "runs_on",
  "persists_to",
  "builds",
  "generates",
  "participates_in",
] as const
export type EdgeRelation = (typeof EDGE_RELATION_VALUES)[number]

export const TRANSACTION_STATUS_VALUES = ["PROPOSED", "VALIDATED", "APPLIED", "REJECTED", "CONFLICTED"] as const
export type TransactionStatus = (typeof TRANSACTION_STATUS_VALUES)[number]

export const EVIDENCE_TYPE_VALUES = [
  "source_code",
  "test",
  "runtime",
  "configuration",
  "generated_source",
  "vcs",
] as const
export type EvidenceType = (typeof EVIDENCE_TYPE_VALUES)[number]

export type RepositoryID = string & { readonly __repositoryID: unique symbol }
export type RepositoryId = RepositoryID
export type ContextNodeID = string & { readonly __contextNodeID: unique symbol }
export type ContextNodeId = ContextNodeID
export type ContextEdgeID = string & { readonly __contextEdgeID: unique symbol }
export type ContextEdgeId = ContextEdgeID
export type PipelineID = string & { readonly __pipelineID: unique symbol }
export type PipelineId = PipelineID
export type ComponentID = string & { readonly __componentID: unique symbol }
export type ComponentId = ComponentID
export type EvidenceID = string & { readonly __evidenceID: unique symbol }
export type EvidenceId = EvidenceID
export type ContextEntryID = ContextNodeID | ContextEdgeID | PipelineID | ComponentID

export type RepositoryIdentity = {
  readonly vcs: "git" | "unknown"
  readonly remotes: readonly string[]
  readonly rootFingerprint: string
  readonly projectID?: string
  readonly workspaceNamespace?: string
}

export type RepositoryManifest = {
  readonly schemaVersion: typeof CONTEXT_SCHEMA_VERSION
  readonly repositoryID: RepositoryID
  readonly displayName: string
  readonly identity: RepositoryIdentity
  readonly lastSeenPath: string
  readonly lastSeenRevision?: string
  readonly createdAt: number
  readonly updatedAt: number
}

export type EvidenceRef = {
  readonly id: EvidenceID
  readonly schemaVersion: typeof CONTEXT_SCHEMA_VERSION
  readonly type: EvidenceType
  readonly repositoryRevision?: string
  readonly file: string
  readonly symbol?: string
  readonly lineStart?: number
  readonly lineEnd?: number
  readonly contentHash: string
  readonly observation: string
}

export type ContextNode = {
  readonly id: ContextNodeID
  readonly schemaVersion: typeof CONTEXT_SCHEMA_VERSION
  readonly kind: NodeKind
  readonly canonicalName: string
  readonly repositoryID: RepositoryID
  readonly metadata: Readonly<Record<string, string | number | boolean | readonly string[]>>
  readonly confidence: Confidence
  readonly status: ContextStatus
  readonly evidenceIDs: readonly EvidenceID[]
  readonly aliases: readonly string[]
  readonly lastVerifiedRevision?: string
}

export type ContextEdge = {
  readonly id: ContextEdgeID
  readonly schemaVersion: typeof CONTEXT_SCHEMA_VERSION
  readonly from: ContextNodeID
  readonly to: ContextNodeID
  readonly relation: EdgeRelation
  readonly repositoryID: RepositoryID
  readonly confidence: Confidence
  readonly status: ContextStatus
  readonly evidenceIDs: readonly EvidenceID[]
  readonly lastVerifiedRevision?: string
  readonly conflictIDs?: readonly ContextEdgeID[]
}

export type PipelineEntryPoint = {
  readonly nodeID: ContextNodeID
  readonly label?: string
}

export type PipelineContext = {
  readonly id: PipelineID
  readonly schemaVersion: typeof CONTEXT_SCHEMA_VERSION
  readonly repositoryID: RepositoryID
  readonly name: string
  readonly kind: string
  readonly summary: string
  readonly status: ContextStatus
  readonly confidence: Confidence
  readonly lastVerifiedRevision?: string
  readonly entryPoints: readonly PipelineEntryPoint[]
  readonly nodeIDs: readonly ContextNodeID[]
  readonly edgeIDs: readonly ContextEdgeID[]
  readonly constraints: readonly ContextClaim[]
  readonly unknowns: readonly string[]
  readonly relatedPipelineIDs: readonly PipelineID[]
  readonly ownerIDs: readonly string[]
  readonly evidenceIDs: readonly EvidenceID[]
}

export type ComponentContext = {
  readonly id: ComponentID
  readonly schemaVersion: typeof CONTEXT_SCHEMA_VERSION
  readonly repositoryID: RepositoryID
  readonly name: string
  readonly summary: string
  readonly status: ContextStatus
  readonly confidence: Confidence
  readonly filePaths: readonly string[]
  readonly symbolNames: readonly string[]
  readonly ownerIDs: readonly string[]
  readonly evidenceIDs: readonly EvidenceID[]
}

export type ContextClaim = {
  readonly id: string
  readonly text: string
  readonly confidence: Confidence
  readonly status: ContextStatus
  readonly evidenceIDs: readonly EvidenceID[]
}

export type RepositoryContext = {
  readonly schemaVersion: typeof CONTEXT_SCHEMA_VERSION
  readonly manifest: RepositoryManifest
  readonly nodes: readonly ContextNode[]
  readonly edges: readonly ContextEdge[]
  readonly pipelines: readonly PipelineContext[]
  readonly components: readonly ComponentContext[]
  readonly evidence: readonly EvidenceRef[]
}

export type TransactionOrigin = {
  readonly taskID: string
  readonly ownerID?: string
}

export type ContextOperation =
  | { readonly op: "upsert_evidence"; readonly evidence: EvidenceRef }
  | { readonly op: "upsert_node"; readonly node: ContextNode }
  | { readonly op: "upsert_edge"; readonly edge: ContextEdge }
  | { readonly op: "upsert_pipeline"; readonly pipeline: PipelineContext }
  | { readonly op: "upsert_component"; readonly component: ComponentContext }
  | { readonly op: "mark_stale"; readonly entryIDs: readonly ContextEntryID[] }
  | {
      readonly op: "remove_entry"
      readonly entryType: "node" | "edge" | "pipeline" | "component"
      readonly id: string
    }

export type ContextUpdateTransaction = {
  readonly id: string
  readonly schemaVersion: typeof CONTEXT_SCHEMA_VERSION
  readonly repositoryID: RepositoryID
  readonly baseRevision?: string
  readonly sourceRevision?: string
  readonly origin: TransactionOrigin
  readonly reason: string
  readonly status: TransactionStatus
  readonly operations: readonly ContextOperation[]
  readonly createdAt: number
}

export type ContextHistoryRecord = {
  readonly id: string
  readonly schemaVersion: typeof CONTEXT_SCHEMA_VERSION
  readonly transactionID: string
  readonly repositoryID: RepositoryID
  readonly time: number
  readonly origin: TransactionOrigin
  readonly reason: string
  readonly oldSummary: string
  readonly newSummary: string
  readonly evidenceIDs: readonly EvidenceID[]
}

export type ContextQuery = {
  readonly repositoryID: RepositoryID
  readonly taskText?: string
  readonly scopeHints?: readonly string[]
  readonly files?: readonly string[]
  readonly symbols?: readonly string[]
  readonly module?: string
  readonly pipeline?: string
  readonly ownerID?: string
}

export type ContextBudget = {
  readonly maxChars: number
  readonly maxPipelines: number
  readonly maxNodes: number
  readonly maxEdges: number
  readonly maxFiles: number
  readonly maxEvidence: number
}

export const DEFAULT_CONTEXT_BUDGET: ContextBudget = {
  maxChars: 12_000,
  maxPipelines: 5,
  maxNodes: 24,
  maxEdges: 32,
  maxFiles: 24,
  maxEvidence: 32,
}

export type ContextPacket = {
  readonly repositoryID: RepositoryID
  readonly scope: string
  readonly freshness: "current" | "partial" | "stale" | "unknown"
  readonly pipelineIDs: readonly PipelineID[]
  readonly nodeIDs: readonly ContextNodeID[]
  readonly edgeIDs: readonly ContextEdgeID[]
  readonly files: readonly string[]
  readonly symbols: readonly string[]
  readonly invariants: readonly ContextClaim[]
  readonly unknowns: readonly string[]
  readonly ownerIDs: readonly string[]
  readonly recentChanges: readonly string[]
  readonly evidenceIDs: readonly EvidenceID[]
}

export type RepositorySnapshot = {
  readonly repositoryID: RepositoryID
  readonly revision?: string
  readonly complete?: boolean
  readonly files: Readonly<Record<string, { readonly contentHash: string; readonly symbol?: string }>>
}

export type FreshnessReport = {
  readonly state: "current" | "partial" | "stale" | "unknown"
  readonly unchangedEvidenceIDs: readonly EvidenceID[]
  readonly changedEvidenceIDs: readonly EvidenceID[]
  readonly movedEvidenceIDs: readonly EvidenceID[]
  readonly missingEvidenceIDs: readonly EvidenceID[]
  readonly affectedEntryIDs: readonly ContextEntryID[]
}

export type FindingEvidence = {
  readonly file: string
  readonly symbol?: string
  readonly lineStart?: number
  readonly lineEnd?: number
  readonly contentHash?: string
  readonly observation: string
}

export type Finding = {
  readonly subject: string
  readonly relation: EdgeRelation
  readonly object: string
  readonly confidence: Confidence
  readonly evidence: readonly FindingEvidence[]
  readonly explanation?: string
  readonly scope?: string
}

export function isConfidence(value: unknown): value is Confidence {
  return typeof value === "string" && CONFIDENCE_VALUES.includes(value as Confidence)
}

export function isContextStatus(value: unknown): value is ContextStatus {
  return typeof value === "string" && CONTEXT_STATUS_VALUES.includes(value as ContextStatus)
}

export function isNodeKind(value: unknown): value is NodeKind {
  return typeof value === "string" && NODE_KIND_VALUES.includes(value as NodeKind)
}

export function isEdgeRelation(value: unknown): value is EdgeRelation {
  return typeof value === "string" && EDGE_RELATION_VALUES.includes(value as EdgeRelation)
}

export function isTransactionStatus(value: unknown): value is TransactionStatus {
  return typeof value === "string" && TRANSACTION_STATUS_VALUES.includes(value as TransactionStatus)
}

export function isEvidenceType(value: unknown): value is EvidenceType {
  return typeof value === "string" && EVIDENCE_TYPE_VALUES.includes(value as EvidenceType)
}

export function repositoryID(value: string): RepositoryID {
  if (!/^repo-[a-f0-9]{16,64}$/.test(value)) throw new Error(`invalid repository id: ${value}`)
  return value as RepositoryID
}

export function nodeID(value: string): ContextNodeID {
  if (
    !/^(?:node|module|file|symbol|component|pipeline|process|thread|config|data)(?:-|:)[a-z0-9][a-z0-9._:/-]*$/.test(
      value,
    )
  )
    throw new Error(`invalid context node id: ${value}`)
  return value as ContextNodeID
}

export function edgeID(value: string): ContextEdgeID {
  if (!/^edge-[a-f0-9]{16,64}$/.test(value)) throw new Error(`invalid context edge id: ${value}`)
  return value as ContextEdgeID
}

export function pipelineID(value: string): PipelineID {
  if (!/^pipeline(?:-|\.)[a-z0-9][a-z0-9._-]*$/.test(value)) throw new Error(`invalid pipeline id: ${value}`)
  return value as PipelineID
}

export function componentID(value: string): ComponentID {
  if (!/^component(?:-|\.)[a-z0-9][a-z0-9._-]*$/.test(value)) throw new Error(`invalid component id: ${value}`)
  return value as ComponentID
}

export function evidenceID(value: string): EvidenceID {
  if (!/^(?:evidence-[a-f0-9]{16,64}|src-[a-z0-9][a-z0-9._-]*)$/.test(value))
    throw new Error(`invalid evidence id: ${value}`)
  return value as EvidenceID
}

export function normalizeName(value: string): string {
  const result = value.trim().replace(/\s+/g, " ")
  if (!result || result.length > 240) throw new Error("canonical name must contain 1-240 characters")
  return result
}

export function normalizeRelativePath(value: string): string {
  const normalized = value.trim().replaceAll("\\", "/").replace(/^\.\//, "")
  if (!normalized || normalized === "." || normalized.startsWith("/") || normalized.split("/").includes(".."))
    throw new Error(`invalid repository-relative path: ${value}`)
  return normalized
}

export function parseRepositoryContext(value: unknown): RepositoryContext | undefined {
  if (!record(value) || value.schemaVersion !== CONTEXT_SCHEMA_VERSION || !record(value.manifest)) return undefined
  const manifest = parseManifest(value.manifest)
  if (!manifest) return undefined
  const rawNodes = array(value.nodes)
  const rawEdges = array(value.edges)
  const rawPipelines = array(value.pipelines)
  const rawComponents = array(value.components)
  const rawEvidence = array(value.evidence)
  const nodes = rawNodes.flatMap((item) => {
    const parsed = parseNode(item, manifest.repositoryID)
    return parsed ? [parsed] : []
  })
  const edges = rawEdges.flatMap((item) => {
    const parsed = parseEdge(item, manifest.repositoryID)
    return parsed ? [parsed] : []
  })
  const pipelines = rawPipelines.flatMap((item) => {
    const parsed = parsePipeline(item, manifest.repositoryID)
    return parsed ? [parsed] : []
  })
  const components = rawComponents.flatMap((item) => {
    const parsed = parseComponent(item, manifest.repositoryID)
    return parsed ? [parsed] : []
  })
  const evidence = rawEvidence.flatMap((item) => {
    const parsed = parseEvidence(item, manifest.repositoryID)
    return parsed ? [parsed] : []
  })
  if (
    nodes.length !== rawNodes.length ||
    edges.length !== rawEdges.length ||
    pipelines.length !== rawPipelines.length ||
    components.length !== rawComponents.length ||
    evidence.length !== rawEvidence.length
  )
    return undefined
  const nodeIDs = new Set(nodes.map((node) => node.id))
  const edgeIDs = new Set(edges.map((edge) => edge.id))
  const pipelineIDs = new Set(pipelines.map((pipeline) => pipeline.id))
  const evidenceIDs = new Set(evidence.map((item) => item.id))
  if (
    edges.some(
      (edge) => !nodeIDs.has(edge.from) || !nodeIDs.has(edge.to) || edge.evidenceIDs.some((id) => !evidenceIDs.has(id)),
    ) ||
    pipelines.some(
      (pipeline) =>
        pipeline.nodeIDs.some((id) => !nodeIDs.has(id)) ||
        pipeline.entryPoints.some((entry) => !nodeIDs.has(entry.nodeID)) ||
        pipeline.edgeIDs.some((id) => !edgeIDs.has(id)) ||
        pipeline.relatedPipelineIDs.some((id) => !pipelineIDs.has(id)) ||
        pipeline.evidenceIDs.some((id) => !evidenceIDs.has(id)) ||
        pipeline.constraints.some((claim) => claim.evidenceIDs.some((id) => !evidenceIDs.has(id))),
    ) ||
    components.some((component) => component.evidenceIDs.some((id) => !evidenceIDs.has(id))) ||
    nodes.some((node) => node.evidenceIDs.some((id) => !evidenceIDs.has(id)))
  )
    return undefined
  return { schemaVersion: CONTEXT_SCHEMA_VERSION, manifest, nodes, edges, pipelines, components, evidence }
}

export function parseManifest(value: unknown): RepositoryManifest | undefined {
  if (!record(value) || value.schemaVersion !== CONTEXT_SCHEMA_VERSION) return undefined
  if (
    typeof value.repositoryID !== "string" ||
    typeof value.displayName !== "string" ||
    typeof value.lastSeenPath !== "string"
  )
    return undefined
  const createdAt = finite(value.createdAt)
  const updatedAt = finite(value.updatedAt)
  if (!record(value.identity) || createdAt === undefined || updatedAt === undefined) return undefined
  try {
    const repository = repositoryID(value.repositoryID)
    const identity = parseIdentity(value.identity)
    if (!identity) return undefined
    return {
      schemaVersion: CONTEXT_SCHEMA_VERSION,
      repositoryID: repository,
      displayName: normalizeName(value.displayName),
      identity,
      lastSeenPath: value.lastSeenPath,
      ...(typeof value.lastSeenRevision === "string" ? { lastSeenRevision: value.lastSeenRevision } : {}),
      createdAt,
      updatedAt,
    }
  } catch {
    return undefined
  }
}

export function parseTransaction(value: unknown): ContextUpdateTransaction | undefined {
  if (!record(value) || value.schemaVersion !== CONTEXT_SCHEMA_VERSION) return undefined
  if (typeof value.id !== "string" || typeof value.reason !== "string" || !record(value.origin)) return undefined
  if (
    typeof value.origin.taskID !== "string" ||
    (value.origin.ownerID !== undefined && typeof value.origin.ownerID !== "string")
  )
    return undefined
  if (typeof value.repositoryID !== "string" || !isTransactionStatus(value.status) || !Array.isArray(value.operations))
    return undefined
  const createdAt = finite(value.createdAt)
  if (createdAt === undefined || value.operations.length > 500) return undefined
  try {
    const repository = repositoryID(value.repositoryID)
    const operations = value.operations.flatMap((item) => parseOperation(item, repository))
    if (operations.length !== value.operations.length) return undefined
    return {
      id: value.id,
      schemaVersion: CONTEXT_SCHEMA_VERSION,
      repositoryID: repository,
      ...(typeof value.baseRevision === "string" ? { baseRevision: value.baseRevision } : {}),
      ...(typeof value.sourceRevision === "string" ? { sourceRevision: value.sourceRevision } : {}),
      origin: {
        taskID: value.origin.taskID,
        ...(typeof value.origin.ownerID === "string" ? { ownerID: value.origin.ownerID } : {}),
      },
      reason: value.reason,
      status: value.status,
      operations,
      createdAt,
    }
  } catch {
    return undefined
  }
}

function parseIdentity(value: Record<string, unknown>): RepositoryIdentity | undefined {
  if (value.vcs !== "git" && value.vcs !== "unknown") return undefined
  if (!Array.isArray(value.remotes) || !value.remotes.every((item) => typeof item === "string")) return undefined
  if (typeof value.rootFingerprint !== "string" || !value.rootFingerprint) return undefined
  return {
    vcs: value.vcs,
    remotes: value.remotes,
    rootFingerprint: value.rootFingerprint,
    ...(typeof value.projectID === "string" ? { projectID: value.projectID } : {}),
    ...(typeof value.workspaceNamespace === "string" ? { workspaceNamespace: value.workspaceNamespace } : {}),
  }
}

function parseEvidence(value: unknown, repository: RepositoryID): EvidenceRef | undefined {
  if (!record(value) || value.schemaVersion !== CONTEXT_SCHEMA_VERSION) return undefined
  if (
    typeof value.id !== "string" ||
    typeof value.file !== "string" ||
    typeof value.contentHash !== "string" ||
    typeof value.observation !== "string"
  )
    return undefined
  if (!isEvidenceType(value.type)) return undefined
  if (!value.contentHash || !value.observation.trim()) return undefined
  try {
    const id = evidenceID(value.id)
    const file = normalizeRelativePath(value.file)
    if (typeof value.repositoryID === "string" && value.repositoryID !== repository) return undefined
    if (!validLine(value.lineStart) || !validLine(value.lineEnd)) return undefined
    if (value.lineStart !== undefined && value.lineEnd !== undefined && value.lineEnd < value.lineStart)
      return undefined
    return {
      id,
      schemaVersion: CONTEXT_SCHEMA_VERSION,
      type: value.type,
      ...(typeof value.repositoryRevision === "string" ? { repositoryRevision: value.repositoryRevision } : {}),
      file,
      ...(typeof value.symbol === "string" ? { symbol: value.symbol } : {}),
      ...(typeof value.lineStart === "number" ? { lineStart: value.lineStart } : {}),
      ...(typeof value.lineEnd === "number" ? { lineEnd: value.lineEnd } : {}),
      contentHash: value.contentHash,
      observation: value.observation,
    }
  } catch {
    return undefined
  }
}

function parseNode(value: unknown, repository: RepositoryID): ContextNode | undefined {
  if (!record(value) || value.schemaVersion !== CONTEXT_SCHEMA_VERSION) return undefined
  if (typeof value.id !== "string" || typeof value.canonicalName !== "string" || typeof value.repositoryID !== "string")
    return undefined
  if (!isNodeKind(value.kind) || !isConfidence(value.confidence) || !isContextStatus(value.status)) return undefined
  const evidenceIDs = strings(value.evidenceIDs)
  const aliases = strings(value.aliases)
  if (value.repositoryID !== repository || !metadata(value.metadata) || !evidenceIDs || !aliases) return undefined
  try {
    return {
      id: nodeID(value.id),
      schemaVersion: CONTEXT_SCHEMA_VERSION,
      kind: value.kind,
      canonicalName: normalizeName(value.canonicalName),
      repositoryID: repository,
      metadata: value.metadata,
      confidence: value.confidence,
      status: value.status,
      evidenceIDs: evidenceIDs.map(evidenceID),
      aliases,
      ...(typeof value.lastVerifiedRevision === "string" ? { lastVerifiedRevision: value.lastVerifiedRevision } : {}),
    }
  } catch {
    return undefined
  }
}

function parseEdge(value: unknown, repository: RepositoryID): ContextEdge | undefined {
  if (!record(value) || value.schemaVersion !== CONTEXT_SCHEMA_VERSION) return undefined
  if (
    typeof value.id !== "string" ||
    typeof value.from !== "string" ||
    typeof value.to !== "string" ||
    typeof value.repositoryID !== "string"
  )
    return undefined
  if (!isEdgeRelation(value.relation) || !isConfidence(value.confidence) || !isContextStatus(value.status))
    return undefined
  const evidenceIDs = strings(value.evidenceIDs)
  if (value.repositoryID !== repository || !evidenceIDs) return undefined
  if (value.from === value.to) return undefined
  try {
    return {
      id: edgeID(value.id),
      schemaVersion: CONTEXT_SCHEMA_VERSION,
      from: nodeID(value.from),
      to: nodeID(value.to),
      relation: value.relation,
      repositoryID: repository,
      confidence: value.confidence,
      status: value.status,
      evidenceIDs: evidenceIDs.map(evidenceID),
      ...(typeof value.lastVerifiedRevision === "string" ? { lastVerifiedRevision: value.lastVerifiedRevision } : {}),
      ...(Array.isArray(value.conflictIDs) && value.conflictIDs.every((item) => typeof item === "string")
        ? { conflictIDs: value.conflictIDs.map(edgeID) }
        : {}),
    }
  } catch {
    return undefined
  }
}

function parsePipeline(value: unknown, repository: RepositoryID): PipelineContext | undefined {
  if (!record(value) || value.schemaVersion !== CONTEXT_SCHEMA_VERSION) return undefined
  if (
    typeof value.id !== "string" ||
    typeof value.repositoryID !== "string" ||
    typeof value.name !== "string" ||
    typeof value.kind !== "string" ||
    typeof value.summary !== "string"
  )
    return undefined
  if (!isConfidence(value.confidence) || !isContextStatus(value.status) || value.repositoryID !== repository)
    return undefined
  const nodeIDs = strings(value.nodeIDs)
  const edgeIDs = strings(value.edgeIDs)
  const unknowns = strings(value.unknowns)
  const relatedPipelineIDs = strings(value.relatedPipelineIDs)
  const ownerIDs = strings(value.ownerIDs)
  const evidenceIDs = strings(value.evidenceIDs)
  if (
    !Array.isArray(value.entryPoints) ||
    !Array.isArray(value.constraints) ||
    !nodeIDs ||
    !edgeIDs ||
    !unknowns ||
    !relatedPipelineIDs ||
    !ownerIDs ||
    !evidenceIDs
  )
    return undefined
  try {
    const entryPoints = value.entryPoints.flatMap((item) => {
      if (!record(item) || typeof item.nodeID !== "string") return []
      return [{ nodeID: nodeID(item.nodeID), ...(typeof item.label === "string" ? { label: item.label } : {}) }]
    })
    if (entryPoints.length !== value.entryPoints.length) return undefined
    const constraints = value.constraints.flatMap((item) => {
      const parsed = parseClaim(item)
      return parsed ? [parsed] : []
    })
    if (constraints.length !== value.constraints.length) return undefined
    return {
      id: pipelineID(value.id),
      schemaVersion: CONTEXT_SCHEMA_VERSION,
      repositoryID: repository,
      name: normalizeName(value.name),
      kind: value.kind,
      summary: value.summary,
      status: value.status,
      confidence: value.confidence,
      ...(typeof value.lastVerifiedRevision === "string" ? { lastVerifiedRevision: value.lastVerifiedRevision } : {}),
      entryPoints,
      nodeIDs: nodeIDs.map(nodeID),
      edgeIDs: edgeIDs.map(edgeID),
      constraints,
      unknowns,
      relatedPipelineIDs: relatedPipelineIDs.map(pipelineID),
      ownerIDs,
      evidenceIDs: evidenceIDs.map(evidenceID),
    }
  } catch {
    return undefined
  }
}

function parseComponent(value: unknown, repository: RepositoryID): ComponentContext | undefined {
  if (!record(value) || value.schemaVersion !== CONTEXT_SCHEMA_VERSION) return undefined
  if (
    typeof value.id !== "string" ||
    typeof value.repositoryID !== "string" ||
    typeof value.name !== "string" ||
    typeof value.summary !== "string"
  )
    return undefined
  if (!isConfidence(value.confidence) || !isContextStatus(value.status) || value.repositoryID !== repository)
    return undefined
  const filePaths = strings(value.filePaths)
  const symbolNames = strings(value.symbolNames)
  const ownerIDs = strings(value.ownerIDs)
  const evidenceIDs = strings(value.evidenceIDs)
  if (!filePaths || !symbolNames || !ownerIDs || !evidenceIDs) return undefined
  try {
    return {
      id: componentID(value.id),
      schemaVersion: CONTEXT_SCHEMA_VERSION,
      repositoryID: repository,
      name: normalizeName(value.name),
      summary: value.summary,
      status: value.status,
      confidence: value.confidence,
      filePaths: filePaths.map(normalizeRelativePath),
      symbolNames,
      ownerIDs,
      evidenceIDs: evidenceIDs.map(evidenceID),
    }
  } catch {
    return undefined
  }
}

function parseClaim(value: unknown): ContextClaim | undefined {
  if (
    !record(value) ||
    typeof value.id !== "string" ||
    typeof value.text !== "string" ||
    !isConfidence(value.confidence) ||
    !isContextStatus(value.status) ||
    !Array.isArray(value.evidenceIDs) ||
    !value.evidenceIDs.every((item) => typeof item === "string")
  )
    return undefined
  const evidenceIDs = strings(value.evidenceIDs)
  if (!evidenceIDs || !value.text.trim()) return undefined
  try {
    return {
      id: value.id,
      text: value.text,
      confidence: value.confidence,
      status: value.status,
      evidenceIDs: evidenceIDs.map(evidenceID),
    }
  } catch {
    return undefined
  }
}

function parseOperation(value: unknown, repository: RepositoryID): ContextOperation[] {
  if (!record(value) || typeof value.op !== "string") return []
  if (value.op === "upsert_evidence") {
    const evidence = parseEvidence(value.evidence, repository)
    return evidence ? [{ op: value.op, evidence }] : []
  }
  if (value.op === "upsert_node") {
    const node = parseNode(value.node, repository)
    return node ? [{ op: value.op, node }] : []
  }
  if (value.op === "upsert_edge") {
    const edge = parseEdge(value.edge, repository)
    return edge ? [{ op: value.op, edge }] : []
  }
  if (value.op === "upsert_pipeline") {
    const pipeline = parsePipeline(value.pipeline, repository)
    return pipeline ? [{ op: value.op, pipeline }] : []
  }
  if (value.op === "upsert_component") {
    const component = parseComponent(value.component, repository)
    return component ? [{ op: value.op, component }] : []
  }
  if (
    value.op === "mark_stale" &&
    Array.isArray(value.entryIDs) &&
    value.entryIDs.every((item) => typeof item === "string")
  )
    return [{ op: value.op, entryIDs: value.entryIDs.map(parseEntryID) }]
  if (
    value.op === "remove_entry" &&
    (value.entryType === "node" ||
      value.entryType === "edge" ||
      value.entryType === "pipeline" ||
      value.entryType === "component") &&
    typeof value.id === "string"
  )
    return [{ op: value.op, entryType: value.entryType, id: value.id }]
  return []
}

function parseEntryID(value: string): ContextEntryID {
  if (value.startsWith("edge-")) return edgeID(value)
  if (value.startsWith("pipeline-") || value.startsWith("pipeline.")) return pipelineID(value)
  if (value.startsWith("component-") || value.startsWith("component.")) return componentID(value)
  return nodeID(value)
}

function validLine(value: unknown): value is number | undefined {
  return value === undefined || (typeof value === "number" && Number.isInteger(value) && value > 0)
}

function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function strings(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : undefined
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function metadata(value: unknown): value is ContextNode["metadata"] {
  if (!record(value)) return false
  return Object.values(value).every((item) => {
    if (typeof item === "string" || typeof item === "boolean") return true
    if (typeof item === "number") return Number.isFinite(item)
    return Array.isArray(item) && item.every((entry) => typeof entry === "string")
  })
}

export * as ContextTypes from "./types"
