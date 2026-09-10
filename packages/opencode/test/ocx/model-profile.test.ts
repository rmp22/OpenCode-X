import { describe, expect, test } from "bun:test"
import { resolveModelProfile } from "@/ocx/model-profile/profiles"
import { getAdaptiveScaffold } from "@/ocx/model-profile/scaffolding"

describe("Model Profile Adaptive Scaffolding", () => {
  test("resolves frontier profiles with lean scaffolding", () => {
    const sonnet = resolveModelProfile("anthropic/claude-3-5-sonnet")
    expect(sonnet.capabilities.tier).toBe("frontier")

    const scaffold = getAdaptiveScaffold(sonnet)
    expect(scaffold.promptStyle).toBe("lean")
    expect(scaffold.includeStepByStepExamples).toBe(false)
  })

  test("resolves standard profiles with comprehensive scaffolding", () => {
    const standard = resolveModelProfile("unknown-small-model")
    expect(standard.capabilities.tier).toBe("standard")

    const scaffold = getAdaptiveScaffold(standard)
    expect(scaffold.promptStyle).toBe("comprehensive")
    expect(scaffold.includeStepByStepExamples).toBe(true)
  })
})
