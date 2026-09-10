import { createHash } from "crypto"
import type { ObservationKind, ObservationRecord } from "./types"

export class ObservationCache {
  private readonly entries = new Map<string, ObservationRecord>()

  static computeHash(content: string): string {
    return createHash("sha256").update(content).digest("hex")
  }

  record(kind: ObservationKind, key: string, content: string, metadata?: Record<string, unknown>): ObservationRecord {
    const cacheKey = `${kind}:${key}`
    const existing = this.entries.get(cacheKey)
    const hash = ObservationCache.computeHash(content)
    if (existing && existing.hash === hash) {
      return existing
    }
    const record: ObservationRecord = {
      id: `obs_${kind}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      kind,
      key,
      content,
      hash,
      timestamp: Date.now(),
      metadata,
    }
    this.entries.set(cacheKey, record)
    return record
  }

  get(kind: ObservationKind, key: string): ObservationRecord | undefined {
    return this.entries.get(`${kind}:${key}`)
  }

  has(kind: ObservationKind, key: string): boolean {
    return this.entries.has(`${kind}:${key}`)
  }

  invalidateFile(filePath: string): number {
    let invalidated = 0
    for (const [cacheKey, obs] of this.entries.entries()) {
      if (obs.kind === "file_read" && (obs.key === filePath || obs.key.endsWith(`/${filePath}`))) {
        this.entries.delete(cacheKey)
        invalidated++
      }
    }
    return invalidated
  }

  clear(): void {
    this.entries.clear()
  }

  size(): number {
    return this.entries.size
  }

  getAll(): readonly ObservationRecord[] {
    return Array.from(this.entries.values())
  }
}

export const defaultObservationCache = new ObservationCache()
export * as ObservationCacheModule from "./cache"
