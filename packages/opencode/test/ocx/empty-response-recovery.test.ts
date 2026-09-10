import { describe, expect, test } from "bun:test"
import {
  isEmptyResponse,
  continuePrompt,
  EMPTY_RESPONSE_MAX_ATTEMPTS,
  recordEmptyResponse,
  emptyResponseCount,
  clearEmptyResponse,
} from "../../src/ocx/ocx-retry"

describe("Empty Response Recovery", () => {
  test("isEmptyResponse detects zero content parts and whitespace-only text", () => {
    expect(isEmptyResponse([], [])).toBe(true)
    expect(isEmptyResponse([{ type: "text", text: "" }], [])).toBe(true)
    expect(isEmptyResponse([{ type: "text", text: "   \n\t  " }], [])).toBe(true)

    expect(isEmptyResponse([{ type: "text", text: "Working on task" }], [])).toBe(false)
    expect(isEmptyResponse([], [{ id: "call_1", tool: "read" }])).toBe(false)
    expect(isEmptyResponse([{ type: "text", text: "" }], [{ id: "call_1", tool: "bash" }])).toBe(false)
  })

  test("continuePrompt formats context reminder and action summary", () => {
    const defaultPrompt = continuePrompt()
    expect(defaultPrompt).toContain("Previous turn produced no output")
    expect(defaultPrompt).toContain("Continue from current state")

    const promptWithSummary = continuePrompt(1, "edited src/index.ts")
    expect(promptWithSummary).toContain("[edited src/index.ts]")
  })

  test("max attempts is bounded at 2 per turn", () => {
    expect(EMPTY_RESPONSE_MAX_ATTEMPTS).toBe(2)
  })

  test("recordEmptyResponse tracks count and exhausts after max attempts", () => {
    const sessionID = "session-test-empty-recovery"
    clearEmptyResponse(sessionID)
    expect(emptyResponseCount(sessionID)).toBe(0)

    const count1 = recordEmptyResponse(sessionID)
    expect(count1).toBe(1)
    expect(count1 <= EMPTY_RESPONSE_MAX_ATTEMPTS).toBe(true)

    const count2 = recordEmptyResponse(sessionID)
    expect(count2).toBe(2)
    expect(count2 <= EMPTY_RESPONSE_MAX_ATTEMPTS).toBe(true)

    const count3 = recordEmptyResponse(sessionID)
    expect(count3).toBe(3)
    expect(count3 > EMPTY_RESPONSE_MAX_ATTEMPTS).toBe(true)

    clearEmptyResponse(sessionID)
    expect(emptyResponseCount(sessionID)).toBe(0)
  })
})
