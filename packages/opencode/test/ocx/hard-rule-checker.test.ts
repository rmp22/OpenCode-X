import { describe, expect, test } from "bun:test"
import { HardRuleChecker } from "../../src/ocx/antislop/hard-rule-checker"
import { SpanProtector } from "../../src/ocx/antislop/span-protector"

describe("hard style rules", () => {
  test("checks the required output header directly", () => {
    expect(HardRuleChecker.check({ draft: "Done.", strictOutput: true }).violations[0]?.ruleId).toBe("output.header")
    expect(
      HardRuleChecker.check({ draft: "PHASE: report DEPTH: concise STATE: done\nDone.", strictOutput: true }).pass,
    ).toBe(true)
  })

  test("blocks added explanatory documentation tags", () => {
    const result = HardRuleChecker.check({
      added: new Map([["src/foo.ts", ["/** @remarks This explains the code. */"]]]),
    })
    expect(result.violations.map((violation) => violation.ruleId)).toEqual(["comments.no_explanatory_doc_tag"])
    expect(
      HardRuleChecker.check({
        added: new Map([["src/foo.ts", ["/** @hide */", "// Copyright 2026 Example", "// eslint-disable-next-line"]]]),
      }).pass,
    ).toBe(true)
  })

  test("allows requested comments", () => {
    expect(
      HardRuleChecker.check({
        commentsRequested: true,
        added: new Map([["src/foo.ts", ["/** @remarks requested */"]]]),
      }).pass,
    ).toBe(true)
  })

  test("checks protected spans and structured contracts", () => {
    const before = "Use src/foo.ts:42."
    const spans = SpanProtector.protect({ text: before })
    const protectedResult = HardRuleChecker.check({
      protectedBefore: before,
      protectedAfter: "Use src/foo.ts:43.",
      protectedSpans: spans,
    })
    expect(protectedResult.violations.map((violation) => violation.ruleId)).toContain("protected_text.changed")
    expect(HardRuleChecker.check({ reviewJson: "{}" }).violations[0]?.ruleId).toBe("review.schema")
    expect(HardRuleChecker.check({ rewriteJson: '{"edits": [{"violation_id": "v1"}]}' }).pass).toBe(false)
  })
})
