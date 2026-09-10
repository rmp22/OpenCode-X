import { Cause, Effect, Schema } from "effect"
import { generateObject, type RequestInput } from "../llm"
import { LLMError } from "../schema"
import {
  ClassifierDefinition,
  type ClassifierID,
  DecisionValue,
  type TaskContext,
} from "./schemas"

// ── Errors ──────────────────────────────────────────────────────────────────

export class ClassifierFailure extends Schema.TaggedErrorClass<ClassifierFailure>()("Semantic.ClassifierFailure", {
  classifierId: Schema.String,
  message: Schema.String,
  attempt: Schema.Number,
  cause: Schema.optional(Schema.Defect()),
}) {}

export class ClassifierTimeout extends Schema.TaggedErrorClass<ClassifierTimeout>()("Semantic.ClassifierTimeout", {
  classifierId: Schema.String,
  timeoutMs: Schema.Number,
}) {}

// ── Options ─────────────────────────────────────────────────────────────────

export interface ClassifyOptions {
  readonly model?: RequestInput["model"]
  readonly systemContext?: string
  readonly timeoutMs?: number
  readonly generation?: RequestInput["generation"]
}

// ── Core Primitives ─────────────────────────────────────────────────────────

const MAX_RETRIES = 2
const RETRY_BACKOFF_MS = 500
const DEFAULT_TIMEOUT_MS = 30_000

/**
 * Internal runtime dependency used to keep semantic classification testable.
 * Production callers use the default generateObject implementation.
 */
export interface ClassifierRuntimeDeps {
  readonly generateObject?: typeof generateObject
}

function classifyWith<T>(
  runtime: ClassifierRuntimeDeps,
  definition: ClassifierDefinition,
  context: TaskContext,
  schema: Schema.Schema<T>,
  options?: ClassifyOptions,
): Effect.Effect<T, ClassifierFailure | ClassifierTimeout | LLMError> {
  const generate = runtime.generateObject ?? generateObject

  return Effect.gen(function* () {
    const fallbackEnabled = definition.fallbackPolicy?.enabled ?? false
    const fallbackValue = definition.fallbackPolicy?.fallbackValue
    const model = options?.model

    if (!model) {
      if (fallbackEnabled && fallbackValue !== undefined) return fallbackValue as T
      return yield* new ClassifierFailure({
        classifierId: definition.id,
        message: "A model is required for semantic classification",
        attempt: 0,
      })
    }

    const maxRetries = Math.max(0, definition.retryPolicy?.maxRetries ?? MAX_RETRIES)
    const backoffMs = Math.max(0, definition.retryPolicy?.backoffMs ?? RETRY_BACKOFF_MS)
    const timeoutMs = Math.max(1, options?.timeoutMs ?? DEFAULT_TIMEOUT_MS)

    const systemPrompt = buildSystemPrompt(definition, context, options?.systemContext)
    const userPrompt = buildUserPrompt(context)

    let lastError: ClassifierFailure | ClassifierTimeout | LLMError | undefined

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const outcome = yield* Effect.try({
        try: () => generate({
          model,
          system: systemPrompt,
          prompt: userPrompt,
          schema: schema as never,
          generation: options?.generation,
        }),
        catch: (error) =>
          new ClassifierFailure({
            classifierId: definition.id,
            message: error instanceof Error ? error.message : String(error),
            attempt,
            cause: error,
          }),
      }).pipe(
        Effect.flatten,
        Effect.timeout(timeoutMs),
        Effect.catchTag("TimeoutError", () =>
          Effect.fail(new ClassifierTimeout({ classifierId: definition.id, timeoutMs })),
        ),
        Effect.catchCause((cause) =>
          Effect.fail(
            new ClassifierFailure({
              classifierId: definition.id,
              message: Cause.pretty(cause).slice(0, 500),
              attempt,
              cause: Cause.squash(cause),
            }),
          ),
        ),
        Effect.result,
      )

      if (outcome._tag === "Success") return outcome.success.object as T
      lastError = outcome.failure

      if (attempt < maxRetries && backoffMs > 0) {
        yield* Effect.sleep(`${backoffMs * (attempt + 1)} millis`)
      }
    }

    if (fallbackEnabled && fallbackValue !== undefined) return fallbackValue as T

    return yield* Effect.fail(
      lastError ??
        new ClassifierFailure({
          classifierId: definition.id,
          message: "Semantic classification failed without an error",
          attempt: maxRetries,
        }),
    )
  })
}

/**
 * Run a classifier and decode the output against the provided schema.
 */
export const classify = <T>(
  definition: ClassifierDefinition,
  context: TaskContext,
  schema: Schema.Schema<T>,
  options?: ClassifyOptions,
): Effect.Effect<T, ClassifierFailure | ClassifierTimeout | LLMError> =>
  classifyWith({}, definition, context, schema, options)

/**
 * Run a classifier and return a Decision.
 */
export const decide = (
  definition: ClassifierDefinition,
  context: TaskContext,
  options?: ClassifyOptions,
): Effect.Effect<DecisionValue, ClassifierFailure | ClassifierTimeout | LLMError> =>
  Effect.gen(function* () {
    const result = yield* classify(
      definition,
      context,
      Schema.Struct({
        decision: DecisionValue,
        confidence: Schema.optional(Schema.Number),
        reason: Schema.optional(Schema.String),
      }),
      options,
    )
    return result.decision
  })

/**
 * Run a classifier that returns multiple results.
 */
export const classifyMany = <T>(
  definition: ClassifierDefinition,
  context: TaskContext,
  schema: Schema.Schema<T>,
  options?: ClassifyOptions,
): Effect.Effect<ReadonlyArray<T>, ClassifierFailure | ClassifierTimeout | LLMError> =>
  Effect.gen(function* () {
    const result = yield* classify(
      definition,
      context,
      Schema.Struct({
        items: Schema.Array(schema),
      }),
      options,
    )
    return result.items
  })

/**
 * Run a classifier and extract a typed value from the result.
 */
export const extract = <T>(
  definition: ClassifierDefinition,
  context: TaskContext,
  schema: Schema.Schema<T>,
  options?: ClassifyOptions,
): Effect.Effect<T, ClassifierFailure | ClassifierTimeout | LLMError> =>
  classify(definition, context, schema, options)

// ── Helpers ─────────────────────────────────────────────────────────────────

function buildSystemPrompt(
  definition: ClassifierDefinition,
  _context: TaskContext,
  systemContext?: string,
): string {
  const parts = [definition.prompt]
  if (systemContext) parts.push(systemContext)
  parts.push("Respond with valid JSON matching the required schema. Do not include any explanation outside the JSON.")
  return parts.join("\n\n")
}

function buildUserPrompt(context: TaskContext): string {
  const parts: string[] = []
  parts.push(`Task: ${context.request}`)
  if (context.taskSummary) parts.push(`Summary: ${context.taskSummary}`)
  if (context.affectedFiles?.length) parts.push(`Affected files: ${context.affectedFiles.join(", ")}`)
  if (context.workingDirectory) parts.push(`Working directory: ${context.workingDirectory}`)
  if (context.relevantHistory?.length) parts.push(`Prior context:\n${context.relevantHistory.join("\n")}`)
  if (context.explicitRestrictions?.length) parts.push(`Restrictions: ${context.explicitRestrictions.join("; ")}`)
  if (context.repositoryFacts) {
    const facts = context.repositoryFacts
    const lines: string[] = ["Repository facts:"]
    if (facts.root) lines.push(`  root: ${facts.root}`)
    if (facts.languages?.length) lines.push(`  languages: ${facts.languages.join(", ")}`)
    if (facts.buildFiles?.length) lines.push(`  build files: ${facts.buildFiles.join(", ")}`)
    if (facts.detectedSystems?.length) lines.push(`  systems: ${facts.detectedSystems.join(", ")}`)
    if (facts.rootDirectories?.length) lines.push(`  directories: ${facts.rootDirectories.join(", ")}`)
    parts.push(lines.join("\n"))
  }
  if (context.activeOwners?.length) {
    parts.push(
      `Active owners: ${context.activeOwners.map((o) => `${o.id}${o.name ? ` (${o.name})` : ""}: ${o.domains.join(", ")}`).join("; ")}`,
    )
  }
  return parts.join("\n\n")
}

// ── ClassifierRunner (service shape) ────────────────────────────────────────

export interface ClassifierRunner {
  readonly classify: <T>(
    definition: ClassifierDefinition,
    context: TaskContext,
    schema: Schema.Schema<T>,
    options?: ClassifyOptions,
  ) => Effect.Effect<T, ClassifierFailure | ClassifierTimeout | LLMError>

  readonly decide: (
    definition: ClassifierDefinition,
    context: TaskContext,
    options?: ClassifyOptions,
  ) => Effect.Effect<DecisionValue, ClassifierFailure | ClassifierTimeout | LLMError>

  readonly classifyMany: <T>(
    definition: ClassifierDefinition,
    context: TaskContext,
    schema: Schema.Schema<T>,
    options?: ClassifyOptions,
  ) => Effect.Effect<ReadonlyArray<T>, ClassifierFailure | ClassifierTimeout | LLMError>

  readonly extract: <T>(
    definition: ClassifierDefinition,
    context: TaskContext,
    schema: Schema.Schema<T>,
    options?: ClassifyOptions,
  ) => Effect.Effect<T, ClassifierFailure | ClassifierTimeout | LLMError>
}

export const ClassifierRunner = {
  make: (runtime: ClassifierRuntimeDeps = {}): ClassifierRunner => {
    const run = <T>(
      definition: ClassifierDefinition,
      context: TaskContext,
      schema: Schema.Schema<T>,
      options?: ClassifyOptions,
    ) => classifyWith(runtime, definition, context, schema, options)

    return {
      classify: run,
      decide: (definition, context, options) =>
        Effect.gen(function* () {
          const result = yield* run(
            definition,
            context,
            Schema.Struct({
              decision: DecisionValue,
              confidence: Schema.optional(Schema.Number),
              reason: Schema.optional(Schema.String),
            }),
            options,
          )
          return result.decision
        }),
      classifyMany: (definition, context, schema, options) =>
        Effect.gen(function* () {
          const result = yield* run(
            definition,
            context,
            Schema.Struct({ items: Schema.Array(schema) }),
            options,
          )
          return result.items
        }),
      extract: run,
    }
  },
}
