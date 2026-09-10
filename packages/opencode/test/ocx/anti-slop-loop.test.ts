import { describe, expect, test } from "bun:test"
import { AntiSlopDiffLoop } from "@/ocx/antislop/diff-loop"

describe("AntiSlopDiffLoop", () => {
  test("flags dead code and prompts for caller verification", () => {
    const previous = "export function main() { return 1 }\n"
    const current = "export function main() { return 1 }\nfunction deadHelper() { return 2 }\n"
    const result = AntiSlopDiffLoop.auditDiff({
      filePath: "src/service.ts",
      previousContent: previous,
      currentContent: current,
    })
    expect(result.hasGaps).toBe(true)
    const deadCheck = result.checks.find((c) => c.category === "dead_code")
    expect(deadCheck?.status).toBe("flagged")
    expect(result.feedbackPrompt).toContain("DEAD CODE - SEEK CALLERS AS VERIFICATION")
  })

  test("flags missing imports in newly added code", () => {
    const previous = "public class OrderService {}\n"
    const current = "public class OrderService {\n    private Customer customer;\n}\n"
    const result = AntiSlopDiffLoop.auditDiff({
      filePath: "src/OrderService.java",
      previousContent: previous,
      currentContent: current,
    })
    expect(result.hasGaps).toBe(true)
    const importCheck = result.checks.find((c) => c.category === "imports_missing")
    expect(importCheck?.status).toBe("flagged")
    expect(result.feedbackPrompt).toContain("IMPORTS MISSING")
  })

  test("flags AI slop comments and placeholder stubs in diff", () => {
    const previous = "export function compute(x: number) {\n  return x * 2\n}\n"
    const current = "export function compute(x: number) {\n  // explain code: multiplies by two\n  return x * 2\n}\n"
    const result = AntiSlopDiffLoop.auditDiff({
      filePath: "src/math.ts",
      previousContent: previous,
      currentContent: current,
    })
    expect(result.hasGaps).toBe(true)
    const slopCheck = result.checks.find((c) => c.category === "slop_code")
    expect(slopCheck?.status).toBe("flagged")
    expect(result.feedbackPrompt).toContain("SLOP CODE")
  })

  test("flags orphan imports left behind after code removal", () => {
    const previous = "import { UnusedHelper } from './helper'\nexport function run() { return UnusedHelper() }\n"
    const current = "import { UnusedHelper } from './helper'\nexport function run() { return 42 }\n"
    const result = AntiSlopDiffLoop.auditDiff({
      filePath: "src/runner.ts",
      previousContent: previous,
      currentContent: current,
    })
    expect(result.hasGaps).toBe(true)
    const orphanCheck = result.checks.find((c) => c.category === "orphan_leftover")
    expect(orphanCheck?.status).toBe("flagged")
    expect(result.feedbackPrompt).toContain("ORPHAN/LEFTOVER CODES")
  })

  test("flags unoptimized code like inline FQNs and no-op assignments", () => {
    const previous = "export function update(x: number) {}\n"
    const current = "export function update(x: number) {\n  x = x;\n}\n"
    const result = AntiSlopDiffLoop.auditDiff({
      filePath: "src/update.ts",
      previousContent: previous,
      currentContent: current,
    })
    expect(result.hasGaps).toBe(true)
    const unoptimizedCheck = result.checks.find((c) => c.category === "unoptimized_code")
    expect(unoptimizedCheck?.status).toBe("flagged")
    expect(result.feedbackPrompt).toContain("UNOPTIMIZED CODE")
  })

  test("flags exact no-op mutations as unnecessary changes", () => {
    const content = "export const config = { timeout: 5000 }\n"
    const result = AntiSlopDiffLoop.auditDiff({
      filePath: "src/config.ts",
      previousContent: content,
      currentContent: content,
    })
    expect(result.hasGaps).toBe(true)
    const unnecessaryCheck = result.checks.find((c) => c.category === "unnecessary_changes")
    expect(unnecessaryCheck?.status).toBe("flagged")
    expect(result.feedbackPrompt).toContain("UNNECESSARY CHANGES")
  })

  test("passes verified clean when all 6 dimensions are satisfied", () => {
    const previous = "export function add(a: number, b: number) { return a + b }\n"
    const current = "export function add(a: number, b: number) { return a + b }\nexport function sub(a: number, b: number) { return a - b }\n"
    const result = AntiSlopDiffLoop.auditDiff({
      filePath: "src/math.ts",
      previousContent: previous,
      currentContent: current,
    })
    expect(result.hasGaps).toBe(false)
    expect(result.checks.every((c) => c.status === "verified_clean")).toBe(true)
    expect(result.feedbackPrompt).toContain("All 6 loop passes verified clean!")
  })

  test("enforces loop invariant: do not stop until all are cleared, else repeat the loop", () => {
    const previous = "export function run() { return 1 }\n"
    const current = "export function run() { return 1 }\nfunction uncalled() { return 2 }\n"
    const result = AntiSlopDiffLoop.auditDiff({
      filePath: "src/service.ts",
      previousContent: previous,
      currentContent: current,
    })
    expect(result.hasGaps).toBe(true)
    expect(result.feedbackPrompt).toContain("Loop Invariant: Do not stop until all are cleared, else repeat the loop.")
  })
})
