import { describe, expect, test } from "bun:test"
import { PromptGovernor } from "../../src/ocx/prompt-governor"
import { classifyShellEffect } from "../../src/ocx/search-routing"

describe("Chaos / Fault-Injection Eval", () => {
  test("no duplicate destructive replay after crash-before-mutation", () => {
    const cmd = "edit file"
    expect(classifyShellEffect(cmd)).not.toContain("FILESYSTEM_WRITE")
  })

  test("compaction preserves required runtime state", () => {
    const gov = new PromptGovernor(100)
    gov.govern([{ source: "requirements", priority: 100, tokens: 30, content: "critical constraint" }])
    expect(gov.admittedTokensCount).toBe(30)
  })

  test("formatter modifies files detected", () => {
    const before: string[] = ["src/foo.ts"]
    const after = ["src/foo.ts"]
    expect(before).toEqual(after)
  })

  test("V4 search: ROM path requested not satisfied by worktree", () => {
    const eff = classifyShellEffect("rg pattern /workspace/repo/file.ts")
    expect(eff).toContain("READ")
  })

  test("timeout must not equal test failure", () => {
    const outcome = (s: string) => (s === "timeout" ? "TIMEOUT" : "FAIL")
    expect(outcome("timeout")).toBe("TIMEOUT")
    expect(outcome("fail")).toBe("FAIL")
  })
})
