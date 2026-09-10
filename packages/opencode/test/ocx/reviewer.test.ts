import { describe, expect, test } from "bun:test"
import { Effect, Stream } from "effect"
import { LLMEvent } from "@opencode-ai/llm"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import type { Provider } from "../../src/provider/provider"
import type { LLM } from "../../src/session/llm"
import { Reviewer, type ReviewerInput } from "../../src/ocx/reviewer"

const model = {} as Provider.Model
const strongModel = { strong: true } as unknown as Provider.Model
const deps = {
  user: {} as SessionV1.User,
  model,
  sessionID: "ses_reviewer",
}

const input = (over: Partial<ReviewerInput> = {}): ReviewerInput => ({
  diffs: [{ path: "src/change.ts", diff: "const visible = true\nconst danger = call()" }],
  criteria: {
    risks: ["The changed call must keep its permission check."],
    expectations: ["Run the focused test suite."],
    userPrompt: "Keep the public behavior unchanged.",
  },
  ...over,
})

const scriptedLlm = (response: string) => {
  const calls: unknown[] = []
  const llm = {
    calls,
    stream(request: unknown) {
      calls.push(request)
      return Stream.make(LLMEvent.textDelta({ id: "review", text: response }))
    },
  }
  return llm as LLM.Interface & { calls: unknown[] }
}

describe("review thresholds", () => {
  test("reviews full-tier changes but requires enough standard-tier additions", () => {
    expect(Reviewer.shouldReview(0, 100, "full")).toBe(false)
    expect(Reviewer.shouldReview(1, 11, "standard")).toBe(false)
    expect(Reviewer.shouldReview(1, 12, "standard")).toBe(true)
    expect(Reviewer.shouldReview(1, 1, "full")).toBe(true)
    expect(Reviewer.shouldReview(1, 12, "quick")).toBe(false)
  })
})

describe("fresh-context reviewer", () => {
  test("reads only bounded diffs and supplied criteria, not hidden session context", async () => {
    const llm = scriptedLlm(JSON.stringify({ findings: [] }))
    const result = await Effect.runPromise(Reviewer.review({ ...deps, llm }, input()))
    expect(result).toEqual({ blockers: [], advisories: [] })
    const content = String((llm.calls[0] as { messages: { content: string }[] }).messages[0].content)
    expect(content).toContain("const visible = true")
    expect(content).toContain("Keep the public behavior unchanged.")
    expect(content).not.toContain("hidden session context")
    expect(llm.calls.length).toBe(1)
  })

  test("caps review input at six files and eight thousand characters per diff", async () => {
    const overflow = `${"x".repeat(8_000)}overflow-marker`
    const diffs = Array.from({ length: 7 }, (_, index) => ({
      path: `src/file-${index}.ts`,
      diff: index === 0 ? overflow : `line ${index}`,
    }))
    const llm = scriptedLlm(JSON.stringify({ findings: [] }))
    await Effect.runPromise(Reviewer.review({ ...deps, llm }, input({ diffs })))
    const content = String((llm.calls[0] as { messages: { content: string }[] }).messages[0].content)
    expect(content).not.toContain("overflow-marker")
    expect(content).not.toContain("src/file-6.ts")
  })

  test("accepts JSON wrapped in prose and rejects quotes outside the supplied diff", async () => {
    const llm = scriptedLlm(
      `Review result:\n${JSON.stringify({
        findings: [
          { severity: "blocker", quote: "const danger = call()", message: "permission check is missing" },
          { severity: "advisory", quote: "const visible = true", message: "check the default" },
          { severity: "blocker", quote: "not in the diff", message: "unverifiable" },
        ],
      })}`,
    )
    const result = await Effect.runPromise(Reviewer.review({ ...deps, llm }, input()))
    expect(result.blockers.map((finding) => finding.id)).toEqual(["R1-review-finding"])
    expect(result.advisories.map((finding) => finding.id)).toEqual(["R1-review-advisory"])
    expect(result.blockers[0]?.span).toBe("const danger = call()")
  })

  test("uses the opt-in strong model only for a red ladder or near blocker", async () => {
    const nearBlockerLlm = scriptedLlm(JSON.stringify({ findings: [] }))
    await Effect.runPromise(
      Reviewer.review(
        { ...deps, llm: nearBlockerLlm },
        input({ strongModel, nearBlocker: true }),
      ),
    )
    const nearCall = nearBlockerLlm.calls[0] as { model: unknown; agent: { name: string } }
    expect(nearCall.model).toBe(strongModel)
    expect(nearCall.agent.name).toBe("ocx-strong-reviewer")

    const normalLlm = scriptedLlm(JSON.stringify({ findings: [] }))
    await Effect.runPromise(
      Reviewer.review(
        { ...deps, llm: normalLlm },
        input({ strongModel, ladderRed: false, nearBlocker: false }),
      ),
    )
    const normalCall = normalLlm.calls[0] as { model: unknown; agent: { name: string } }
    expect(normalCall.model).toBe(model)
    expect(normalCall.agent.name).toBe("ocx-reviewer")
  })

  test("returns empty findings when the reviewer times out", async () => {
    const hanging: LLM.Interface = { stream: () => Stream.never }
    const result = await Effect.runPromise(Reviewer.review({ ...deps, llm: hanging }, input({ timeoutMs: 1 })))
    expect(result).toEqual({ blockers: [], advisories: [] })
  })
})

describe("review escalation", () => {
  test("recognizes deterministic findings that justify a stronger reviewer", () => {
    expect(Reviewer.isNearBlocker([{ id: "C31-ladder-unverifiable", message: "x" }])).toBe(true)
    expect(Reviewer.isNearBlocker([{ id: "E1-banned-word", message: "x" }])).toBe(false)
  })
})
