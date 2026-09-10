import {
  ARTIFACT_KINDS,
  CONCERNS,
  EDGE_KINDS,
  EFFECT_KINDS,
  GRAPH_VERSION,
  NODE_STATUSES,
  OPERATION_KINDS,
  WORK_INTENTS,
  type ActivityResult,
  type AcceptanceCriterion,
  type ArtifactKind,
  type ArtifactTarget,
  type EdgeKind,
  type EffectKind,
  type EffectPolicy,
  type EvidenceDraft,
  type EvidenceRequirement,
  type Event,
  type EventPayload,
  type Graph,
  type NodeStatus,
  type OperationKind,
  type OwnerRef,
  type RetryPolicy,
  type ScopeRef,
  type ValidationPolicy,
  type WorkEdge,
  type WorkNode,
} from "./types"

const MAX_NODES = 256
const MAX_EDGES = 512
const MAX_LIST = 32
const MAX_TEXT = 2_000
const MAX_ID = 180

const TERMINAL_NODE_STATUSES = new Set<NodeStatus>(["completed", "superseded", "cancelled"])
const NODE_TRANSITIONS: Record<NodeStatus, readonly NodeStatus[]> = {
  pending: ["ready", "cancelled", "superseded", "blocked"],
  ready: ["running", "cancelled", "superseded", "blocked"],
  running: ["waiting_activity", "evaluating", "cancelled", "failed", "blocked"],
  waiting_activity: ["evaluating", "cancelled", "failed", "blocked"],
  evaluating: ["completed", "running", "ready", "blocked", "failed", "superseded", "needs_input"],
  completed: ["ready", "superseded"],
  blocked: ["ready", "running", "cancelled", "superseded"],
  failed: ["ready", "running", "cancelled", "superseded"],
  needs_input: ["ready", "cancelled", "superseded"],
  superseded: [],
  cancelled: [],
}

function text(value: unknown, max = MAX_TEXT): string | undefined {
  if (typeof value !== "string") return undefined
  const result = value.replaceAll(/\s+/g, " ").trim()
  if (!result || result.length > max || result.includes("\u0000") || result.includes("===")) return undefined
  return result
}

function id(value: unknown): string | undefined {
  const result = text(value, MAX_ID)
  if (!result || /\s/.test(result)) return undefined
  return result
}

function number(value: unknown, integer = false): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined
  if (integer && !Number.isInteger(value)) return undefined
  return value
}

function list(value: unknown, max = MAX_LIST): string[] | undefined {
  if (!Array.isArray(value) || value.length > max) return undefined
  const result = value.flatMap((item) => {
    const itemText = text(item)
    return itemText ? [itemText] : []
  })
  return result.length === value.length ? [...new Set(result)] : undefined
}

function idList(value: unknown, max = MAX_LIST): string[] | undefined {
  if (!Array.isArray(value) || value.length > max) return undefined
  const result = value.flatMap((item) => {
    const itemID = id(item)
    return itemID ? [itemID] : []
  })
  return result.length === value.length ? [...new Set(result)] : undefined
}

function enumValue<T extends readonly string[]>(values: T, value: unknown): T[number] | undefined {
  return typeof value === "string" && values.includes(value) ? value : undefined
}

function statuses(value: unknown): NodeStatus | undefined {
  return enumValue(NODE_STATUSES, value)
}

function operation(value: unknown): OperationKind | undefined {
  return enumValue(OPERATION_KINDS, value)
}

function artifactKind(value: unknown): ArtifactKind | undefined {
  return enumValue(ARTIFACT_KINDS, value)
}

function effect(value: unknown): EffectKind | undefined {
  return enumValue(EFFECT_KINDS, value)
}

function edgeKind(value: unknown): EdgeKind | undefined {
  return enumValue(EDGE_KINDS, value)
}

function decodeAcceptance(value: unknown): AcceptanceCriterion[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_LIST) return undefined
  const result: AcceptanceCriterion[] = []
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return undefined
    const record = item as Record<string, unknown>
    const criterionID = id(record.id)
    const description = text(record.description)
    if (!criterionID || !description || typeof record.required !== "boolean") return undefined
    result.push({ id: criterionID, description, required: record.required })
  }
  return result
}

function decodeArtifacts(value: unknown): ArtifactTarget[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_LIST) return undefined
  const result: ArtifactTarget[] = []
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return undefined
    const record = item as Record<string, unknown>
    const kind = artifactKind(record.kind)
    const subject = text(record.subject)
    const artifactPath = record.path === undefined ? undefined : text(record.path, MAX_ID)
    if (!kind || !subject || (record.path !== undefined && !artifactPath)) return undefined
    result.push({ kind, subject, ...(artifactPath ? { path: artifactPath } : {}) })
  }
  return result
}

function decodeRisk(value: unknown): WorkNode["risk"] | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const level = enumValue(["safe", "low", "moderate", "high", "destructive", "unknown"] as const, record.level)
  const signals = list(record.signals)
  if (!level || !signals) return undefined
  return { level, signals }
}

function decodeScope(value: unknown): ScopeRef | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const root = record.root === undefined ? undefined : text(record.root, MAX_ID)
  const paths = list(record.paths, MAX_LIST)
  const access = enumValue(["read", "write", "mixed"] as const, record.access)
  if (!paths || !access || (record.root !== undefined && !root)) return undefined
  return { ...(root ? { root } : {}), paths, access }
}

function decodeOwner(value: unknown): OwnerRef | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const ownerID = id(record.id)
  const scope = record.scope === undefined ? undefined : text(record.scope)
  const expertise = record.expertise === undefined ? undefined : list(record.expertise)
  if (!ownerID || (record.scope !== undefined && !scope) || (record.expertise !== undefined && !expertise))
    return undefined
  return { id: ownerID, ...(scope ? { scope } : {}), ...(expertise ? { expertise } : {}) }
}

function decodeEffectPolicy(value: unknown): EffectPolicy | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (!Array.isArray(record.effects) || record.effects.length > MAX_LIST || !Array.isArray(record.approvals))
    return undefined
  const effects = record.effects.flatMap((item) => {
    const result = effect(item)
    return result ? [result] : []
  })
  const approvals = list(record.approvals)
  if (effects.length !== record.effects.length || !approvals) return undefined
  return { effects: [...new Set(effects)], approvals }
}

function decodeEvidenceRequirements(value: unknown): EvidenceRequirement[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_LIST) return undefined
  const result: EvidenceRequirement[] = []
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return undefined
    const record = item as Record<string, unknown>
    const requirementID = id(record.id)
    const description = text(record.description)
    const predicate = text(record.predicate)
    const blocking = enumValue(["node_completion", "graph_completion", "release"] as const, record.blocking)
    const invalidatedBy = list(record.invalidatedBy)
    if (
      !requirementID ||
      !description ||
      !predicate ||
      !blocking ||
      !invalidatedBy ||
      typeof record.required !== "boolean"
    )
      return undefined
    result.push({ id: requirementID, description, predicate, blocking, invalidatedBy, required: record.required })
  }
  return result
}

function decodeValidationPolicy(value: unknown): ValidationPolicy | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const validators = list(record.validators)
  if (!validators || typeof record.required !== "boolean") return undefined
  return { validators, required: record.required }
}

function decodeRetryPolicy(value: unknown): RetryPolicy | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const maxActivities = number(record.maxActivities, true)
  const maxLLMCalls = number(record.maxLLMCalls, true)
  const maxRetries = number(record.maxRetries, true)
  const maxEquivalentFailures = number(record.maxEquivalentFailures, true)
  const maxReplans = number(record.maxReplans, true)
  if (
    maxActivities === undefined ||
    maxLLMCalls === undefined ||
    maxRetries === undefined ||
    maxEquivalentFailures === undefined ||
    maxReplans === undefined
  )
    return undefined
  return { maxActivities, maxLLMCalls, maxRetries, maxEquivalentFailures, maxReplans }
}

function decodeNode(value: unknown): WorkNode | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const nodeID = id(record.id)
  const intent = Array.isArray(record.intent)
    ? record.intent.flatMap((item) => enumValue(WORK_INTENTS, item) ?? [])
    : undefined
  const nodeOperation = operation(record.operation)
  const goal = text(record.goal)
  const acceptance = decodeAcceptance(record.acceptance)
  const artifacts = decodeArtifacts(record.artifacts)
  const concerns = Array.isArray(record.concerns)
    ? record.concerns.flatMap((item) => enumValue(CONCERNS, item) ?? [])
    : undefined
  const risk = decodeRisk(record.risk)
  const scope = decodeScope(record.scope)
  const status = statuses(record.status)
  const revision = number(record.revision, true)
  const dependencies = idList(record.dependencies, MAX_LIST)
  const effectPolicy = decodeEffectPolicy(record.effectPolicy)
  const evidenceRequirements = decodeEvidenceRequirements(record.evidenceRequirements)
  const validationPolicy = decodeValidationPolicy(record.validationPolicy)
  const retryPolicy = decodeRetryPolicy(record.retryPolicy)
  const createdBy = enumValue(["user", "recipe", "planner", "evaluator", "recovery"] as const, record.createdBy)
  const createdIntentRevision = number(record.createdIntentRevision, true)
  const updatedAt = number(record.updatedAt)
  const owner = record.owner === undefined ? undefined : decodeOwner(record.owner)
  if (
    !nodeID ||
    !intent ||
    intent.length !== (Array.isArray(record.intent) ? record.intent.length : -1) ||
    !nodeOperation ||
    !goal ||
    !acceptance ||
    !artifacts ||
    !concerns ||
    concerns.length !== (Array.isArray(record.concerns) ? record.concerns.length : -1) ||
    !risk ||
    !scope ||
    !status ||
    revision === undefined ||
    !dependencies ||
    !effectPolicy ||
    !evidenceRequirements ||
    !validationPolicy ||
    !retryPolicy ||
    !createdBy ||
    createdIntentRevision === undefined ||
    updatedAt === undefined ||
    (record.owner !== undefined && !owner)
  )
    return undefined
  return {
    id: nodeID,
    intent: [...new Set(intent)],
    operation: nodeOperation,
    goal,
    acceptance,
    artifacts,
    concerns: [...new Set(concerns)],
    risk,
    scope,
    ...(owner ? { owner } : {}),
    status,
    revision,
    dependencies: [...new Set(dependencies)],
    effectPolicy,
    evidenceRequirements,
    validationPolicy,
    retryPolicy,
    createdBy,
    createdIntentRevision,
    updatedAt,
  }
}

function decodeEdge(value: unknown): WorkEdge | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const from = id(record.from)
  const to = id(record.to)
  const kind = edgeKind(record.kind)
  return from && to && kind ? { from, to, kind } : undefined
}

function hasDependencyPath(
  nodes: ReadonlyMap<string, WorkNode>,
  start: string,
  target: string,
  visited = new Set<string>(),
): boolean {
  if (start === target) return true
  if (visited.has(start)) return false
  visited.add(start)
  return (nodes.get(start)?.dependencies ?? []).some((dependency) =>
    hasDependencyPath(nodes, dependency, target, visited),
  )
}

function hasCycle(nodes: readonly WorkNode[]): boolean {
  const rows = new Map(nodes.map((node) => [node.id, node]))
  return nodes.some((node) => node.dependencies.some((dependency) => hasDependencyPath(rows, dependency, node.id)))
}

export function validate(graph: Graph): boolean {
  const nodeIDs = new Set(graph.nodes.map((node) => node.id))
  const edgeKeys = new Set<string>()
  if (
    graph.version !== GRAPH_VERSION ||
    !id(graph.id) ||
    !id(graph.sessionID) ||
    (graph.repositoryID !== undefined && !text(graph.repositoryID, MAX_ID)) ||
    !Number.isInteger(graph.revision) ||
    graph.revision < 0 ||
    !Number.isInteger(graph.intentRevision) ||
    graph.intentRevision < 0 ||
    (graph.intentKey !== "" && !text(graph.intentKey, MAX_ID)) ||
    !Number.isFinite(graph.createdAt) ||
    !Number.isFinite(graph.updatedAt) ||
    graph.nodes.length > MAX_NODES ||
    graph.edges.length > MAX_EDGES ||
    nodeIDs.size !== graph.nodes.length
  )
    return false
  for (const node of graph.nodes) {
    if (
      node.dependencies.some((dependency) => dependency === node.id || !nodeIDs.has(dependency)) ||
      node.acceptance.length > MAX_LIST ||
      node.evidenceRequirements.length > MAX_LIST
    )
      return false
  }
  for (const edge of graph.edges) {
    const key = `${edge.from}\u0000${edge.to}\u0000${edge.kind}`
    if (!nodeIDs.has(edge.from) || !nodeIDs.has(edge.to) || edge.from === edge.to || edgeKeys.has(key)) return false
    edgeKeys.add(key)
  }
  return !hasCycle(graph.nodes)
}

export function empty(sessionID: string, repositoryID?: string, now = Date.now()): Graph {
  const graphID = `wg_${hash(sessionID)}`
  return {
    version: GRAPH_VERSION,
    id: graphID,
    sessionID,
    ...(repositoryID ? { repositoryID } : {}),
    revision: 0,
    intentRevision: 0,
    intentKey: "",
    nodes: [],
    edges: [],
    status: "waiting",
    createdAt: now,
    updatedAt: now,
  }
}

export function parse(value: unknown): Graph | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const version = number(record.version, true)
  const graphID = id(record.id)
  const sessionID = id(record.sessionID)
  const repositoryID = record.repositoryID === undefined ? undefined : text(record.repositoryID, MAX_ID)
  const revision = number(record.revision, true)
  const intentRevision = number(record.intentRevision, true)
  const intentKey = record.intentKey === "" ? "" : text(record.intentKey, MAX_ID)
  const status = enumValue(["active", "waiting", "satisfied", "cancelled"] as const, record.status)
  const createdAt = number(record.createdAt)
  const updatedAt = number(record.updatedAt)
  const nodes = Array.isArray(record.nodes)
    ? record.nodes.flatMap((item) => {
        const node = decodeNode(item)
        return node ? [node] : []
      })
    : undefined
  const edges = Array.isArray(record.edges)
    ? record.edges.flatMap((item) => {
        const edge = decodeEdge(item)
        return edge ? [edge] : []
      })
    : undefined
  if (
    version !== GRAPH_VERSION ||
    !graphID ||
    !sessionID ||
    (record.repositoryID !== undefined && !repositoryID) ||
    revision === undefined ||
    intentRevision === undefined ||
    intentKey === undefined ||
    !status ||
    createdAt === undefined ||
    updatedAt === undefined ||
    !nodes ||
    !edges ||
    nodes.length !== (Array.isArray(record.nodes) ? record.nodes.length : -1) ||
    edges.length !== (Array.isArray(record.edges) ? record.edges.length : -1)
  )
    return undefined
  const graph: Graph = {
    version: GRAPH_VERSION,
    id: graphID,
    sessionID,
    ...(repositoryID ? { repositoryID } : {}),
    revision,
    intentRevision,
    intentKey,
    nodes,
    edges,
    status,
    createdAt,
    updatedAt,
  }
  return validate(graph) ? graph : undefined
}

export function ready(graph: Graph): WorkNode[] {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]))
  return graph.nodes.filter(
    (node) =>
      (node.status === "pending" || node.status === "ready") &&
      node.dependencies.every((dependency) => TERMINAL_NODE_STATUSES.has(nodes.get(dependency)?.status ?? "pending")),
  )
}

export function isSatisfied(graph: Graph): boolean {
  const required = graph.nodes.filter(
    (node) =>
      node.acceptance.some((criterion) => criterion.required) ||
      node.evidenceRequirements.some((requirement) => requirement.required),
  )
  return required.length > 0 && required.every((node) => node.status === "completed")
}

export function canTransition(from: NodeStatus, to: NodeStatus): boolean {
  return NODE_TRANSITIONS[from].includes(to)
}

export function transition(graph: Graph, nodeID: string, status: NodeStatus, now = Date.now()): Graph | undefined {
  const current = graph.nodes.find((node) => node.id === nodeID)
  if (!current || current.status === status || !canTransition(current.status, status)) return undefined
  const node: WorkNode = {
    ...current,
    status,
    revision: current.revision + 1,
    updatedAt: now,
  }
  const nextBase: Graph = {
    ...graph,
    nodes: graph.nodes.map((item) => (item.id === nodeID ? node : item)),
    revision: graph.revision + 1,
    status: "active",
    updatedAt: now,
  }
  const next: Graph = { ...nextBase, status: graphStatus(nextBase) }
  return validate(next) ? next : undefined
}

export type ActivityApplyResult = {
  readonly graph: Graph
  readonly applied: boolean
  readonly stale: boolean
  readonly reason?: string
}

export function applyActivityResult(graph: Graph, result: ActivityResult, now = Date.now()): ActivityApplyResult {
  const node = graph.nodes.find((item) => item.id === result.nodeID)
  if (!node) return { graph, applied: false, stale: true, reason: "node is not in the current graph" }
  if (result.graphRevision !== graph.revision || result.intentRevision !== graph.intentRevision)
    return { graph, applied: false, stale: true, reason: "activity revision is stale" }
  if (result.nodeRevision !== node.revision)
    return { graph, applied: false, stale: true, reason: "node revision is stale" }
  const nextStatus: NodeStatus =
    result.status === "succeeded" ? "evaluating" : result.status === "needs_input" ? "needs_input" : result.status
  const next = transition(graph, node.id, nextStatus, now)
  if (!next) return { graph, applied: false, stale: true, reason: `node cannot accept ${nextStatus}` }
  return { graph: next, applied: true, stale: false }
}

function activityResult(value: unknown): ActivityResult | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const resultID = id(record.id)
  const nodeID = id(record.nodeID)
  const status = enumValue(["succeeded", "failed", "cancelled", "needs_input"] as const, record.status)
  const graphRevision = number(record.graphRevision, true)
  const intentRevision = number(record.intentRevision, true)
  const nodeRevision = number(record.nodeRevision, true)
  const idempotencyKey = record.idempotencyKey === undefined ? undefined : text(record.idempotencyKey, MAX_ID)
  const error = record.error === undefined ? undefined : text(record.error)
  const evidence = Array.isArray(record.evidence)
    ? record.evidence.flatMap((item) => evidenceDraft(item) ?? [])
    : undefined
  if (
    !resultID ||
    !nodeID ||
    !status ||
    graphRevision === undefined ||
    intentRevision === undefined ||
    nodeRevision === undefined ||
    !evidence ||
    evidence.length !== (Array.isArray(record.evidence) ? record.evidence.length : -1) ||
    (record.idempotencyKey !== undefined && !idempotencyKey) ||
    (record.error !== undefined && !error)
  )
    return undefined
  return {
    id: resultID,
    nodeID,
    status,
    graphRevision,
    intentRevision,
    nodeRevision,
    ...(idempotencyKey ? { idempotencyKey } : {}),
    ...(record.output !== undefined ? { output: record.output } : {}),
    ...(error ? { error } : {}),
    evidence,
  }
}

function evidenceDraft(value: unknown): EvidenceDraft | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const evidenceID = id(record.id)
  const kind = text(record.kind)
  const subject = text(record.subject)
  const source = text(record.source)
  const contentHash = record.contentHash === undefined ? undefined : text(record.contentHash, MAX_ID)
  if (!evidenceID || !kind || !subject || !source || (record.contentHash !== undefined && !contentHash))
    return undefined
  return { id: evidenceID, kind, subject, source, ...(contentHash ? { contentHash } : {}) }
}

function payload(value: unknown, eventType: Event["type"]): EventPayload | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (eventType === "graph_created" || eventType === "graph_reconciled") {
    const graph = parse(record.graph)
    const reason = record.reason === undefined ? undefined : text(record.reason)
    return graph && (record.reason === undefined || reason) ? { graph, ...(reason ? { reason } : {}) } : undefined
  }
  if (eventType === "node_created") {
    const node = decodeNode(record.node)
    return node ? { node } : undefined
  }
  if (
    eventType === "node_status_changed" ||
    eventType === "node_completed" ||
    eventType === "node_blocked" ||
    eventType === "node_superseded" ||
    eventType === "node_cancelled"
  ) {
    const nodeID = id(record.nodeID)
    const status = statuses(record.status)
    const nodeRevision = number(record.nodeRevision, true)
    const reason = record.reason === undefined ? undefined : text(record.reason)
    return nodeID && status && nodeRevision !== undefined && (record.reason === undefined || reason)
      ? { nodeID, status, nodeRevision, ...(reason ? { reason } : {}) }
      : undefined
  }
  if (eventType === "activity_result_recorded") {
    const result = activityResult(record.result)
    return result ? { result } : undefined
  }
  if (eventType === "evidence_recorded") {
    const nodeID = id(record.nodeID)
    const evidence = Array.isArray(record.evidence)
      ? record.evidence.flatMap((item) => evidenceDraft(item) ?? [])
      : undefined
    return nodeID && evidence && evidence.length === (Array.isArray(record.evidence) ? record.evidence.length : -1)
      ? { nodeID, evidence }
      : undefined
  }
  const intentKey = text(record.intentKey, MAX_ID)
  const intentRevision = number(record.intentRevision, true)
  return intentKey && intentRevision !== undefined ? { intentKey, intentRevision } : undefined
}

export function parseEvent(value: unknown): Event | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const eventID = id(record.eventID)
  const sessionID = id(record.sessionID)
  const graphID = id(record.graphID)
  const sequence = number(record.sequence, true)
  const type = enumValue(
    [
      "graph_created",
      "graph_reconciled",
      "intent_revised",
      "node_created",
      "node_status_changed",
      "activity_result_recorded",
      "evidence_recorded",
      "node_completed",
      "node_blocked",
      "node_superseded",
      "node_cancelled",
    ] as const,
    record.type,
  )
  const graphRevision = number(record.graphRevision, true)
  const intentRevision = number(record.intentRevision, true)
  const nodeID = record.nodeID === undefined ? undefined : id(record.nodeID)
  const nodeRevision = record.nodeRevision === undefined ? undefined : number(record.nodeRevision, true)
  const causationID = record.causationID === undefined ? undefined : id(record.causationID)
  const correlationID = record.correlationID === undefined ? undefined : id(record.correlationID)
  const idempotencyKey = record.idempotencyKey === undefined ? undefined : id(record.idempotencyKey)
  const timestamp = number(record.timestamp)
  const eventPayload = type ? payload(record.payload, type) : undefined
  if (
    !eventID ||
    !sessionID ||
    !graphID ||
    sequence === undefined ||
    sequence < 1 ||
    !type ||
    graphRevision === undefined ||
    intentRevision === undefined ||
    timestamp === undefined ||
    !eventPayload ||
    (record.nodeID !== undefined && !nodeID) ||
    (record.nodeRevision !== undefined && nodeRevision === undefined) ||
    (record.causationID !== undefined && !causationID) ||
    (record.correlationID !== undefined && !correlationID) ||
    (record.idempotencyKey !== undefined && !idempotencyKey)
  )
    return undefined
  return {
    eventID,
    sessionID,
    graphID,
    sequence,
    type,
    graphRevision,
    intentRevision,
    ...(nodeID ? { nodeID } : {}),
    ...(nodeRevision !== undefined ? { nodeRevision } : {}),
    ...(causationID ? { causationID } : {}),
    ...(correlationID ? { correlationID } : {}),
    ...(idempotencyKey ? { idempotencyKey } : {}),
    timestamp,
    payload: eventPayload,
  }
}

export function reduce(graph: Graph | undefined, event: Event): Graph | undefined {
  if (event.type === "graph_created" || event.type === "graph_reconciled") {
    const next = (event.payload as { readonly graph: Graph }).graph
    if (next.sessionID !== event.sessionID || next.id !== event.graphID) return graph
    if (graph && (next.revision < graph.revision || next.intentRevision < graph.intentRevision)) return graph
    return next
  }
  if (!graph || graph.id !== event.graphID || graph.sessionID !== event.sessionID) return graph
  if (event.type === "activity_result_recorded")
    return applyActivityResult(graph, (event.payload as { readonly result: ActivityResult }).result, event.timestamp)
      .graph
  if (
    event.type === "node_status_changed" ||
    event.type === "node_completed" ||
    event.type === "node_blocked" ||
    event.type === "node_superseded" ||
    event.type === "node_cancelled"
  ) {
    const change = event.payload as { readonly nodeID: string; readonly status: NodeStatus; readonly reason?: string }
    if (event.graphRevision !== graph.revision + 1) return graph
    return transition(graph, change.nodeID, change.status, event.timestamp) ?? graph
  }
  if (event.type === "node_created") {
    const node = (event.payload as { readonly node: WorkNode }).node
    if (graph.nodes.some((item) => item.id === node.id)) return graph
    if (event.graphRevision !== graph.revision + 1) return graph
    const next = { ...graph, nodes: [...graph.nodes, node], revision: graph.revision + 1, updatedAt: event.timestamp }
    return validate(next) ? next : graph
  }
  return graph
}

function graphStatus(graph: Graph): Graph["status"] {
  if (isSatisfied(graph)) return "satisfied"
  if (graph.nodes.length > 0 && graph.nodes.every((node) => TERMINAL_NODE_STATUSES.has(node.status))) return "cancelled"
  if (
    graph.nodes.length === 0 ||
    graph.nodes.every((node) => node.status === "blocked" || node.status === "needs_input")
  )
    return "waiting"
  return "active"
}

export function replay(events: readonly Event[], initial?: Graph): Graph | undefined {
  return events
    .toSorted((left, right) => left.sequence - right.sequence)
    .reduce((graph, event) => reduce(graph, event), initial)
}

function hash(value: string): string {
  let result = 2166136261
  for (const character of value) {
    result ^= character.codePointAt(0) ?? 0
    result = Math.imul(result, 16777619)
  }
  return (result >>> 0).toString(36)
}

export * as WorkGraphReducer from "./reducer"
