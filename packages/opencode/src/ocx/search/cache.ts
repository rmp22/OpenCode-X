import { Context, Layer } from "effect"
import {
  type ObservationKey,
  type ObservationRecord,
  type SearchCoverageRecord,
  type SearchEfficiencyMetrics,
  serializeObservationKey,
} from "./types"

export class ObservationCache {
  private readonly cache = new Map<string, ObservationRecord>()
  private readonly coverageHistory: SearchCoverageRecord[] = []
  private totalQueries = 0
  private cachedHits = 0
  private cacheMisses = 0

  get<T>(
    queryOrAction: string,
    scope: string,
    repoRevision: string | number,
    envRevision?: string | number,
  ): T | undefined {
    this.totalQueries++
    const key: ObservationKey = { queryOrAction, scope, repoRevision, envRevision }
    const serialized = serializeObservationKey(key)
    const entry = this.cache.get(serialized)

    if (entry) {
      this.cachedHits++
      const updated: ObservationRecord = {
        ...entry,
        hitCount: entry.hitCount + 1,
      }
      this.cache.set(serialized, updated)
      return entry.result as T
    }

    this.cacheMisses++
    return undefined
  }

  set<T>(
    queryOrAction: string,
    scope: string,
    repoRevision: string | number,
    result: T,
    envRevision?: string | number,
  ): void {
    const key: ObservationKey = { queryOrAction, scope, repoRevision, envRevision }
    const serialized = serializeObservationKey(key)
    const record: ObservationRecord<T> = {
      key,
      result,
      timestamp: Date.now(),
      hitCount: 0,
    }
    this.cache.set(serialized, record as ObservationRecord)
  }

  invalidateScope(scope: string): void {
    for (const [k, entry] of this.cache.entries()) {
      if (entry.key.scope.startsWith(scope) || scope.startsWith(entry.key.scope)) {
        this.cache.delete(k)
      }
    }
  }

  invalidateRepoRevision(currentRevision: string | number): void {
    for (const [k, entry] of this.cache.entries()) {
      if (entry.key.repoRevision !== currentRevision) {
        this.cache.delete(k)
      }
    }
  }

  trackCoverage(record: SearchCoverageRecord): void {
    this.coverageHistory.push(record)
  }

  getCoverageHistory(): readonly SearchCoverageRecord[] {
    return this.coverageHistory
  }

  getMetrics(): SearchEfficiencyMetrics {
    const total = this.totalQueries
    const hits = this.cachedHits
    const misses = this.cacheMisses
    const hitRate = total === 0 ? 0 : Math.round((hits / total) * 100) / 100
    const redundantCallRate = hitRate
    const estimatedTokensSaved = hits * 250

    const metrics: SearchEfficiencyMetrics = {
      totalQueries: total,
      cachedHits: hits,
      cacheMisses: misses,
      hitRate,
      redundantCallRate,
      estimatedTokensSaved,
    }
    return metrics
  }

  clear(): void {
    this.cache.clear()
    this.coverageHistory.length = 0
    this.totalQueries = 0
    this.cachedHits = 0
    this.cacheMisses = 0
  }
}

export const defaultObservationCache = new ObservationCache()

export interface SearchCacheEntry {
  readonly key: string
  readonly cwd: string
  readonly value: unknown
  readonly createdAt: number
}

export class SearchCache {
  private readonly store = new Map<string, SearchCacheEntry>()

  static key(input: {
    pattern: string
    scope: string
    cwd: string
    include?: string
    caseSensitive?: boolean
    wholeWord?: boolean
  }): string {
    const parts = [
      input.pattern,
      input.cwd,
      input.scope,
      input.include ?? "",
      input.caseSensitive ? "1" : "0",
      input.wholeWord ? "1" : "0",
    ]
    const joined = parts.join("::")
    return joined
  }

  get(key: string): SearchCacheEntry | undefined {
    const entry = this.store.get(key)
    return entry
  }

  set(entry: SearchCacheEntry): void {
    this.store.set(entry.key, entry)
  }

  invalidate(cwd: string): void {
    for (const [k, v] of this.store.entries()) {
      if (v.cwd === cwd || v.cwd.startsWith(cwd)) {
        this.store.delete(k)
      }
    }
  }

  clear(): void {
    this.store.clear()
  }
}

export const defaultSearchCache = new SearchCache()

export namespace SearchCache {
  export class Service extends Context.Service<Service, SearchCache>()("@opencode/SearchCache") {}
  export const Default = Layer.succeed(Service, defaultSearchCache)
}

export * as ObservationCacheModule from "./cache"
