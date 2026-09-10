import {
  type ExecutionGraph,
  type GraphNode,
  type GraphEdge,
  type NodeId,
  type TransitionResult,
  type GraphCheckpoint,
  type EvidenceRecord,
  type SuspensionReason,
} from "./types"
import { validateGraph } from "./validation"
import type { CheckpointStorage } from "./checkpoint"
import { defaultCheckpointStorage } from "./checkpoint"

export class GraphEngine {
  private readonly graph: ExecutionGraph
  private readonly storage: CheckpointStorage
  private readonly sessionID: string
  private readonly nodes: Map<NodeId, GraphNode> = new Map()
  private readonly edges: GraphEdge[] = []
  private currentNode: NodeId
  private visitedNodes: NodeId[]
  private nodeOutputs: Record<NodeId, unknown> = {}
  private accumulatedEvidence: EvidenceRecord[] = []
  private budgetRemaining: number
  private activeSuspension?: SuspensionReason

  constructor(options: {
    graph: ExecutionGraph
    sessionID: string
    storage?: CheckpointStorage
    initialBudget?: number
  }) {
    const errors = validateGraph(options.graph)
    if (errors.length > 0) {
      throw new Error(`Graph validation failed: ${errors.map((e) => e.message).join("; ")}`)
    }
    this.graph = options.graph
    this.sessionID = options.sessionID
    this.storage = options.storage ?? defaultCheckpointStorage
    this.budgetRemaining = options.initialBudget ?? 100000

    for (const node of options.graph.nodes) {
      this.nodes.set(node.id, node)
    }
    for (const edge of options.graph.edges) {
      this.edges.push(edge)
    }

    const lastCheckpoint = this.storage.latestForSession(this.sessionID)
    if (lastCheckpoint && lastCheckpoint.graphId === this.graph.id) {
      this.currentNode = lastCheckpoint.currentNode
      this.visitedNodes = [...lastCheckpoint.visitedNodes]
      this.nodeOutputs = { ...lastCheckpoint.nodeOutputs }
      this.accumulatedEvidence = [...lastCheckpoint.accumulatedEvidence]
      this.budgetRemaining = lastCheckpoint.budgetRemaining
    } else {
      this.currentNode = options.graph.initialNodeId
      this.visitedNodes = [this.currentNode]
      this.createCheckpoint()
    }
  }

  getCurrentNode(): NodeId {
    return this.currentNode
  }

  getNode(id: NodeId): GraphNode | undefined {
    return this.nodes.get(id)
  }

  getNodes(): readonly GraphNode[] {
    return Array.from(this.nodes.values())
  }

  getEdges(): readonly GraphEdge[] {
    return [...this.edges]
  }

  getVisitedNodes(): readonly NodeId[] {
    return this.visitedNodes
  }

  getAccumulatedEvidence(): readonly EvidenceRecord[] {
    return this.accumulatedEvidence
  }

  getBudgetRemaining(): number {
    return this.budgetRemaining
  }

  getSuspensionReason(): SuspensionReason | undefined {
    return this.activeSuspension
  }

  addEvidence(evidence: EvidenceRecord): void {
    this.accumulatedEvidence.push(evidence)
    this.createCheckpoint()
  }

  consumeBudget(amount: number): void {
    this.budgetRemaining = Math.max(0, this.budgetRemaining - amount)
    this.createCheckpoint()
  }

  addNode(node: GraphNode): void {
    if (this.nodes.has(node.id)) {
      throw new Error(`Node with id "${node.id}" already exists in graph`)
    }
    this.nodes.set(node.id, node)
    this.createCheckpoint()
  }

  addEdge(edge: GraphEdge): void {
    if (!this.nodes.has(edge.from)) {
      throw new Error(`Edge source node "${edge.from}" does not exist`)
    }
    if (!this.nodes.has(edge.to)) {
      throw new Error(`Edge target node "${edge.to}" does not exist`)
    }
    if (edge.from === edge.to) {
      throw new Error(`Cannot add self-referential edge: ${edge.from} -> ${edge.to}`)
    }
    this.edges.push(edge)
    this.createCheckpoint()
  }

  expandBranch(fromNode: NodeId, newNodes: readonly GraphNode[], newEdges: readonly GraphEdge[]): void {
    if (!this.nodes.has(fromNode)) {
      throw new Error(`Branch origin node "${fromNode}" does not exist`)
    }
    for (const node of newNodes) {
      if (!this.nodes.has(node.id)) {
        this.nodes.set(node.id, node)
      }
    }
    for (const edge of newEdges) {
      if (this.nodes.has(edge.from) && this.nodes.has(edge.to)) {
        this.edges.push(edge)
      }
    }
    this.createCheckpoint()
  }

  cancelPending(nodeIds: readonly NodeId[]): void {
    const cancelSet = new Set(nodeIds)
    const visitedSet = new Set(this.visitedNodes)

    for (const id of cancelSet) {
      if (id === this.currentNode || visitedSet.has(id)) {
        continue
      }
      this.nodes.delete(id)
    }

    const filteredEdges = this.edges.filter(
      (e) => !cancelSet.has(e.from) && !cancelSet.has(e.to),
    )
    this.edges.length = 0
    this.edges.push(...filteredEdges)
    this.createCheckpoint()
  }

  transition(
    targetNode: NodeId,
    output?: unknown,
    context: Record<string, unknown> = {},
  ): TransitionResult {
    const from = this.currentNode

    const matchingEdge = this.edges.find((e) => e.from === from && e.to === targetNode)
    if (!matchingEdge) {
      const rejectedResult: TransitionResult = {
        status: "rejected",
        fromNode: from,
        attemptedNode: targetNode,
        reason: `No edge in graph from "${from}" to "${targetNode}"`,
      }
      return rejectedResult
    }

    if (matchingEdge.evaluateCondition && !matchingEdge.evaluateCondition(context)) {
      const rejectedResult: TransitionResult = {
        status: "rejected",
        fromNode: from,
        attemptedNode: targetNode,
        reason: `Edge condition from "${from}" to "${targetNode}" evaluated to false`,
      }
      return rejectedResult
    }

    const currentNodeDef = this.nodes.get(from)
    if (currentNodeDef?.requiredEvidence && currentNodeDef.requiredEvidence.length > 0) {
      const evidenceKinds = new Set(this.accumulatedEvidence.map((e) => e.kind))
      const missingEvidence = currentNodeDef.requiredEvidence.filter((req) => !evidenceKinds.has(req))
      if (missingEvidence.length > 0) {
        const failureReason: SuspensionReason = {
          kind: "verification_failure",
          detail: `Node "${from}" requires evidence [${missingEvidence.join(", ")}] before exit`,
          timestamp: Date.now(),
        }
        const suspendedResult = this.suspend(failureReason)
        return suspendedResult
      }
    }

    if (output !== undefined) {
      this.nodeOutputs[from] = output
    }

    this.currentNode = targetNode
    this.visitedNodes.push(targetNode)
    this.activeSuspension = undefined

    const targetDef = this.nodes.get(targetNode)
    if (targetDef?.kind === "terminal" || this.graph.terminalNodeIds.includes(targetNode)) {
      this.createCheckpoint()
      const completedResult: TransitionResult = {
        status: "completed",
        terminalNode: targetNode,
        evidence: this.accumulatedEvidence,
      }
      return completedResult
    }

    const checkpoint = this.createCheckpoint()
    const advancedResult: TransitionResult = {
      status: "advanced",
      fromNode: from,
      toNode: targetNode,
      checkpoint,
    }
    return advancedResult
  }

  suspend(reason: SuspensionReason): TransitionResult {
    this.activeSuspension = reason
    this.createCheckpoint()
    const suspendedResult: TransitionResult = {
      status: "suspended",
      node: this.currentNode,
      reason,
    }
    return suspendedResult
  }

  resume(input?: unknown): TransitionResult {
    if (!this.activeSuspension) {
      throw new Error(`Cannot resume graph that is not currently suspended`)
    }
    this.activeSuspension = undefined
    if (input !== undefined) {
      this.nodeOutputs[this.currentNode] = input
    }
    const checkpoint = this.createCheckpoint()
    const resumedResult: TransitionResult = {
      status: "resumed",
      node: this.currentNode,
      checkpoint,
    }
    return resumedResult
  }

  rollback(targetNodeId?: NodeId): TransitionResult {
    if (targetNodeId !== undefined) {
      const idx = this.visitedNodes.indexOf(targetNodeId)
      if (idx === -1) {
        const rejectedResult: TransitionResult = {
          status: "rejected",
          fromNode: this.currentNode,
          attemptedNode: targetNodeId,
          reason: `Node "${targetNodeId}" was not previously visited; cannot rollback`,
        }
        return rejectedResult
      }
      this.visitedNodes = this.visitedNodes.slice(0, idx + 1)
      this.currentNode = targetNodeId
    } else {
      if (this.visitedNodes.length <= 1) {
        const rejectedResult: TransitionResult = {
          status: "rejected",
          fromNode: this.currentNode,
          attemptedNode: "",
          reason: `No previous node available to rollback to`,
        }
        return rejectedResult
      }
      this.visitedNodes.pop()
      this.currentNode = this.visitedNodes[this.visitedNodes.length - 1]
    }

    this.activeSuspension = undefined
    const checkpoint = this.createCheckpoint()
    const rolledBackResult: TransitionResult = {
      status: "rolled_back",
      targetNode: this.currentNode,
      checkpoint,
    }
    return rolledBackResult
  }

  private createCheckpoint(): GraphCheckpoint {
    const checkpoint: GraphCheckpoint = {
      checkpointId: `chk_${this.sessionID}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      graphId: this.graph.id,
      sessionID: this.sessionID,
      currentNode: this.currentNode,
      visitedNodes: [...this.visitedNodes],
      nodeOutputs: { ...this.nodeOutputs },
      accumulatedEvidence: [...this.accumulatedEvidence],
      budgetRemaining: this.budgetRemaining,
      timestamp: Date.now(),
    }
    this.storage.save(checkpoint)
    return checkpoint
  }
}

export * as GraphEngineModule from "./engine"
