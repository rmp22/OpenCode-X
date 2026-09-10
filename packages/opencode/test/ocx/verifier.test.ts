import { describe, expect, test } from "bun:test"
import { Effect, Stream } from "effect"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import { LLMEvent } from "@opencode-ai/llm"
import type { LLM } from "../../src/session/llm"
import type { Provider } from "../../src/provider/provider"
import { Verifier, type VerifierInput } from "../../src/ocx/verifier"

const scriptedLlm = (responses: string[]) => {
  const queue = [...responses]
  const calls: unknown[] = []
  const wrapped = {
    calls,
    stream(input: unknown) {
      calls.push(input)
      return Stream.make(LLMEvent.textDelta({ id: "v", text: queue.shift() ?? "" }))
    },
  }
  return wrapped as LLM.Interface & { calls: unknown[] }
}

const deps = {
  user: {} as SessionV1.User,
  model: {} as Provider.Model,
  sessionID: "ses_v",
}

const input = (over: Partial<VerifierInput> = {}): VerifierInput => ({
  reply: "We ship the thing.",
  files: [{ path: "/a/page.html", content: "<p>Your inquiry has been sent.</p>" }],
  candidates: [{ id: "A-FAKE_SUCCESS", message: "fake success copy", span: "Your inquiry has been sent" }],
  ...over,
})

const goodVerdict = JSON.stringify({
  verdicts: [
    {
      index: 0,
      confirmed: true,
      quote: "Your inquiry has been sent.",
      reason: "client-only success claim",
    },
  ],
})

describe("fresh-context verifier", () => {
  test("confirms a candidate whose quote exists verbatim in the artifact", async () => {
    const llm = scriptedLlm([goodVerdict])
    const findings = await Effect.runPromise(Verifier.verify({ ...deps, llm }, input()))
    expect(findings).toEqual([
      { id: "V-FAKE_SUCCESS", message: expect.stringContaining("verified"), span: "Your inquiry has been sent." },
    ])
  })

  test("discards verdicts with unverifiable quotes", async () => {
    const bad = JSON.stringify({
      verdicts: [{ index: 0, confirmed: true, quote: "totally different text", reason: "x" }],
    })
    const llm = scriptedLlm([bad])
    const findings = await Effect.runPromise(Verifier.verify({ ...deps, llm }, input()))
    expect(findings).toEqual([])
  })

  test("keeps rejected candidates out of findings", async () => {
    const reject = JSON.stringify({
      verdicts: [{ index: 0, confirmed: false, quote: "Your inquiry has been sent.", reason: "labeled sample" }],
    })
    const llm = scriptedLlm([reject])
    const findings = await Effect.runPromise(Verifier.verify({ ...deps, llm }, input()))
    expect(findings).toEqual([])
  })

  test("retries once on malformed json and then verifies", async () => {
    const llm = scriptedLlm(["no json", goodVerdict])
    const findings = await Effect.runPromise(Verifier.verify({ ...deps, llm }, input()))
    expect(llm.calls.length).toBe(2)
    const retryMessage = String((llm.calls[1] as { messages: { content: string }[] }).messages[0].content)
    expect(retryMessage).toContain("format_error")
    expect(findings.length).toBe(1)
  })

  test("degrades to empty findings when the stream fails", async () => {
    const failing: LLM.Interface = { stream: () => Stream.fail(new Error("down")) }
    const findings = await Effect.runPromise(Verifier.verify({ ...deps, llm: failing }, input()))
    expect(findings).toEqual([])
  })

  test("skips the call entirely without candidates", async () => {
    const llm = scriptedLlm([goodVerdict])
    await Effect.runPromise(Verifier.verify({ ...deps, llm }, input({ candidates: [] })))
    expect(llm.calls.length).toBe(0)
  })
})
