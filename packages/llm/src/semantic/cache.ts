import { Effect, Schema } from "effect"
import { ClassifierID } from "./schemas"

// ── Cache Key ───────────────────────────────────────────────────────────────

export class CacheKey extends Schema.Class<CacheKey>("Semantic.CacheKey")({
  classifierId: Schema.String,
  classifierVersion: Schema.Number,
  promptVersion: Schema.optional(Schema.Number),
  contextHash: Schema.String,
  modelClass: Schema.optional(Schema.String),
}) {}

// ── Cache Entry ─────────────────────────────────────────────────────────────

interface CacheEntry<T = unknown> {
  readonly value: T
  readonly createdAt: number
  readonly key: CacheKey
}

// ── Cache ───────────────────────────────────────────────────────────────────

export interface SemanticCache {
  /** Get a cached result if the key matches. */
  readonly get: <T>(key: CacheKey) => Effect.Effect<T | undefined, never>
  /** Store a result with the given key. */
  readonly set: <T>(key: CacheKey, value: T, ttlMs?: number) => Effect.Effect<void, never>
  /** Check if a key exists and has not expired. */
  readonly has: (key: CacheKey) => Effect.Effect<boolean, never>
  /** Remove a specific entry. */
  readonly invalidate: (key: CacheKey) => Effect.Effect<void, never>
  /** Remove all entries for a classifier. */
  readonly invalidateClassifier: (classifierId: string) => Effect.Effect<void, never>
  /** Clear all entries. */
  readonly clear: () => Effect.Effect<void, never>
}

// ── In-Memory Implementation ────────────────────────────────────────────────

const DEFAULT_TTL_MS = 5 * 60 * 1000 // 5 minutes

function makeKeyString(key: CacheKey): string {
  return `${key.classifierId}:${key.classifierVersion}:${key.promptVersion ?? 0}:${key.contextHash}:${key.modelClass ?? "default"}`
}

export const makeMemoryCache = (defaultTtlMs: number = DEFAULT_TTL_MS): SemanticCache => {
  const store = new Map<string, CacheEntry>()

  const isExpired = (entry: CacheEntry, ttlMs: number): boolean => {
    return Date.now() - entry.createdAt > ttlMs
  }

  return {
    get: <T>(key: CacheKey): Effect.Effect<T | undefined, never> =>
      Effect.sync(() => {
        const entry = store.get(makeKeyString(key))
        if (!entry) return undefined
        if (isExpired(entry, defaultTtlMs)) {
          store.delete(makeKeyString(key))
          return undefined
        }
        return entry.value as T
      }),

    set: <T>(key: CacheKey, value: T, ttlMs?: number): Effect.Effect<void, never> =>
      Effect.sync(() => {
        store.set(makeKeyString(key), {
          value,
          createdAt: Date.now(),
          key,
        })
      }),

    has: (key: CacheKey): Effect.Effect<boolean, never> =>
      Effect.sync(() => {
        const entry = store.get(makeKeyString(key))
        if (!entry) return false
        if (isExpired(entry, defaultTtlMs)) {
          store.delete(makeKeyString(key))
          return false
        }
        return true
      }),

    invalidate: (key: CacheKey): Effect.Effect<void, never> =>
      Effect.sync(() => {
        store.delete(makeKeyString(key))
      }),

    invalidateClassifier: (classifierId: string): Effect.Effect<void, never> =>
      Effect.sync(() => {
        for (const [k] of store) {
          if (k.startsWith(`${classifierId}:`)) store.delete(k)
        }
      }),

    clear: (): Effect.Effect<void, never> =>
      Effect.sync(() => {
        store.clear()
      }),
  }
}

// ── Context Hashing ─────────────────────────────────────────────────────────

/**
 * Derive a stable hash from the relevant parts of a task context.
 * Used as part of cache keys to avoid recomputing identical classifications.
 */
export function hashContext(context: {
  readonly request: string
  readonly affectedFiles?: readonly string[]
  readonly workingDirectory?: string
  readonly taskSummary?: string
}): string {
  const parts = [context.request]
  if (context.affectedFiles?.length) parts.push([...context.affectedFiles].sort().join(","))
  if (context.workingDirectory) parts.push(context.workingDirectory)
  if (context.taskSummary) parts.push(context.taskSummary)
  const raw = parts.join("|")
  // Simple hash — not cryptographic, just stable and fast
  let hash = 0
  for (let i = 0; i < raw.length; i++) {
    const char = raw.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash |= 0 // Convert to 32-bit integer
  }
  return `ctx_${Math.abs(hash).toString(36)}`
}

// ── Default Cache ───────────────────────────────────────────────────────────

let defaultCache: SemanticCache | undefined

export function getDefaultCache(): SemanticCache {
  if (!defaultCache) defaultCache = makeMemoryCache()
  return defaultCache
}
