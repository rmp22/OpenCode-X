import { describe, expect, test } from "bun:test"
import { SessionDone } from "../../src/ocx/session-done"

describe("session terminal disposition", () => {
  test("reads state only from the first line", () => {
    expect(SessionDone.disposition("A note containing STATE: done\nStill working")).toBe("working")
    expect(SessionDone.disposition("PHASE: verify -> done DEPTH: concise STATE: done\nFinal")).toBe("done")
  })

  test("replaces the first-line disposition without changing the body and resolves blocked to needs_input", () => {
    expect(SessionDone.replaceDisposition("PHASE: verify DEPTH: concise STATE: done\nFinal", "blocked")).toBe(
      "PHASE: verify DEPTH: concise STATE: needs_input\nFinal",
    )
    expect(SessionDone.disposition("PHASE: verify DEPTH: concise STATE: blocked\nFinal")).toBe("needs_input")
  })
})
