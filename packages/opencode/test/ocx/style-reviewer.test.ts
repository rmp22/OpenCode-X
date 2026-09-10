import { describe, expect, test } from "bun:test"
import { Effect, Stream } from "effect"
import { LLMEvent } from "@opencode-ai/llm"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import type { Provider } from "../../src/provider/provider"
import type { LLM } from "../../src/session/llm"
import { SpanProtector } from "../../src/ocx/antislop/span-protector"
import { StyleReviewer } from "../../src/ocx/antislop/style-reviewer"

const deps = {
  user: {} as SessionV1.User,
  model: {} as Provider.Model,
  sessionID: "ses_style_review",
}

const reviewInput = {
  draft: "Find the workflow under === OCX WORKFLOW ===.",
  protectedSpans: SpanProtector.protect({ text: "Find the workflow under === OCX WORKFLOW ===." }),
  userPrompt: "Explain the workflow.",
}

function scripted(responses: string[]) {
  const calls: unknown[] = []
  const llm = {
    calls,
    stream(input: unknown) {
      calls.push(input)
      return Stream.make(LLMEvent.textDelta({ id: "style-review", text: responses.shift() ?? "" }))
    },
  }
  return llm as LLM.Interface & { calls: unknown[] }
}

const pass = JSON.stringify({ pass: true, violations: [] })

describe("style reviewer", () => {
  test("returns a valid pass from bounded review context", async () => {
    const llm = scripted([pass])
    const result = await Effect.runPromise(StyleReviewer.review({ ...deps, llm }, reviewInput))

    expect(result.status).toBe("pass")
    expect(result.metadata.attempts).toBe(1)
    const content = String((llm.calls[0] as { messages: { content: string }[] }).messages[0].content)
    expect(content).toContain("Find the workflow")
    expect(content).toContain("[PROTECTED:")
    expect(content).not.toContain("entire session")
  })

  test("caps the draft and nearby code context", async () => {
    const llm = scripted([pass])
    const draft = `${"x".repeat(8_000)}tail-marker`
    await Effect.runPromise(
      StyleReviewer.review(
        { ...deps, llm },
        {
          draft,
          protectedSpans: [],
          nearbyCode: Array.from({ length: 5 }, (_, index) => ({
            path: `src/${index}.ts`,
            content: `${"y".repeat(2_400)}code-tail-${index}`,
          })),
        },
      ),
    )
    const content = String((llm.calls[0] as { messages: { content: string }[] }).messages[0].content)
    expect(content).not.toContain("tail-marker")
    expect(content).not.toContain("src/4.ts")
    expect(content).not.toContain("code-tail-2")
  })

  test("retries malformed JSON once", async () => {
    const llm = scripted(["not json", pass])
    const result = await Effect.runPromise(StyleReviewer.review({ ...deps, llm }, reviewInput))

    expect(result.status).toBe("pass")
    expect(result.metadata.attempts).toBe(2)
    expect(result.metadata.retryCount).toBe(1)
    expect(llm.calls).toHaveLength(2)
  })

  test("reports a failed reviewer without inventing a pass", async () => {
    const llm: LLM.Interface = { stream: () => Stream.fail(new Error("reviewer down")) }
    const result = await Effect.runPromise(StyleReviewer.review({ ...deps, llm }, reviewInput))

    expect(result.status).toBe("unavailable")
    expect(result.failure).toBe("stream")
    expect(result.review).toBeUndefined()
  })

  test("turns a synchronous provider throw into unavailable", async () => {
    const llm: LLM.Interface = {
      stream: () => {
        throw new Error("provider setup failed")
      },
    }
    const result = await Effect.runPromise(StyleReviewer.review({ ...deps, llm }, reviewInput))

    expect(result.status).toBe("unavailable")
    expect(result.failure).toBe("stream")
  })
})
