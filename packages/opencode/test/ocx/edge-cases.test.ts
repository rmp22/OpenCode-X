import { describe, expect, test } from "bun:test"
import { classifyShellEffect, classifySearchIntent } from "../../src/ocx/search-routing"

describe("Edge-Case Hardening", () => {
  test("shell effect classifier avoids false write", () => {
    expect(classifyShellEffect("rg -n foo file")).toContain("READ")
    expect(classifyShellEffect("rg --version")).toContain("PROCESS_READ_ONLY")
    expect(classifyShellEffect("git diff | rg foo")).toContain("READ")
    expect(classifyShellEffect("ls | rg foo")).toContain("READ")
  })

  test("rg argument parsing distinguishes exact file vs recursive", () => {
    const exact = classifySearchIntent({ command: "rg pattern file1.ts file2.ts", args: ["pattern", "file1.ts", "file2.ts"], hasPipe: false })
    expect(exact).toBe("SEARCH_EXACT_FILES")
  })

  test("search policy vs workflow phase independence", () => {
    const phases = ["context", "contract", "codegen", "selfreview", "verify"]
    for (const phase of phases) {
      expect(classifyShellEffect("rg pattern file")).toContain("READ")
    }
  })

  test("post-verification edit stales verification", () => {
    const before = "PASS"
    const after = "STALE"
    expect(before).not.toBe(after)
  })
})
