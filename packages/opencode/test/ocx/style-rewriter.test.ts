import { describe, expect, test } from "bun:test"
import { Effect, Stream } from "effect"
import { LLMEvent } from "@opencode-ai/llm"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import type { Provider } from "../../src/provider/provider"
import type { LLM } from "../../src/session/llm"
import { StyleRewriter } from "../../src/ocx/antislop/style-rewriter"
import type { StyleViolation } from "../../src/ocx/antislop/style-contract"

const deps = {
  user: {} as SessionV1.User,
  model: {} as Provider.Model,
  sessionID: "ses_style_rewrite",
}

const violation: StyleViolation = {
  id: "v1",
  category: "plain_language",
  severity: "soft",
  span: "marks the workflow",
  reason: "Indirect wording.",
  replacement_hint: "Use direct wording.",
}

function scripted(responses: string[]) {
  const calls: unknown[] = []
  const llm = {
    calls,
    stream(input: unknown) {
      calls.push(input)
      return Stream.make(LLMEvent.textDelta({ id: "style-rewrite", text: responses.shift() ?? "" }))
    },
  }
  return llm as LLM.Interface & { calls: unknown[] }
}

const input = {
  draft: "The marker marks the workflow.",
  protectedSpans: [],
  violations: [violation],
}

describe("style rewriter", () => {
  test("returns edit operations instead of a full answer", async () => {
    const llm = scripted([
      JSON.stringify({
        edits: [{ violation_id: "v1", old_text: "marks the workflow", new_text: "shows the workflow" }],
      }),
    ])
    const result = await Effect.runPromise(StyleRewriter.rewrite({ ...deps, llm }, input))

    expect(result.status).toBe("success")
    expect(result.edits).toEqual([
      { violation_id: "v1", old_text: "marks the workflow", new_text: "shows the workflow" },
    ])
    const content = String((llm.calls[0] as { messages: { content: string }[] }).messages[0].content)
    expect(content).toContain("edit operations only")
    expect(content).toContain("Do not return a full answer")
  })

  test("retries malformed JSON once", async () => {
    const llm = scripted(["bad", JSON.stringify({ edits: [] })])
    const result = await Effect.runPromise(StyleRewriter.rewrite({ ...deps, llm }, input))

    expect(result.status).toBe("success")
    expect(result.edits).toEqual([])
    expect(result.metadata.attempts).toBe(2)
    expect(result.metadata.retryCount).toBe(1)
  })

  test("reports a failed rewrite without edits", async () => {
    const llm: LLM.Interface = { stream: () => Stream.fail(new Error("rewriter down")) }
    const result = await Effect.runPromise(StyleRewriter.rewrite({ ...deps, llm }, input))

    expect(result.status).toBe("unavailable")
    expect(result.edits).toEqual([])
    expect(result.failure).toBe("stream")
  })

  test("turns a synchronous provider throw into unavailable", async () => {
    const llm: LLM.Interface = {
      stream: () => {
        throw new Error("provider setup failed")
      },
    }
    const result = await Effect.runPromise(StyleRewriter.rewrite({ ...deps, llm }, input))

    expect(result.status).toBe("unavailable")
    expect(result.failure).toBe("stream")
  })
})
