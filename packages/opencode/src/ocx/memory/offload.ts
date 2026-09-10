export * as MemoryOffload from "./offload"
import { createHash } from "node:crypto"

export type StepStatus = "pending" | "in_progress" | "completed" | "failed" | "skipped"

export type WorkflowNode = {
  readonly id: string
  readonly title: string
  readonly status: StepStatus
  readonly target?: string
  readonly error?: string
  readonly startedAt?: number
  readonly completedAt?: number
}

export type WorkflowEdge = {
  readonly from: string
  readonly to: string
  readonly label?: string
}

export type L2WorkflowGraph = {
  readonly addNode: (node: Omit<WorkflowNode, "status"> & { status?: StepStatus }) => void
  readonly transitionNode: (id: string, status: StepStatus, error?: string) => boolean
  readonly addEdge: (from: string, to: string, label?: string) => void
  readonly getNode: (id: string) => WorkflowNode | undefined
  readonly getNodes: () => readonly WorkflowNode[]
  readonly renderMermaid: () => string
  readonly renderCompactSummary: () => string
  readonly clear: () => void
}

export function createL2WorkflowGraph(): L2WorkflowGraph {
  const nodes = new Map<string, WorkflowNode>()
  const edges: WorkflowEdge[] = []

  function addNode(node: Omit<WorkflowNode, "status"> & { status?: StepStatus }): void {
    nodes.set(node.id, {
      ...node,
      status: node.status ?? "pending",
      startedAt: node.status === "in_progress" ? Date.now() : undefined,
      completedAt: ["completed", "failed"].includes(node.status ?? "") ? Date.now() : undefined,
    })
  }

  function transitionNode(id: string, status: StepStatus, error?: string): boolean {
    const existing = nodes.get(id)
    if (!existing) return false
    nodes.set(id, {
      ...existing,
      status,
      error: error ?? existing.error,
      startedAt: status === "in_progress" && !existing.startedAt ? Date.now() : existing.startedAt,
      completedAt: ["completed", "failed", "skipped"].includes(status) ? Date.now() : existing.completedAt,
    })
    return true
  }

  function addEdge(from: string, to: string, label?: string): void {
    edges.push({ from, to, label })
  }

  function renderMermaid(): string {
    const lines = ["graph TD"]
    for (const node of nodes.values()) {
      const safeTitle = node.title.replaceAll('"', "'")
      const targetStr = node.target ? ` (${node.target})` : ""
      lines.push(`  ${node.id}["${safeTitle}${targetStr} [${node.status}]"]`)
    }
    for (const edge of edges) {
      if (edge.label) {
        lines.push(`  ${edge.from} -->|"${edge.label}"| ${edge.to}`)
      } else {
        lines.push(`  ${edge.from} --> ${edge.to}`)
      }
    }
    for (const node of nodes.values()) {
      lines.push(`  class ${node.id} status_${node.status}`)
    }
    lines.push("  classDef status_completed fill:#d4edda,stroke:#28a745,color:#155724")
    lines.push("  classDef status_in_progress fill:#cce5ff,stroke:#004085,color:#004085")
    lines.push("  classDef status_failed fill:#f8d7da,stroke:#721c24,color:#721c24")
    lines.push("  classDef status_pending fill:#fff3cd,stroke:#856404,color:#856404")
    lines.push("  classDef status_skipped fill:#e2e3e5,stroke:#383d41,color:#383d41")
    return lines.join("\n")
  }

  function renderCompactSummary(): string {
    return [...nodes.values()]
      .map((n) => `[${n.status.toUpperCase()}] ${n.id}: ${n.title}${n.target ? ` -> ${n.target}` : ""}`)
      .join(" | ")
  }

  return {
    addNode,
    transitionNode,
    addEdge,
    getNode: (id) => nodes.get(id),
    getNodes: () => [...nodes.values()],
    renderMermaid,
    renderCompactSummary,
    clear: () => {
      nodes.clear()
      edges.length = 0
    },
  }
}

export type OffloadRecord = {
  readonly id: string
  readonly sessionID: string
  readonly tool: string
  readonly size: number
  readonly preview: string
  readonly timestamp: number
}

export type OffloaderOptions = {
  readonly thresholdBytes?: number
  readonly maxPreviewLength?: number
}

export type PayloadOffloader = {
  readonly shouldOffload: (content: string) => boolean
  readonly offload: (sessionID: string, tool: string, content: string) => { readonly stub: string; readonly record: OffloadRecord }
  readonly retrieve: (id: string) => string | undefined
  readonly getRecord: (id: string) => OffloadRecord | undefined
  readonly listBySession: (sessionID: string) => readonly OffloadRecord[]
  readonly purgeSession: (sessionID: string) => number
  readonly clear: () => void
}

export function createPayloadOffloader(options: OffloaderOptions = {}): PayloadOffloader {
  const threshold = options.thresholdBytes ?? 1024
  const previewLen = options.maxPreviewLength ?? 120

  const storage = new Map<string, string>()
  const registry = new Map<string, OffloadRecord>()

  function shouldOffload(content: string): boolean {
    if (!content) return false
    return Buffer.byteLength(content, "utf8") > threshold
  }

  function offload(sessionID: string, tool: string, content: string): { readonly stub: string; readonly record: OffloadRecord } {
    const hash = createHash("sha256").update(content).digest("hex").slice(0, 16)
    const size = Buffer.byteLength(content, "utf8")
    const preview = content.slice(0, previewLen).replace(/\s+/g, " ").trim()
    const record: OffloadRecord = {
      id: hash,
      sessionID,
      tool,
      size,
      preview,
      timestamp: Date.now(),
    }

    storage.set(hash, content)
    registry.set(hash, record)

    const stub = `[OFFLOADED: id=${hash} tool=${tool} bytes=${size} preview="${preview}..."]`
    return { stub, record }
  }

  function retrieve(id: string): string | undefined {
    return storage.get(id)
  }

  function getRecord(id: string): OffloadRecord | undefined {
    return registry.get(id)
  }

  function listBySession(sessionID: string): readonly OffloadRecord[] {
    return [...registry.values()].filter((r) => r.sessionID === sessionID)
  }

  function purgeSession(sessionID: string): number {
    let count = 0
    for (const [id, rec] of registry.entries()) {
      if (rec.sessionID === sessionID) {
        registry.delete(id)
        storage.delete(id)
        count++
      }
    }
    return count
  }

  return {
    shouldOffload,
    offload,
    retrieve,
    getRecord,
    listBySession,
    purgeSession,
    clear: () => {
      storage.clear()
      registry.clear()
    },
  }
}
