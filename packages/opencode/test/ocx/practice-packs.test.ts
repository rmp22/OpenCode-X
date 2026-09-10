import { describe, expect, test } from "bun:test"
import { PracticePacks } from "../../src/ocx/practice-packs"

const pack = (name: string, extra = "") => `---
name: ${name}
description: ${name} guidance
signals: review, verify
globs: **/*.ts
sources: https://example.com/${name} | 2026-08-28
---
## Rules
- Check the real behavior.
${extra}
## Sources
- https://example.com/${name} (2026-08-28)
`

describe("practice packs", () => {
  test("serves six built-in packs with provenance from ocx source", () => {
    const result = PracticePacks.audit()

    expect(result.packs.map((item) => item.name)).toEqual([
      "api-adherence",
      "complexity-redflags",
      "debug-discipline",
      "review-checklist",
      "safety-rules",
      "testing-doctrine",
      "google-style",
      "google-eng-practices",
      "google-testing",
      "google-api-design",
      "google-security",
    ])
    expect(result.invalid).toEqual([])
    for (const item of PracticePacks.list()) {
      expect(item.description.length).toBeGreaterThan(0)
      const loaded = PracticePacks.load(item.name)
      expect(loaded).toBeDefined()
      expect(loaded?.sources.length).toBeGreaterThan(0)
      expect(loaded?.content).toContain("## Rules")
    }
  })

  test("rejects malformed pack metadata at the parse boundary", () => {
    const valid = PracticePacks.parsePack("valid.md", pack("valid-pack"))
    expect("packs" in valid).toBe(false)
    if ("packs" in valid) return
    expect(valid.name).toBe("valid-pack")
    expect(valid.content).toContain("## Rules")

    const noSources = PracticePacks.parsePack(
      "invalid.md",
      pack("invalid-pack").replace(`sources: https://example.com/invalid-pack | 2026-08-28`, "sources:"),
    )
    expect("packs" in noSources).toBe(true)
    if (!("packs" in noSources)) return
    expect(noSources.invalid[0]?.reason).toBe("pack needs at least one dated HTTPS source")
  })

  test("selects at most two matching packs and keeps injection bounded", () => {
    const selected = PracticePacks.select({
      prompt: "review and verify this TypeScript change",
      changedPaths: ["change.ts"],
      failedChecks: [],
    })

    expect(selected.packs.length).toBeLessThanOrEqual(2)
    expect(selected.packs.some((item) => item.name === "review-checklist")).toBe(true)
    expect(PracticePacks.renderSelected(selected.packs).length).toBeLessThanOrEqual(1_500)
  })

  test("proposes source-backed pack edits for recurring findings", () => {
    const item = {
      name: "testing-doctrine",
      description: "testing",
      signals: ["test"],
      globs: [],
      sources: [{ url: "https://example.com", date: "2026-08-28" }],
      content: "rules",
      path: "/tmp/testing.md",
    }
    expect(PracticePacks.proposals([item], [{ id: "C4-tests-not-green" }])).toEqual([
      expect.stringContaining("testing-doctrine"),
    ])
  })
})
