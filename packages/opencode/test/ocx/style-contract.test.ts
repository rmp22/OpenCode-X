import { describe, expect, test } from "bun:test"
import {
  decodeReviewResult,
  decodeRewriteResult,
  parseReviewResult,
  parseRewriteResult,
} from "../../src/ocx/antislop/style-contract"

const violation = {
  id: "v1",
  category: "plain_language",
  severity: "soft",
  span: "marks the active workflow",
  reason: "Indirect wording.",
  replacement_hint: "Find the workflow under the marker.",
} as const

describe("style contracts", () => {
  test("decodes a valid semantic review result", () => {
    expect(parseReviewResult(JSON.stringify({ pass: false, violations: [violation] }))).toEqual({
      pass: false,
      violations: [violation],
    })
  })

  test("rejects unknown categories and extra fields", () => {
    expect(decodeReviewResult({ pass: false, violations: [{ ...violation, category: "formal" }] })).toBeUndefined()
    expect(decodeReviewResult({ pass: true, violations: [], extra: true })).toBeUndefined()
  })

  test("decodes edit-only rewrite results", () => {
    expect(
      parseRewriteResult(
        JSON.stringify({
          edits: [{ violation_id: "v1", old_text: "marks the active workflow", new_text: "shows the workflow" }],
        }),
      ),
    ).toEqual({
      edits: [{ violation_id: "v1", old_text: "marks the active workflow", new_text: "shows the workflow" }],
    })
    expect(decodeRewriteResult({ edits: [{ violation_id: "v1", old_text: "x" }] })).toBeUndefined()
  })

  test("rejects malformed JSON", () => {
    expect(parseReviewResult("not json")).toBeUndefined()
    expect(parseRewriteResult('{"edits":')).toBeUndefined()
  })
})
