import { describe, expect, test } from "bun:test"
import { ReasoningTopic } from "../../src/ocx/reasoning/topic"

describe("reasoning topic", () => {
  test("derives a concrete topic from provider reasoning", () => {
    expect(ReasoningTopic.deriveTopic("Inspect the retry boundary\nCheck the caller")).toBe("Inspect the retry boundary")
  })

  test("does not use a generic or unavailable context heading", () => {
    expect(ReasoningTopic.deriveTopic("Thinking\nNo request context is available")).toBeUndefined()
  })
})
