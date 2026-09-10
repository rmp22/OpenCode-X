import { createHash } from "node:crypto"
import { EvidenceTamperingError, type EvidenceItem } from "./types"

export class ContentAddressableEvidenceStore {
  private items = new Map<string, EvidenceItem>()

  record(tool: string, params: unknown, observation: unknown): EvidenceItem {
    const rawPayload = JSON.stringify({ tool, params, observation })
    const hash = createHash("sha256").update(rawPayload).digest("hex")
    const id = `ev-${hash.slice(0, 16)}`

    const existing = this.items.get(id)
    if (existing) {
      if (existing.hash !== hash) {
        throw new EvidenceTamperingError(id)
      }
      return existing
    }

    const item: EvidenceItem = {
      id,
      kind: tool === "read" ? "read_artifact" : tool === "test" ? "test_run" : "runtime_log",
      source: tool,
      detail: `Execution of ${tool}`,
      tool,
      params,
      observation,
      timestamp: Date.now(),
      hash,
    }

    this.items.set(id, Object.freeze(item))
    return item
  }

  get(id: string): EvidenceItem | undefined {
    return this.items.get(id)
  }

  has(id: string): boolean {
    return this.items.has(id)
  }

  getAll(): EvidenceItem[] {
    return Array.from(this.items.values())
  }

  clear(): void {
    this.items.clear()
  }
}

export const defaultEvidenceStore = new ContentAddressableEvidenceStore()
