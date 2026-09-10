import { describe, expect, test } from "bun:test"
import PROMPT_OPENCODEX from "../../src/ocx/prompt/opencodex.txt"

const lines = PROMPT_OPENCODEX.trimEnd().split("\n")
const sections = ["# COMMENTS", "# STYLE", "# OWNER", "# FLOW", "# CHECKS", "# OUTPUT", "# TOOLS", "# SECURITY"]

describe("opencodex prompt shape", () => {
  test("opens with the identity line", () => {
    expect(lines[0]).toBe("You are OpenCoder-X, an assistant for coding and software engineering.")
  })

  test("keeps the canonical section order", () => {
    const indexes = sections.map((section) => PROMPT_OPENCODEX.indexOf(section))
    expect(indexes.every((index) => index >= 0)).toBe(true)
    expect(indexes.toSorted((a, b) => a - b)).toEqual(indexes)
  })

  test("ends with the Security section last", () => {
    const headings = lines.filter((line) => line.startsWith("# "))
    expect(headings.at(-1)).toBe("# SECURITY")
  })

  test("stays under the instruction budget cap", () => {
    expect(lines.length).toBeLessThanOrEqual(60)
  })

  test("keeps detailed style enforcement in the runtime", () => {
    expect(PROMPT_OPENCODEX).not.toContain("# NAMING")
    expect(PROMPT_OPENCODEX).not.toContain("banned-word")
    expect(PROMPT_OPENCODEX).not.toContain("technical-explanation")
  })
})
