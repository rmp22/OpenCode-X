import { describe, expect, test } from "bun:test"
import { SpanProtector } from "../../src/ocx/antislop/span-protector"

describe("span protector", () => {
  test("detects protected paths, references, IDs, markers, and commands", () => {
    const text = [
      "Edit frameworks/base/services/core/java/com/android/server/Foo.java:214 with `bun test`.",
      "The session is ses_01J5Y5H0AH4Q4NXJ6P4C3P5V2K under === OCX WORKFLOW ===.",
    ].join(" ")
    const spans = SpanProtector.protect({ text })

    expect(spans.some((span) => span.reason === "file_line" && span.text.endsWith(":214"))).toBe(true)
    expect(spans.some((span) => span.reason === "id" && span.text.startsWith("ses_"))).toBe(true)
    expect(spans.some((span) => span.reason === "marker" && span.text.includes("OCX WORKFLOW"))).toBe(true)
    expect(spans.some((span) => span.reason === "literal" && span.text === "`bun test`")).toBe(true)
  })

  test("tracks explicit user quotes and tool evidence exactly", () => {
    const text = "User said: keep this exact phrase. Tool reported: exit=0."
    const spans = SpanProtector.protect({
      text,
      quotedText: ["keep this exact phrase"],
      evidence: ["exit=0"],
    })

    expect(spans.map((span) => span.text)).toEqual(["keep this exact phrase", "exit=0"])
    expect(SpanProtector.mask(text, spans)).toContain("[PROTECTED:p1]")
  })

  test("reports a changed protected span and allows unrelated punctuation changes", () => {
    const before = "See src/foo.ts:42."
    const spans = SpanProtector.protect({ text: before })

    expect(SpanProtector.verify(before, "See src/foo.ts:43.", spans).pass).toBe(false)
    expect(SpanProtector.verify(before, "See src/foo.ts:42", spans).pass).toBe(true)
  })
})
