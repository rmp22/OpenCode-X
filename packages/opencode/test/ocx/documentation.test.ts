import { describe, expect, test } from "bun:test"
import { formatApiDocumentation } from "@/ocx/documentation/generator"
import { formatPullRequestDescription, formatReleaseNotes } from "@/ocx/documentation/artifacts"

describe("Documentation & Routine Artifacts", () => {
  test("formats API documentation with types and signatures", () => {
    const doc = formatApiDocumentation([
      {
        symbolName: "calculateTotal",
        kind: "function",
        signature: "function calculateTotal(items: Item[]): number",
        description: "Computes order total including taxes",
        parameters: [{ name: "items", type: "Item[]", description: "List of items" }],
        returnType: "number",
      },
    ])

    expect(doc).toContain("# API Reference")
    expect(doc).toContain("`calculateTotal`")
    expect(doc).toContain("function calculateTotal(items: Item[]): number")
  })

  test("formats PR descriptions with verification evidence", () => {
    const pr = formatPullRequestDescription({
      title: "feat(tools): add capability router",
      summary: "Introduces capability router with telemetry",
      changes: ["Add capability router", "Add typed results"],
      verificationEvidence: ["bun test test/ocx/capability-router.test.ts (3 pass)"],
      testingInstructions: "Run bun test",
    })

    expect(pr).toContain("## Summary")
    expect(pr).toContain("## Verification Evidence")
    expect(pr).toContain("bun test test/ocx/capability-router.test.ts")
  })

  test("formats release notes grouped by type", () => {
    const notes = formatReleaseNotes({
      version: "1.2.0",
      date: "2026-09-10",
      features: ["Typed tool results", "RCA anti-flail barrier"],
      fixes: ["Fix jitter backoff calculation"],
      breakingChanges: [],
    })

    expect(notes).toContain("# Release v1.2.0")
    expect(notes).toContain("## Features")
    expect(notes).toContain("## Fixes")
  })
})
