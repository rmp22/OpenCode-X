export interface CachedContextEntry {
  readonly path: string
  readonly content: string
  readonly tokenCount: number
  readonly lastAccessed: number
  readonly hash: string
}

export class VirtualizationCache {
  private readonly entries = new Map<string, CachedContextEntry>()
  private readonly maxTokens: number

  constructor(maxTokens = 32000) {
    this.maxTokens = maxTokens
  }

  get(path: string): string | undefined {
    const entry = this.entries.get(path)
    if (!entry) return undefined
    this.entries.set(path, {
      ...entry,
      lastAccessed: Date.now(),
    })
    return entry.content
  }

  set(path: string, content: string, hash: string): void {
    const tokenEstimate = Math.ceil(content.length / 4)
    this.entries.set(path, {
      path,
      content,
      tokenCount: tokenEstimate,
      lastAccessed: Date.now(),
      hash,
    })
    this.evictToBudget()
  }

  invalidate(path: string): void {
    this.entries.delete(path)
  }

  clear(): void {
    this.entries.clear()
  }

  totalTokens(): number {
    let total = 0
    for (const entry of this.entries.values()) {
      total += entry.tokenCount
    }
    return total
  }

  private evictToBudget(): void {
    while (this.totalTokens() > this.maxTokens && this.entries.size > 0) {
      let oldestKey: string | undefined
      let oldestTime = Infinity

      for (const [key, entry] of this.entries.entries()) {
        if (entry.lastAccessed < oldestTime) {
          oldestTime = entry.lastAccessed
          oldestKey = key
        }
      }

      if (oldestKey) {
        this.entries.delete(oldestKey)
      } else {
        break
      }
    }
  }
}

export const sharedVirtualizationCache = new VirtualizationCache()

export * as VirtualizationCacheModule from "./virtualization-cache"
