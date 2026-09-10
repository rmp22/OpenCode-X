import { describe, expect, test } from "bun:test"
import { Escalation } from "../../src/ocx/turn/escalation"

describe("OCX unresolved finding escalation", () => {
  test("reports the round and remaining finding IDs", () => {
    const result = Escalation.message(2, [
      { id: "C4-tests-not-green", message: "no passing test run found" },
      { id: "C7-edit-before-read", message: "edited a file without reading it" },
    ])
    expect(result).toContain("after 3 rounds")
    expect(result).toContain("C4-tests-not-green")
    expect(result).toContain("C7-edit-before-read")
  })

  test("returns no feedback for clean findings", () => {
    expect(Escalation.message(0, [])).toBeUndefined()
  })

  test("caps the findings shown to the user", () => {
    const findings = Array.from({ length: 10 }, (_, index) => ({ id: `C${index}`, message: "still open" }))
    const result = Escalation.message(0, findings)
    expect(result?.split("\n").filter((line) => line.startsWith("- "))).toHaveLength(8)
  })
})
