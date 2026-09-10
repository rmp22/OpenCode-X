import { Context, Effect, Layer, Ref } from "effect"
import path from "node:path"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import type { Match } from "@opencode-ai/schema/filesystem"
import { SearchCache } from "./cache"
import type {
  SearchQuery,
  SearchResult,
  SearchMatch,
  ToolHealthState,
} from "./types"

const SOURCE_EXTENSIONS = "*.{ts,tsx,js,jsx,json,py,rs,go,java,c,cpp,h}"
const MAX_SEARCH_RESULTS = 500

export interface Interface {
  readonly search: (query: SearchQuery) => Effect.Effect<SearchResult, Error>
  readonly invalidate: (cwd: string) => Effect.Effect<void>
  readonly clear: () => Effect.Effect<void>
  readonly getHealth: () => Effect.Effect<ToolHealthState>
  readonly resetHealth: () => Effect.Effect<void>
}

export class SearchService extends Context.Service<SearchService, Interface>()("@opencode/SearchService") {}

function buildCacheKey(query: SearchQuery): string {
  const input = {
    pattern: query.pattern,
    scope: query.paths?.join(":") ?? query.cwd,
    cwd: query.cwd,
    include: query.include,
    caseSensitive: query.caseSensitive,
    wholeWord: query.wholeWord,
  }
  const key = SearchCache.key(input)
  return key
}

function formatMatches(matches: readonly Match[], cwd: string): SearchMatch[] {
  const result: SearchMatch[] = []
  for (const m of matches) {
    const sub = m.submatches?.[0]
    const filePath = m.entry?.path ?? ""
    const item: SearchMatch = {
      file: path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath),
      line: m.line,
      column: sub ? sub.start + 1 : undefined,
      text: (m.text ?? "").trimEnd(),
    }
    result.push(item)
  }
  return result
}

function recordFailure(prev: ToolHealthState, query: string, error: string): ToolHealthState {
  const failures = prev.consecutiveFailures + 1
  const broken = failures >= 3
  const correctiveAction = broken
    ? "Consecutive syntax or execution failures detected. Verify regular expression escaping (e.g. avoid unescaped brackets or wildcards) or use fixed string matching."
    : undefined
  const state: ToolHealthState = {
    consecutiveFailures: failures,
    consecutiveEmpty: prev.consecutiveEmpty,
    lastError: error,
    lastQuery: query,
    circuitBroken: broken,
    correctiveAction,
  }
  return state
}

function recordEmpty(prev: ToolHealthState, query: string): ToolHealthState {
  const nextEmpty = prev.consecutiveEmpty + 1
  const broken = nextEmpty >= 5
  const correctiveAction = broken
    ? "Multiple empty searches. Confirm file path existences with glob or verify pattern case."
    : undefined
  const state: ToolHealthState = {
    consecutiveFailures: 0,
    consecutiveEmpty: nextEmpty,
    lastQuery: query,
    circuitBroken: broken,
    correctiveAction,
  }
  return state
}

function resetHealthState(): ToolHealthState {
  const state: ToolHealthState = {
    consecutiveFailures: 0,
    consecutiveEmpty: 0,
    circuitBroken: false,
  }
  return state
}

export const makeSearchService = Effect.gen(function* () {
  const ripgrep = yield* Ripgrep.Service
  const cache = yield* SearchCache.Service
  const healthRef = yield* Ref.make<ToolHealthState>(resetHealthState())

  const invalidate = (cwd: string) =>
    Effect.sync(() => {
      cache.invalidate(cwd)
    })

  const clear = () =>
    Effect.sync(() => {
      cache.clear()
    })

  const getHealth = () => Ref.get(healthRef)

  const resetHealth = () => Ref.set(healthRef, resetHealthState())

  const runGrepEffect = (
    query: SearchQuery,
    pattern: string,
    include: string | undefined,
    _caseSensitive: boolean | undefined,
    maxCount: number,
  ) =>
    ripgrep.grep({
      cwd: query.cwd,
      pattern,
      include,
      limit: maxCount,
      signal: query.signal,
    })

  const search = (query: SearchQuery): Effect.Effect<SearchResult, Error> =>
    Effect.gen(function* () {
      const currentHealth = yield* Ref.get(healthRef)
      if (currentHealth.circuitBroken && currentHealth.lastQuery === query.pattern) {
        const failureMessage = `Search circuit broken for pattern "${query.pattern}". ${currentHealth.correctiveAction ?? "Refine the search pattern or target specific file paths before retrying."}`
        yield* Effect.fail(new Error(failureMessage))
      }

      const cacheKey = buildCacheKey(query)
      const cached = cache.get(cacheKey)
      if (cached) {
        const cachedMatches = (cached.value as SearchMatch[]) ?? []
        const cachedResult: SearchResult = {
          matches: cachedMatches,
          total: cachedMatches.length,
          truncated: false,
          cached: true,
          durationMs: 0,
          scope: query.paths?.join(", ") ?? query.cwd,
        }
        return cachedResult
      }

      const startTime = Date.now()
      const limit = query.maxResults ?? MAX_SEARCH_RESULTS

      let pattern = query.pattern
      let include = query.include
      let caseSensitive = query.caseSensitive
      let autoNarrowed = false
      let autoNarrowReason: string | undefined

      const searchAttempt = runGrepEffect(query, pattern, include, caseSensitive, limit + 1).pipe(
        Effect.mapError((err) => new Error(String(err))),
        Effect.tapError((err) =>
          Ref.update(healthRef, (prev) => recordFailure(prev, query.pattern, err.message)),
        ),
      )

      let rawMatches = yield* searchAttempt
      if (rawMatches.length > limit && !include) {
        include = SOURCE_EXTENSIONS
        autoNarrowed = true
        autoNarrowReason = "Result set exceeded limit; narrowed search to common source file extensions."
        rawMatches = yield* runGrepEffect(query, pattern, include, caseSensitive, limit + 1).pipe(
          Effect.mapError((err) => new Error(String(err))),
        )
      }

      if (rawMatches.length > limit && !caseSensitive) {
        caseSensitive = true
        autoNarrowed = true
        autoNarrowReason = "Result set still exceeded limit; enforced case-sensitive match."
        rawMatches = yield* runGrepEffect(query, pattern, include, caseSensitive, limit + 1).pipe(
          Effect.mapError((err) => new Error(String(err))),
        )
      }

      const truncated = rawMatches.length > limit
      const finalMatches = truncated ? rawMatches.slice(0, limit) : rawMatches
      const formattedMatches = formatMatches(finalMatches, query.cwd)

      if (formattedMatches.length === 0) {
        yield* Ref.update(healthRef, (prev) => recordEmpty(prev, query.pattern))
      } else {
        yield* Ref.set(healthRef, resetHealthState())
      }

      const durationMs = Date.now() - startTime
      cache.set({
        key: cacheKey,
        cwd: query.cwd,
        value: formattedMatches,
        createdAt: startTime,
      })

      const finalResult: SearchResult = {
        matches: formattedMatches,
        total: formattedMatches.length,
        truncated,
        cached: false,
        durationMs,
        scope: query.paths?.join(", ") ?? query.cwd,
        autoNarrowed,
        autoNarrowReason,
      }
      return finalResult
    })

  const service = {
    search,
    invalidate,
    clear,
    getHealth,
    resetHealth,
  }
  return service
})

export const SearchServiceLive = Layer.effect(SearchService, makeSearchService).pipe(
  Layer.provide(SearchCache.Default),
)
