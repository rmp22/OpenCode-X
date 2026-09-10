export type ObservationKey = {
  readonly queryOrAction: string
  readonly scope: string
  readonly repoRevision: string | number
  readonly envRevision?: string | number
}

export type ObservationRecord<T = unknown> = {
  readonly key: ObservationKey
  readonly result: T
  readonly timestamp: number
  readonly hitCount: number
  readonly metadata?: Record<string, unknown>
}

export type SearchCoverageRecord = {
  readonly query: string
  readonly scopes: readonly string[]
  readonly queryVariants: readonly string[]
  readonly resultCount: number
  readonly excludedScopes: readonly { readonly scope: string; readonly reason: string }[]
  readonly timestamp: number
}

export type SearchEfficiencyMetrics = {
  readonly totalQueries: number
  readonly cachedHits: number
  readonly cacheMisses: number
  readonly hitRate: number
  readonly redundantCallRate: number
  readonly estimatedTokensSaved: number
}

export function serializeObservationKey(key: ObservationKey): string {
  const serialized = key.queryOrAction + "::" + key.scope + "::" + key.repoRevision + "::" + (key.envRevision ?? "default")
  return serialized
}

export interface SearchQuery {
  readonly pattern: string
  readonly cwd: string
  readonly include?: string
  readonly maxResults?: number
  readonly caseSensitive?: boolean
  readonly wholeWord?: boolean
  readonly paths?: readonly string[]
  readonly signal?: AbortSignal
}

export interface SearchMatch {
  readonly file: string
  readonly line: number
  readonly column?: number
  readonly text: string
}

export interface SearchResult {
  readonly matches: readonly SearchMatch[]
  readonly total: number
  readonly truncated: boolean
  readonly cached: boolean
  readonly durationMs: number
  readonly scope: string
  readonly autoNarrowed?: boolean
  readonly autoNarrowReason?: string
}

export interface ToolHealthState {
  readonly consecutiveFailures: number
  readonly consecutiveEmpty: number
  readonly lastError?: string
  readonly lastQuery?: string
  readonly circuitBroken: boolean
  readonly correctiveAction?: string
}

export * as SearchTypes from "./types"
