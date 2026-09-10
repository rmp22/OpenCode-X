import { describe, expect, test } from "bun:test"
import { Effect, Stream } from "effect"
import { LLMEvent } from "@opencode-ai/llm"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import type { Provider } from "../../src/provider/provider"
import type { LLM } from "../../src/session/llm"
import { SpanProtector } from "../../src/ocx/antislop/span-protector"
import { StyleGate } from "../../src/ocx/style-gate"

const deps = {
  user: {} as SessionV1.User,
  model: {} as Provider.Model,
  sessionID: "ses_style_gate",
}

const draft = "PHASE: report DEPTH: concise STATE: done\nThe marker marks the workflow."

function scripted(responses: string[]) {
  const calls: unknown[] = []
  const llm = {
    calls,
    stream(input: unknown) {
      calls.push(input)
      return Stream.make(LLMEvent.textDelta({ id: `style-${calls.length}`, text: responses.shift() ?? "" }))
    },
  }
  return llm as LLM.Interface & { calls: unknown[] }
}

const softReview = JSON.stringify({
  pass: false,
  violations: [
    {
      id: "v1",
      category: "plain_language",
      severity: "soft",
      span: "marks the workflow",
      reason: "Indirect wording.",
      replacement_hint: "Use direct wording.",
    },
  ],
})
const passReview = JSON.stringify({ pass: true, violations: [] })

describe("style gate", () => {
  test("does nothing in off mode", async () => {
    const llm = scripted([])
    const result = await Effect.runPromise(StyleGate.run({ ...deps, llm }, { mode: "off", reply: draft }))

    expect(result.outcome).toBe("pass")
    expect(result.text).toBe(draft)
    expect(result.reviewCount).toBe(0)
    expect(llm.calls).toHaveLength(0)
  })

  test("passes a clean response after one semantic review", async () => {
    const llm = scripted([passReview])
    const result = await Effect.runPromise(StyleGate.run({ ...deps, llm }, { mode: "enforce", reply: draft }))

    expect(result.outcome).toBe("pass")
    expect(result.reviewCount).toBe(1)
    expect(result.allowClose).toBe(true)
    expect(llm.calls).toHaveLength(1)
  })

  test("rewrites one prose violation and verifies it once", async () => {
    const llm = scripted([
      softReview,
      JSON.stringify({
        edits: [{ violation_id: "v1", old_text: "marks the workflow", new_text: "shows the workflow" }],
      }),
      passReview,
    ])
    const spans = SpanProtector.protect({ text: draft })
    const result = await Effect.runPromise(
      StyleGate.run({ ...deps, llm }, { mode: "rewrite_prose", reply: draft, protectedSpans: spans }),
    )

    expect(result.outcome).toBe("pass_after_rewrite")
    expect(result.text).toContain("shows the workflow")
    expect(result.text).toContain("PHASE: report DEPTH: concise STATE: done")
    expect(result.reviewCount).toBe(2)
    expect(result.rewriteCount).toBe(1)
    expect(llm.calls).toHaveLength(3)
  })

  test("does not rewrite in shadow mode", async () => {
    const llm = scripted([softReview])
    const result = await Effect.runPromise(StyleGate.run({ ...deps, llm }, { mode: "shadow", reply: draft }))

    expect(result.outcome).toBe("pass_with_soft_warnings")
    expect(result.text).toBe(draft)
    expect(result.rewriteCount).toBe(0)
    expect(result.allowClose).toBe(true)
    expect(llm.calls).toHaveLength(1)
  })

  test("blocks deterministic comment-tag violations before model review", async () => {
    const llm = scripted([])
    const result = await Effect.runPromise(
      StyleGate.run(
        { ...deps, llm },
        {
          mode: "enforce",
          reply: draft,
          added: new Map([["src/foo.ts", ["/** @remarks explains the change */"]]]),
        },
      ),
    )

    expect(result.outcome).toBe("block_hard_violation")
    expect(result.shouldContinue).toBe(true)
    expect(result.hardViolations[0]?.ruleId).toBe("comments.no_explanatory_doc_tag")
    expect(llm.calls).toHaveLength(0)
  })

  test("reports malformed reviewer output as unavailable after one retry", async () => {
    const llm = scripted(["bad", "still bad"])
    const result = await Effect.runPromise(StyleGate.run({ ...deps, llm }, { mode: "rewrite_prose", reply: draft }))

    expect(result.outcome).toBe("review_unavailable")
    expect(result.text).toBe(draft)
    expect(result.metadata.invalidReviewerJson).toBe(2)
    expect(result.shouldContinue).toBe(false)
    expect(llm.calls).toHaveLength(2)
  })
})
