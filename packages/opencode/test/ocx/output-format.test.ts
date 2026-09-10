import { describe, expect, test } from "bun:test"
import { OutputFormat } from "../../src/ocx/output-format"

describe("output format", () => {
  test("accepts the required first line", () => {
    expect(OutputFormat.check("PHASE: verify DEPTH: standard STATE: done\nVerified: tests pass.")).toBeUndefined()
  })

  test("rejects missing, invalid, or misplaced fields", () => {
    expect(OutputFormat.check("Verified: tests pass.")?.span).toBe("Verified: tests pass.")
    expect(OutputFormat.check("PHASE: verify DEPTH: deep STATE: done")?.message).toContain("PHASE")
    expect(OutputFormat.check("PHASE: verify DEPTH: standard STATE: done extra")).toBeDefined()
  })

  test("normalizes text missing the header", () => {
    const raw = "Verified: tests pass."
    const normalized = OutputFormat.normalize(raw, "deliver", "comprehensive", "done")
    expect(normalized).toBe("PHASE: deliver DEPTH: comprehensive STATE: done\n\nVerified: tests pass.")
    expect(OutputFormat.check(normalized)).toBeUndefined()
  })

  test("preserves text already having a valid header", () => {
    const valid = "PHASE: verify DEPTH: concise STATE: done\n\nAll good."
    expect(OutputFormat.normalize(valid)).toBe(valid)
  })

  test("resolves blocked state to needs_input during normalization", () => {
    const raw = "Something went wrong."
    expect(OutputFormat.normalize(raw, "change", "concise", "blocked")).toBe(
      "PHASE: change DEPTH: concise STATE: needs_input\n\nSomething went wrong.",
    )
    const withBlocked = "PHASE: change DEPTH: concise STATE: blocked\n\nSomething went wrong."
    expect(OutputFormat.normalize(withBlocked)).toBe(
      "PHASE: change DEPTH: concise STATE: needs_input\n\nSomething went wrong.",
    )
  })
})
