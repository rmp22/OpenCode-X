import { describe, expect, test } from "bun:test"
import { SpanProtector } from "../../src/ocx/antislop/span-protector"
import { TargetedRewriter } from "../../src/ocx/antislop/targeted-rewriter"
import type { StyleViolation } from "../../src/ocx/antislop/style-contract"

const violation = (id: string, span: string): StyleViolation => ({
  id,
  category: "plain_language",
  severity: "soft",
  span,
  reason: "Indirect wording.",
  replacement_hint: "Use direct wording.",
})

describe("targeted rewriter", () => {
  test("applies multiple edits from the end of the draft", () => {
    const draft = "First weak sentence. Second weak sentence."
    const result = TargetedRewriter.apply({
      draft,
      violations: [violation("v1", "First weak sentence"), violation("v2", "Second weak sentence")],
      edits: [
        { violation_id: "v1", old_text: "First weak sentence", new_text: "First sentence" },
        { violation_id: "v2", old_text: "Second weak sentence", new_text: "Second sentence" },
      ],
      protectedSpans: [],
    })

    expect(result).toMatchObject({ pass: true, applied: true, text: "First sentence. Second sentence." })
  })

  test("rejects unknown violations and overlapping edits", () => {
    const draft = "A poor sentence."
    const unknown = TargetedRewriter.apply({
      draft,
      violations: [],
      edits: [{ violation_id: "missing", old_text: "poor", new_text: "clear" }],
      protectedSpans: [],
    })
    expect(unknown.pass).toBe(false)

    const overlap = TargetedRewriter.apply({
      draft,
      violations: [violation("v1", "poor"), violation("v2", "sentence")],
      edits: [
        { violation_id: "v1", old_text: "poor sentence", new_text: "clear sentence" },
        { violation_id: "v2", old_text: "sentence", new_text: "line" },
      ],
      protectedSpans: [],
    })
    expect(overlap.pass).toBe(false)
  })

  test("does not edit a protected path", () => {
    const draft = "See src/foo.ts:42."
    const result = TargetedRewriter.apply({
      draft,
      violations: [violation("v1", "src/foo.ts:42")],
      edits: [{ violation_id: "v1", old_text: "src/foo.ts:42", new_text: "src/bar.ts:43" }],
      protectedSpans: SpanProtector.protect({ text: draft }),
    })
    expect(result.pass).toBe(false)
    expect(result.text).toBe(draft)
  })

  test("does not apply an edit outside its violation span", () => {
    const result = TargetedRewriter.apply({
      draft: "The visible word repeats the word.",
      violations: [violation("v1", "visible")],
      edits: [{ violation_id: "v1", old_text: "word", new_text: "term" }],
      protectedSpans: [],
    })

    expect(result.pass).toBe(false)
    expect(result.text).toBe("The visible word repeats the word.")
  })
})
