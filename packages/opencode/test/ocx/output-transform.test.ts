import { describe, expect, test } from "bun:test"
import { transformReply } from "../../src/ocx/output-transform"

describe("output transform", () => {
  test("unwraps fenced header and normalizes literal PHASE echo", () => {
    const broken = [
      "```html",
      "<PHASE>: CONTEXT: DEPTH:comprehensive STATE:needs_input",
      "",
      "Recording the session contract first.",
      "```",
    ].join("\n")
    const result = transformReply(broken)
    expect(result.changes).toContain("unfenced-and-normalized-header")
    expect(result.text.startsWith("PHASE: CONTEXT DEPTH:comprehensive STATE:needs_input")).toBe(true)
    expect(result.text).toContain("Recording the session contract first.")
  })

  test("strips trailing service endings repeatedly until stable", () => {
    const reply = "Done. Fixed the parser.\n\nHope this helps! Let me know if you would like me to explain more."
    const result = transformReply(reply)
    expect(result.text).toBe("Done. Fixed the parser.")
    expect(result.changes.filter((change) => change === "removed-service-ending").length).toBeGreaterThanOrEqual(1)
  })

  test("purges emoji glyphs from prose", () => {
    const reply = "Shipped the fix \u{1F680} all tests green \u{2728}"
    const result = transformReply(reply)
    expect(EmojiCheck.anyEmoji(result.text)).toBe(false)
    expect(result.changes).toContain("removed-2-emoji")
  })

  test("clamps standalone apologies to the first one", () => {
    const reply = "Sorry for the delay.\nFixed in config.ts.\nSorry again for the wait. I'm sorry this took long."
    const result = transformReply(reply)
    const count = (result.text.match(/sorry/gi) ?? []).length + (result.text.match(/I'?m sorry/gi) ?? []).length
    expect(count).toBeLessThanOrEqual(1)
    expect(result.changes).toContain("clamped-2-apologies")
  })

  test("collapses triple blank lines", () => {
    const result = transformReply("a\n\n\n\nb")
    expect(result.text).toBe("a\n\nb")
    expect(result.changes).toContain("collapsed-blank-lines")
  })

  test("idempotent on already-clean output", () => {
    const clean = "PHASE: research DEPTH:standard STATE:done\n\nRead the callers, then edited the helper."
    const once = transformReply(clean)
    expect(once.changes).toEqual([])
    const twice = transformReply(once.text)
    expect(twice.changes).toEqual([])
    expect(twice.text).toBe(clean)
  })
})

const EmojiCheck = { anyEmoji: (text: string) => /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(text) }
