import { describe, expect, test } from "bun:test"
import { LLMEvent } from "@opencode-ai/llm"
import { Cause, Duration, Effect, Exit, Stream } from "effect"
import { OCXRetry } from "../../src/ocx/ocx-retry"

function switchStream(replies: (() => LLMEvent[])[]) {
  let runs = 0
  const stream = Stream.unwrap(
    Effect.sync(() => {
      const reply = replies[Math.min(runs, replies.length - 1)]
      runs++
      return Stream.fromIterable(reply())
    }),
  )
  return { stream, calls: () => runs }
}

function failStream(error: unknown) {
  let runs = 0
  const stream = Stream.unwrap(
    Effect.sync(() => {
      runs++
      return Stream.fail(error)
    }),
  )
  return { stream, calls: () => runs }
}

const emptyStop = (): LLMEvent[] => [
  LLMEvent.stepStart({ index: 0 }),
  LLMEvent.stepFinish({ index: 0, reason: "stop" }),
  LLMEvent.finish({ reason: "stop" }),
]

const reasoningUnknown = (): LLMEvent[] => [
  LLMEvent.stepStart({ index: 0 }),
  LLMEvent.reasoningStart({ id: "r1" }),
  LLMEvent.reasoningDelta({ id: "r1", text: "thinking" }),
  LLMEvent.reasoningEnd({ id: "r1" }),
  LLMEvent.stepFinish({ index: 0, reason: "unknown" }),
  LLMEvent.finish({ reason: "unknown" }),
]

const textReply = (text: string): LLMEvent[] => [
  LLMEvent.stepStart({ index: 0 }),
  LLMEvent.textStart({ id: "t1" }),
  LLMEvent.textDelta({ id: "t1", text }),
  LLMEvent.textEnd({ id: "t1" }),
  LLMEvent.stepFinish({ index: 0, reason: "stop" }),
  LLMEvent.finish({ reason: "stop" }),
]

const instantDelay = () => 1

const CONTINUE = OCXRetry.continuePrompt

function drain(
  run: (attempt: number) => Stream.Stream<LLMEvent>,
  prompts: string[],
  sets: number[],
  compacted = () => false,
) {
  return OCXRetry.drain({
    run,
    compacted,
    rateLimitInterval: () => Duration.zero,
    set: (info) =>
      Effect.sync(() => {
        sets.push(info.attempt)
        prompts.push(OCXRetry.continuePrompt(info.attempt))
      }),
  })
}

function attemptStream(replies: (() => LLMEvent[])[], sent: string[]) {
  let runs = 0
  return (attempt: number) => {
    if (attempt > 0) sent.push(OCXRetry.continuePrompt(attempt))
    const reply = replies[Math.min(runs, replies.length - 1)]
    runs++
    return Stream.fromIterable(reply())
  }
}

describe("session.ocx-retry.drain", () => {
  test("returns continue for continuePrompt", () => {
    expect(OCXRetry.continuePrompt(1)).toBe("continue")
    expect(OCXRetry.continuePrompt(2)).toBe("continue")
    expect(OCXRetry.continuePrompt(10)).toBe("continue")
  })

  test("calculates rateLimitInterval with backoff", () => {
    expect(Duration.toMillis(OCXRetry.rateLimitInterval(1))).toBe(2000)
    expect(Duration.toMillis(OCXRetry.rateLimitInterval(2))).toBeGreaterThanOrEqual(2000)
    expect(Duration.toMillis(OCXRetry.rateLimitInterval(3))).toBeGreaterThanOrEqual(4000)
  })

  test("retries an empty stop response with a continue prompt and succeeds", async () => {
    const sent: string[] = []
    const run = attemptStream([emptyStop, () => textReply("recovered")], sent)
    const sets: number[] = []
    const prompts: string[] = []

    const exit = await Effect.runPromiseExit(drain(run, prompts, sets))

    expect(exit._tag).toBe("Success")
    expect(sent).toEqual(["continue"])
    expect(prompts).toEqual(["continue"])
  })

  test("sends continue prompt on multiple attempts", async () => {
    const sent: string[] = []
    const run = attemptStream([emptyStop, emptyStop, () => textReply("finally")], sent)
    const sets: number[] = []
    const prompts: string[] = []

    const exit = await Effect.runPromiseExit(drain(run, prompts, sets))

    expect(exit._tag).toBe("Success")
    expect(sets).toEqual([1, 2])
    expect(sent).toEqual(["continue", "continue"])
  })

  test("continuously retries empty responses beyond former max attempts", async () => {
    const sent: string[] = []
    const run = attemptStream([emptyStop, emptyStop, emptyStop, emptyStop, () => textReply("success")], sent)
    const sets: number[] = []
    const prompts: string[] = []

    const exit = await Effect.runPromiseExit(drain(run, prompts, sets))

    expect(exit._tag).toBe("Success")
    expect(sent.length).toBe(4)
    expect(sent.every((s) => s === "continue")).toBe(true)
  })

  test("sets silent flag when nudging empty response", async () => {
    let silentFlag: boolean | undefined
    const run = attemptStream([emptyStop, () => textReply("ok")], [])
    await Effect.runPromise(
      OCXRetry.drain({
        run,
        compacted: () => false,
        rateLimitInterval: () => Duration.zero,
        set: (info) =>
          Effect.sync(() => {
            silentFlag = info.silent
          }),
      }),
    )
    expect(silentFlag).toBe(true)
  })

  test("does not retry when content was produced", async () => {
    const sent: string[] = []
    const run = attemptStream([() => textReply("hello")], sent)
    const sets: number[] = []
    const prompts: string[] = []

    const exit = await Effect.runPromiseExit(drain(run, prompts, sets))

    expect(exit._tag).toBe("Success")
    expect(sent.length).toBe(0)
    expect(sets.length).toBe(0)
  })

  test("stops retrying once compaction takes over", async () => {
    const sent: string[] = []
    const run = attemptStream([emptyStop, emptyStop], sent)
    const sets: number[] = []
    const prompts: string[] = []

    const exit = await Effect.runPromiseExit(drain(run, prompts, sets, () => true))

    expect(exit._tag).toBe("Success")
    expect(sent.length).toBe(0)
  })

  test("non-empty-response failures are not retried here", async () => {
    const boom = Stream.fail(new Error("boom"))
    const sets: number[] = []
    const prompts: string[] = []

    const exit = await Effect.runPromiseExit(
      OCXRetry.drain({
        run: () => boom,
        compacted: () => false,
        set: (info) => Effect.sync(() => sets.push(info.attempt)),
      }).pipe(Effect.catch(() => Effect.succeed(undefined))),
    )

    expect(sets.length).toBe(0)
    void prompts
  })
})

describe("session.ocx-retry.silent-continue", () => {
  test("matches a spend cap 403 response", () => {
    const error = new Error(
      'Forbidden: {"detail":{"error":{"code":403,"message":"Spend cap breached for project: projects/978412153928 for service: generativelanguage.googleapis.com.","status":"PERMISSION_DENIED"}}}',
    )

    expect(OCXRetry.isSilentContinueError(error)).toBe(true)
  })

  test("matches a service unavailable 503 response", () => {
    const error = new Error(
      'Service Unavailable: {"detail":{"error":{"code":503,"message":"Service Unavailable","status":"UNAVAILABLE"}}}',
    )

    expect(OCXRetry.isSilentContinueError(error)).toBe(true)
  })

  test("does not match unrelated errors", () => {
    expect(OCXRetry.isSilentContinueError(new Error("Forbidden: quota exceeded"))).toBe(false)
    expect(OCXRetry.isSilentContinueError(new Error("Service Unavailable"))).toBe(false)
    expect(OCXRetry.isSilentContinueError(new Error('Forbidden: {"code":403,"message":"Other failure"}'))).toBe(false)
  })
})
