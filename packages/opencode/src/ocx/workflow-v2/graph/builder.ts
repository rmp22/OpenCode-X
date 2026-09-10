import type { GraphDefinition, GraphNode } from "./types"

export class GraphBuilder<TState = unknown> {
  private readonly nodes = new Map<string, GraphNode<unknown, unknown, TState>>()
  private initialNodeId?: string

  addNode(node: GraphNode<unknown, unknown, TState>): this {
    this.nodes.set(node.id, node)
    if (!this.initialNodeId) {
      this.initialNodeId = node.id
    }
    return this
  }

  setInitialNode(nodeId: string): this {
    this.initialNodeId = nodeId
    return this
  }

  build(id: string, name: string): GraphDefinition<TState> {
    const startId = this.initialNodeId
    if (!startId) {
      throw new Error(`Graph '${id}' has no initial node defined`)
    }
    if (!this.nodes.has(startId)) {
      throw new Error(`Initial node '${startId}' not found in graph '${id}'`)
    }
    return {
      id,
      name,
      initialNodeId: startId,
      nodes: this.nodes,
    }
  }
}
