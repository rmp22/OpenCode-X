import { Requirements } from "./requirements"
import { TrustBoundary } from "./trust-boundary"
import { Workflow, type WorkflowId } from "./workflow"

export const NODE_STATUSES = [
  "planned",
  "ready",
  "in_progress",
  "blocked",
  "review",
  "verification",
  "completed",
  "superseded",
  "cancelled",
] as const

export type NodeStatus = (typeof NODE_STATUSES)[number]
export type NodeKind = "goal" | "feature" | "task"

export type Node = {
  readonly id: string
  readonly kind: NodeKind
  readonly title: string
  readonly parentID?: string
  readonly dependencyIDs: readonly string[]
  readonly ownerIDs: readonly string[]
  readonly status: NodeStatus
  readonly requirementIDs: readonly string[]
  readonly acceptanceCriteria: readonly string[]
  readonly blockers: readonly string[]
  readonly domains: readonly string[]
  readonly verification: Requirements.VerificationState
  readonly revisions: readonly string[]
  readonly linkedDecisions: readonly string[]
  readonly linkedFailures: readonly string[]
  readonly linkedMemory: readonly string[]
  readonly sessionID?: string
  readonly workflowHint?: WorkflowId
  readonly artifactKinds?: readonly string[]
}

export type Graph = {
  readonly repositoryID: string
  readonly nodes: readonly Node[]
  readonly updatedAt: number
}

export type SyncInput = {
  readonly repositoryID: string
  readonly sessionID: string
  readonly topic: string
  readonly plan: readonly { readonly do: string; readonly expect: string }[]
  readonly workstreams: readonly {
    readonly id: string
    readonly goal: string
    readonly workflowHint?: WorkflowId
    readonly artifactKinds?: readonly string[]
  }[]
  readonly requirements: readonly Requirements.Record[]
  readonly todos?: readonly { readonly content: string; readonly status: string }[]
  readonly now?: number
}

export type NodePatch = {
  readonly title?: string
  readonly parentID?: string | null
  readonly dependencyIDs?: readonly string[]
  readonly ownerIDs?: readonly string[]
  readonly status?: NodeStatus
  readonly requirementIDs?: readonly string[]
  readonly acceptanceCriteria?: readonly string[]
  readonly blockers?: readonly string[]
  readonly domains?: readonly string[]
  readonly verification?: Requirements.VerificationState
  readonly revisions?: readonly string[]
  readonly linkedDecisions?: readonly string[]
  readonly linkedFailures?: readonly string[]
  readonly linkedMemory?: readonly string[]
  readonly workflowHint?: WorkflowId | null
  readonly artifactKinds?: readonly string[]
}

const MAX_NODES = 256
const MAX_LIST = 16
const MAX_TEXT = 240
const MAX_ID = 120

function text(value: unknown, max = MAX_TEXT): string | undefined {
  if (typeof value !== "string") return undefined
  const result = value.replace(/\s+/g, " ").trim()
  if (!result || result.length > max || result.includes("===")) return undefined
  return result
}

function id(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const result = value.trim()
  if (!result || result.length > MAX_ID || /\s/.test(result) || result.includes("===")) return undefined
  return result
}

function list(value: unknown, max = MAX_LIST): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value
    .flatMap((item) => {
      const result = text(item, MAX_TEXT)
      return result ? [result] : []
    })
    .slice(0, max)
}

function ids(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value
    .flatMap((item) => {
      const result = id(item)
      return result ? [result] : []
    })
    .slice(0, MAX_LIST)
}

function status(value: unknown): NodeStatus | undefined {
  return typeof value === "string" && NODE_STATUSES.includes(value as NodeStatus) ? (value as NodeStatus) : undefined
}

function kind(value: unknown): NodeKind | undefined {
  return value === "goal" || value === "feature" || value === "task" ? value : undefined
}

function verification(value: unknown): Requirements.VerificationState | undefined {
  return value === "unverified" || value === "passed" || value === "failed" ? value : undefined
}

function decodeNode(value: unknown): Node | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const nodeID = id(record.id)
  const nodeKind = kind(record.kind)
  const title = text(record.title)
  const dependencyIDs = ids(record.dependencyIDs)
  const ownerIDs = ids(record.ownerIDs)
  const nodeStatus = status(record.status)
  const requirementIDs = ids(record.requirementIDs)
  const acceptanceCriteria = list(record.acceptanceCriteria)
  const blockers = list(record.blockers)
  const domains = list(record.domains)
  const nodeVerification = verification(record.verification)
  const revisions = list(record.revisions, MAX_LIST)
  const linkedDecisions = list(record.linkedDecisions, MAX_LIST)
  const linkedFailures = list(record.linkedFailures, MAX_LIST)
  const linkedMemory = list(record.linkedMemory, MAX_LIST)
  const sessionID = record.sessionID === undefined ? undefined : id(record.sessionID)
  const parentID = record.parentID === undefined ? undefined : id(record.parentID)
  const workflowHint = record.workflowHint === undefined ? undefined : Workflow.isWorkflowId(record.workflowHint) ? record.workflowHint : undefined
  const artifactKinds = record.artifactKinds === undefined ? undefined : list(record.artifactKinds, MAX_LIST)
  if (
    !nodeID ||
    !nodeKind ||
    !title ||
    !dependencyIDs ||
    !ownerIDs ||
    !nodeStatus ||
    !requirementIDs ||
    !acceptanceCriteria ||
    !blockers ||
    !domains ||
    !nodeVerification ||
    !revisions ||
    !linkedDecisions ||
    !linkedFailures ||
    !linkedMemory ||
    (record.sessionID !== undefined && !sessionID) ||
    (record.parentID !== undefined && !parentID) ||
    (record.workflowHint !== undefined && !workflowHint) ||
    (record.artifactKinds !== undefined && !artifactKinds)
  )
    return undefined
  return {
    id: nodeID,
    kind: nodeKind,
    title,
    ...(parentID ? { parentID } : {}),
    dependencyIDs: [...new Set(dependencyIDs)],
    ownerIDs: [...new Set(ownerIDs)],
    status: nodeStatus,
    requirementIDs: [...new Set(requirementIDs)],
    acceptanceCriteria,
    blockers,
    domains,
    verification: nodeVerification,
    revisions,
    linkedDecisions,
    linkedFailures,
    linkedMemory,
    ...(sessionID ? { sessionID } : {}),
    ...(workflowHint ? { workflowHint } : {}),
    ...(artifactKinds ? { artifactKinds } : {}),
  }
}

function hasPath(nodes: ReadonlyMap<string, Node>, start: string, target: string, visited = new Set<string>()): boolean {
  if (start === target) return true
  if (visited.has(start)) return false
  visited.add(start)
  const node = nodes.get(start)
  return node ? node.dependencyIDs.some((dependencyID) => hasPath(nodes, dependencyID, target, visited)) : false
}

function hasCycle(nodes: readonly Node[]): boolean {
  const rows = new Map(nodes.map((node) => [node.id, node]))
  return nodes.some((node) => node.dependencyIDs.some((dependencyID) => hasPath(rows, dependencyID, node.id)))
}

function validGraph(graph: Graph): boolean {
  const nodeIDs = new Set(graph.nodes.map((node) => node.id))
  return (
    graph.nodes.length <= MAX_NODES &&
    new Set(graph.nodes.map((node) => node.id)).size === graph.nodes.length &&
    graph.nodes.every(
      (node) =>
        (!node.parentID || nodeIDs.has(node.parentID)) &&
        node.dependencyIDs.every((dependencyID) => nodeIDs.has(dependencyID) && dependencyID !== node.id),
    ) &&
    !hasCycle(graph.nodes)
  )
}

function hash(value: string): string {
  let result = 2166136261
  for (const character of value) {
    result ^= character.codePointAt(0) ?? 0
    result = Math.imul(result, 16777619)
  }
  return (result >>> 0).toString(36)
}

function nodeID(kindValue: NodeKind, sessionID: string, value: string): string {
  return `${kindValue}_${hash(`${sessionID}\u0000${value.toLocaleLowerCase()}`)}`
}

function normalize(value: string): string {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()
}

function todoStatus(
  title: string,
  todos: readonly { readonly content: string; readonly status: string }[] | undefined,
  current: Node | undefined,
): NodeStatus {
  const match = todos?.find((item) => normalize(item.content) === normalize(title))
  if (match?.status === "completed") return "completed"
  if (match?.status === "in_progress") return "in_progress"
  if (match?.status === "cancelled") return "cancelled"
  return current?.status ?? "planned"
}

function requirementIDs(requirements: readonly Requirements.Record[]): string[] {
  return requirements.filter((item) => item.status === "active" || item.status === "verified").map((item) => item.id).slice(0, MAX_LIST)
}

function changed(left: readonly Node[], right: readonly Node[]): boolean {
  return JSON.stringify(left) !== JSON.stringify(right)
}

function makeNode(input: {
  readonly current?: Node
  readonly id: string
  readonly kind: NodeKind
  readonly title: string
  readonly parentID?: string
  readonly dependencyIDs?: readonly string[]
  readonly status?: NodeStatus
  readonly requirementIDs: readonly string[]
  readonly acceptanceCriteria?: readonly string[]
  readonly domains?: readonly string[]
  readonly sessionID: string
  readonly workflowHint?: WorkflowId
  readonly artifactKinds?: readonly string[]
}): Node {
  const current = input.current
  return {
    id: input.id,
    kind: input.kind,
    title: input.title,
    ...(current?.parentID || input.parentID ? { parentID: current?.parentID ?? input.parentID } : {}),
    dependencyIDs: [...new Set([...(current?.dependencyIDs ?? []), ...(input.dependencyIDs ?? [])])].slice(0, MAX_LIST),
    ownerIDs: current?.ownerIDs ?? [],
    status: input.status ?? current?.status ?? "planned",
    requirementIDs: [...new Set([...(current?.requirementIDs ?? []), ...input.requirementIDs])].slice(0, MAX_LIST),
    acceptanceCriteria: [...new Set([...(current?.acceptanceCriteria ?? []), ...(input.acceptanceCriteria ?? [])])].slice(0, MAX_LIST),
    blockers: current?.blockers ?? [],
    domains: [...new Set([...(current?.domains ?? []), ...(input.domains ?? [])])].slice(0, MAX_LIST),
    verification: current?.verification ?? "unverified",
    revisions: current?.revisions ?? [],
    linkedDecisions: current?.linkedDecisions ?? [],
    linkedFailures: current?.linkedFailures ?? [],
    linkedMemory: current?.linkedMemory ?? [],
    sessionID: current?.sessionID ?? input.sessionID,
    ...(current?.workflowHint ?? input.workflowHint ? { workflowHint: current?.workflowHint ?? input.workflowHint } : {}),
    ...(current?.artifactKinds ?? input.artifactKinds ? { artifactKinds: current?.artifactKinds ?? input.artifactKinds } : {}),
  }
}

export function empty(repositoryID: string, now = Date.now()): Graph {
  return { repositoryID, nodes: [], updatedAt: now }
}

export function parse(value: unknown): Graph | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const repositoryID = text(record.repositoryID, 500)
  const updatedAt = typeof record.updatedAt === "number" && Number.isFinite(record.updatedAt) ? record.updatedAt : undefined
  if (!repositoryID || updatedAt === undefined || !Array.isArray(record.nodes)) return undefined
  const nodes = record.nodes.flatMap((item) => {
    const node = decodeNode(item)
    return node ? [node] : []
  })
  if (nodes.length !== record.nodes.length) return undefined
  const graph = { repositoryID, nodes, updatedAt }
  return validGraph(graph) ? graph : undefined
}

export function sync(previous: Graph | undefined, input: SyncInput): Graph {
  const base = previous?.repositoryID === input.repositoryID ? previous : empty(input.repositoryID, input.now)
  const topic = text(input.topic)
  const plan = input.plan.flatMap((step) => {
    const action = text(step.do)
    const expect = text(step.expect)
    return action && expect ? [{ do: action, expect }] : []
  }).slice(0, MAX_LIST)
  const workstreams = input.workstreams.flatMap((stream) => {
    const streamID = id(stream.id)
    const goal = text(stream.goal)
    return streamID && goal
      ? [{ id: streamID, goal, ...(stream.workflowHint ? { workflowHint: stream.workflowHint } : {}), ...(stream.artifactKinds ? { artifactKinds: [...stream.artifactKinds] } : {}) }]
      : []
  }).slice(0, MAX_LIST)
  if (!topic && plan.length === 0 && workstreams.length === 0) return base

  const nodes = new Map(base.nodes.map((node) => [node.id, node]))
  const touched = new Set<string>()
  const linkedRequirements = requirementIDs(input.requirements)
  const goalID = nodeID("goal", input.sessionID, topic ?? "task")
  const currentGoal = nodes.get(goalID)
  nodes.set(
    goalID,
    makeNode({
      current: currentGoal,
      id: goalID,
      kind: "goal",
      title: topic ?? currentGoal?.title ?? "Current task",
      requirementIDs: linkedRequirements,
      status: currentGoal?.status === "completed" ? "completed" : "in_progress",
      sessionID: input.sessionID,
    }),
  )
  touched.add(goalID)

  const featureIDs = workstreams.map((stream) => nodeID("feature", input.sessionID, stream.id))
  workstreams.forEach((stream, index) => {
    const featureID = featureIDs[index]
    const current = nodes.get(featureID)
    nodes.set(
      featureID,
      makeNode({
        current,
        id: featureID,
        kind: "feature",
        title: stream.goal,
        parentID: goalID,
        requirementIDs: linkedRequirements,
        domains: [stream.id],
        ...(stream.workflowHint ? { workflowHint: stream.workflowHint } : {}),
        ...(stream.artifactKinds ? { artifactKinds: stream.artifactKinds } : {}),
        sessionID: input.sessionID,
      }),
    )
    touched.add(featureID)
  })

  let previousTaskID: string | undefined
  plan.forEach((step) => {
    const taskID = nodeID("task", input.sessionID, step.do)
    const current = nodes.get(taskID)
    const parentID = featureIDs.length === 1 ? featureIDs[0] : goalID
    nodes.set(
      taskID,
      makeNode({
        current,
        id: taskID,
        kind: "task",
        title: step.do,
        parentID,
        dependencyIDs: previousTaskID ? [previousTaskID] : [],
        status: todoStatus(step.do, input.todos, current),
        requirementIDs: linkedRequirements,
        acceptanceCriteria: [step.expect],
        sessionID: input.sessionID,
      }),
    )
    touched.add(taskID)
    previousTaskID = taskID
  })

  for (const [key, node] of nodes) {
    if (node.sessionID !== input.sessionID || touched.has(key)) continue
    if (node.status === "completed" || node.status === "cancelled" || node.status === "superseded") continue
    nodes.set(key, { ...node, status: "superseded" })
  }

  const nextNodes = boundedNodes(nodes, touched)
  const next: Graph = {
    repositoryID: input.repositoryID,
    nodes: nextNodes,
    updatedAt: changed(base.nodes, nextNodes) ? input.now ?? Date.now() : base.updatedAt,
  }
  return validGraph(next) ? next : base
}

function boundedNodes(nodes: ReadonlyMap<string, Node>, touched: ReadonlySet<string>): Node[] {
  const all = [...nodes.values()]
  const keep = new Set<string>()
  const collect = (nodeIDValue: string, target: Set<string>) => {
    if (target.has(nodeIDValue)) return
    const node = nodes.get(nodeIDValue)
    if (!node) return
    target.add(nodeIDValue)
    if (node.parentID) collect(node.parentID, target)
    for (const dependencyID of node.dependencyIDs) collect(dependencyID, target)
  }
  for (const nodeIDValue of touched) collect(nodeIDValue, keep)
  if (keep.size > MAX_NODES) return all.slice(-MAX_NODES)

  let slots = MAX_NODES - keep.size
  for (const node of all.toReversed()) {
    if (keep.has(node.id)) continue
    const component = new Set<string>()
    collect(node.id, component)
    const additions = [...component].filter((nodeIDValue) => !keep.has(nodeIDValue))
    if (additions.length > slots) continue
    for (const nodeIDValue of additions) keep.add(nodeIDValue)
    slots -= additions.length
    if (slots === 0) break
  }
  return all.filter((node) => keep.has(node.id))
}

export function updateNode(graph: Graph, nodeIDValue: string, patch: NodePatch, now = Date.now()): Graph | undefined {
  const current = graph.nodes.find((node) => node.id === nodeIDValue)
  if (!current) return undefined
  const title = patch.title === undefined ? current.title : text(patch.title)
  const dependencyIDs = patch.dependencyIDs === undefined ? current.dependencyIDs : ids(patch.dependencyIDs)
  const ownerIDs = patch.ownerIDs === undefined ? current.ownerIDs : ids(patch.ownerIDs)
  const requirementIDsValue = patch.requirementIDs === undefined ? current.requirementIDs : ids(patch.requirementIDs)
  const acceptanceCriteria = patch.acceptanceCriteria === undefined ? current.acceptanceCriteria : list(patch.acceptanceCriteria)
  const blockers = patch.blockers === undefined ? current.blockers : list(patch.blockers)
  const domains = patch.domains === undefined ? current.domains : list(patch.domains)
  const revisions = patch.revisions === undefined ? current.revisions : list(patch.revisions)
  const linkedDecisions = patch.linkedDecisions === undefined ? current.linkedDecisions : list(patch.linkedDecisions)
  const linkedFailures = patch.linkedFailures === undefined ? current.linkedFailures : list(patch.linkedFailures)
  const linkedMemory = patch.linkedMemory === undefined ? current.linkedMemory : list(patch.linkedMemory)
  const workflowHint = patch.workflowHint === undefined ? current.workflowHint : patch.workflowHint === null ? undefined : Workflow.isWorkflowId(patch.workflowHint) ? patch.workflowHint : undefined
  const artifactKinds = patch.artifactKinds === undefined ? current.artifactKinds : list(patch.artifactKinds, MAX_LIST)
  const parentID = patch.parentID === undefined ? current.parentID : patch.parentID === null ? undefined : id(patch.parentID)
  if (
    !title ||
    !dependencyIDs ||
    !ownerIDs ||
    !requirementIDsValue ||
    !acceptanceCriteria ||
    !blockers ||
    !domains ||
    !revisions ||
    !linkedDecisions ||
    !linkedFailures ||
    !linkedMemory ||
    (patch.parentID !== undefined && patch.parentID !== null && !parentID) ||
    (patch.workflowHint !== undefined && patch.workflowHint !== null && !workflowHint) ||
    (patch.artifactKinds !== undefined && !artifactKinds) ||
    (patch.status !== undefined && !status(patch.status)) ||
    (patch.verification !== undefined && !verification(patch.verification))
  )
    return undefined
  const nextNode: Node = {
    id: current.id,
    kind: current.kind,
    title,
    ...(parentID ? { parentID } : {}),
    dependencyIDs: [...new Set(dependencyIDs)],
    ownerIDs: [...new Set(ownerIDs)],
    status: patch.status ?? current.status,
    requirementIDs: [...new Set(requirementIDsValue)],
    acceptanceCriteria,
    blockers,
    domains,
    verification: patch.verification ?? current.verification,
    revisions,
    linkedDecisions,
    linkedFailures,
    linkedMemory,
    ...(current.sessionID ? { sessionID: current.sessionID } : {}),
    ...(workflowHint ? { workflowHint } : {}),
    ...(artifactKinds ? { artifactKinds } : {}),
  }
  const nodes = graph.nodes.map((node) => (node.id === nodeIDValue ? nextNode : node))
  const next = { ...graph, nodes, updatedAt: now }
  if (!validGraph(next)) return undefined
  return next
}

export function addDependency(graph: Graph, nodeIDValue: string, dependencyID: string, now = Date.now()): Graph | undefined {
  const node = graph.nodes.find((item) => item.id === nodeIDValue)
  if (!node || nodeIDValue === dependencyID || !graph.nodes.some((item) => item.id === dependencyID)) return undefined
  return updateNode(graph, nodeIDValue, { dependencyIDs: [...node.dependencyIDs, dependencyID] }, now)
}

export function ready(graph: Graph): Node[] {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]))
  return graph.nodes.filter(
    (node) =>
      node.kind === "task" &&
      (node.status === "planned" || node.status === "ready") &&
      node.blockers.length === 0 &&
      node.dependencyIDs.every((dependencyID) => {
        const dependency = nodes.get(dependencyID)
        return dependency?.status === "completed" || dependency?.status === "superseded"
      }),
  )
}

export function render(graph: Graph, maxChars = 1_800): string {
  const visible = graph.nodes.filter((node) => node.status !== "cancelled" && node.status !== "superseded")
  if (visible.length === 0) return ""
  const readyIDs = new Set(ready(graph).map((node) => node.id))
  const lines = [
    "=== OCX TASK GRAPH ===",
    ...visible.slice(-24).map((node) => {
      const marker = readyIDs.has(node.id) ? "ready" : node.status
      const parent = node.parentID ? `; parent ${node.parentID}` : ""
      const dependencies = node.dependencyIDs.length > 0 ? `; depends on ${node.dependencyIDs.join(", ")}` : ""
      const blockers = node.blockers.length > 0 ? `; blocked by ${node.blockers.join(", ")}` : ""
      return `- [${marker}] ${node.kind}: ${TrustBoundary.escape(node.title)} (${node.id}${parent}${dependencies}${blockers})`
    }),
    `Ready nodes: ${ready(graph).map((node) => node.id).join(", ") || "none"}`,
    "Use the durable graph as the source for task order; keep node status and blockers current as work lands.",
    "=== END OCX TASK GRAPH ===",
  ]
  return lines.join("\n").slice(0, maxChars)
}

export * as TaskGraph from "./task-graph"
