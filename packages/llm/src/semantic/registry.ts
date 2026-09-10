import { Effect, Schema } from "effect"
import { ClassifierDefinition, type ClassifierID, type TaskContext } from "./schemas"
import { ClassifierRunner, type ClassifierFailure, type ClassifierTimeout, type ClassifyOptions } from "./classifier"
import { type SemanticCache, hashContext, getDefaultCache, type CacheKey } from "./cache"
import type { LLMError } from "../schema"

// ── Errors ──────────────────────────────────────────────────────────────────

export class ClassifierNotFound extends Schema.TaggedErrorClass<ClassifierNotFound>()("Semantic.ClassifierNotFound", {
  classifierId: Schema.String,
  message: Schema.String,
}) {}

// ── Registry ────────────────────────────────────────────────────────────────

export interface ClassifierRegistry {
  readonly register: (definition: ClassifierDefinition) => Effect.Effect<void, never>
  readonly get: (id: ClassifierID) => Effect.Effect<ClassifierDefinition | undefined, never>
  readonly list: () => Effect.Effect<ReadonlyArray<ClassifierDefinition>, never>
  readonly run: <T>(
    id: ClassifierID,
    context: TaskContext,
    schema: Schema.Schema<T>,
    options?: ClassifyOptions,
  ) => Effect.Effect<T, ClassifierFailure | ClassifierTimeout | LLMError | ClassifierNotFound>
}

// ── Implementation ──────────────────────────────────────────────────────────

export const makeRegistry = (deps?: {
  readonly runner?: ClassifierRunner
  readonly cache?: SemanticCache
}): ClassifierRegistry => {
  const store = new Map<string, ClassifierDefinition>()
  const runner = deps?.runner ?? ClassifierRunner.make()
  const cache = deps?.cache ?? getDefaultCache()

  return {
    register: (definition: ClassifierDefinition): Effect.Effect<void, never> =>
      Effect.sync(() => {
        store.set(definition.id, definition)
      }),

    get: (id: ClassifierID): Effect.Effect<ClassifierDefinition | undefined, never> =>
      Effect.sync(() => store.get(id)),

    list: (): Effect.Effect<ReadonlyArray<ClassifierDefinition>, never> =>
      Effect.sync(() => [...store.values()]),

    run: <T>(
      id: ClassifierID,
      context: TaskContext,
      schema: Schema.Schema<T>,
      options?: ClassifyOptions,
    ): Effect.Effect<T, ClassifierFailure | ClassifierTimeout | LLMError | ClassifierNotFound> =>
      Effect.gen(function* () {
        const definition = store.get(id)
        if (!definition) {
          return yield* new ClassifierNotFound({
            classifierId: id,
            message: `Classifier "${id}" not registered`,
          })
        }

        const contextHash = hashContext(context)
        const cacheKey: CacheKey = {
          classifierId: definition.id,
          classifierVersion: definition.version,
          contextHash,
          modelClass: options?.model ? undefined : definition.modelClass,
        }

        const cached = yield* cache.get<T>(cacheKey)
        if (cached !== undefined) return cached

        const result = yield* runner.classify(definition, context, schema, options)

        const ttlMs = definition.cachePolicy?.ttlMs
        yield* cache.set(cacheKey, result, ttlMs)

        return result
      }),
  }
}

// ── Singleton ───────────────────────────────────────────────────────────────

let defaultRegistry: ClassifierRegistry | undefined

export function getDefaultRegistry(): ClassifierRegistry {
  if (!defaultRegistry) defaultRegistry = makeRegistry()
  return defaultRegistry
}
