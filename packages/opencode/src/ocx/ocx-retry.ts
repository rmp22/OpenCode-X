import { NamedError } from "@opencode-ai/core/util/error"
import { LLMEvent } from "@opencode-ai/llm"
import { Cause, Clock, Duration, Effect, Schedule, Schema, Stream } from "effect"
import { isRecord } from "@/util/record"

export const EMPTY_RESPONSE_MAX_ATTEMPTS = 2
export const EMPTY_RESPONSE_MESSAGE = "Model returned an empty response"
export const EMPTY_RESPONSE_PROMPT = "Previous turn produced no output. Continue from current state."
export const CONTINUE_PROMPT = "Previous turn produced no output. Continue from current state."

export function isSilentContinueError(error: unknown) {
  if (EmptyResponseError.isInstance(error)) return true
  const text = errorText(error)
  if (
    text.includes("empty response") ||
    text.includes("no response") ||
    text.includes("empty text") ||
    text.includes("model returned an empty")
  ) {
    return true
  }
  if (!text.includes('{"detail":{"error":')) return false
  const code = errorCode(error, text)

  return (code === 403 && text.includes("spend cap breached")) || (code === 503 && text.includes("service unavailable"))
}

function errorText(error: unknown) {
  if (typeof error === "string") return error.toLowerCase()
  if (!isRecord(error)) return ""

  const data = isRecord(error.data) ? error.data : undefined
  return [error.message, error.responseBody, data?.message, data?.responseBody]
    .filter((value): value is string => typeof value === "string")
    .join("\n")
    .toLowerCase()
}

function errorCode(error: unknown, text: string) {
  const record = isRecord(error) ? error : undefined
  const data = record && isRecord(record.data) ? record.data : undefined
  const value = data?.statusCode ?? data?.code ?? record?.statusCode ?? record?.code
  if (typeof value === "number") return value
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value)
    if (!Number.isNaN(parsed)) return parsed
  }

  const match = text.match(/(?:["']?(?:code|statuscode|status)["']?\s*[=:]\s*["']?)(403|503)\b/i)
  return match ? Number(match[1]) : undefined
}

export function continuePrompt(_attempt?: number, lastActionSummary?: string): string {
  if (lastActionSummary) {
    return `Previous turn produced no output. Continue from current state: [${lastActionSummary}].`
  }
  return CONTINUE_PROMPT
}

export function isEmptyResponse(
  parts: readonly { type?: string; text?: string }[],
  toolCalls: readonly unknown[] = [],
): boolean {
  if (toolCalls.length > 0) return false
  if (parts.length === 0) return true
  const hasText = parts.some((p) => typeof p.text === "string" && p.text.trim().length > 0)
  return !hasText
}

const emptyResponseCounts = new Map<string, number>()

export function recordEmptyResponse(sessionID: string): number {
  const current = (emptyResponseCounts.get(sessionID) ?? 0) + 1
  emptyResponseCounts.set(sessionID, current)
  return current
}

export function emptyResponseCount(sessionID: string): number {
  return emptyResponseCounts.get(sessionID) ?? 0
}

export function clearEmptyResponse(sessionID: string): void {
  emptyResponseCounts.delete(sessionID)
}

export function rateLimitInterval(attempt: number): Duration.Duration {
  if (attempt <= 1) return Duration.millis(2000)
  const base = Math.min(Math.pow(2, attempt - 1) * 1000, 64000)
  const jitter = Math.random() * 1000
  return Duration.millis(base + jitter)
}

export const EmptyResponseError = NamedError.create("EmptyResponseError", { message: Schema.String })

function responded(event: LLMEvent) {
  return event.type === "text-start" || event.type === "tool-input-start" || event.type === "tool-call"
}

export function drain(input: {
  run: (attempt: number) => Stream.Stream<LLMEvent, unknown>
  compacted: () => boolean
  set: (info: { attempt: number; message: string; next: number; silent?: boolean }) => Effect.Effect<void>
  rateLimitInterval?: (attempt: number) => Duration.Duration
}) {
  let attempt = 0
  const oneAttempt = Effect.gen(function* () {
    let output = false
    yield* input
      .run(attempt)
      .pipe(
        Stream.tap((event) => {
          if (responded(event)) output = true
          return Effect.void
        }),
        Stream.takeUntil(input.compacted),
        Stream.runDrain,
      )
    if (output || input.compacted()) return
    return yield* Effect.fail(new EmptyResponseError({ message: EMPTY_RESPONSE_MESSAGE }))
  })
  return oneAttempt.pipe(
    Effect.retry(
      Schedule.fromStepWithMetadata(
        Effect.succeed((meta: Schedule.InputMetadata<unknown>) => {
          if (!EmptyResponseError.isInstance(meta.input)) return Cause.done(meta.attempt)
          return Effect.gen(function* () {
            attempt++
            const dur = input.rateLimitInterval ? input.rateLimitInterval(attempt) : rateLimitInterval(attempt)
            const now = yield* Clock.currentTimeMillis
            const next = now + Duration.toMillis(dur)
            yield* input.set({
              attempt,
              message: continuePrompt(attempt),
              next,
              silent: true,
            })
            return [meta.attempt, dur] as [number, Duration.Duration]
          })
        }),
      ),
    ),
  )
}

export * as OCXRetry from "./ocx-retry"
