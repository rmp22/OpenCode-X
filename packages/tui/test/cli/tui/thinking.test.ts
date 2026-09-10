import { describe, expect, test } from "bun:test"
import { isRawThinking, reasoningSummary, reasoningTitle, thinkingTopic } from "../../../src/context/thinking"

describe("reasoningSummary", () => {
  test("extracts a leading summary title and leaves markdown body", () => {
    expect(reasoningSummary("**Continuing Quality Review**\n\nDetails.\n\n**Next section**\n\nMore.")).toEqual({
      title: "Continuing Quality Review",
      body: "Details.\n\n**Next section**\n\nMore.",
    })
  })

  test("extracts a completed title before its streamed body arrives", () => {
    expect(reasoningSummary("**Continuing Quality Review**")).toEqual({
      title: "Continuing Quality Review",
      body: "",
    })
  })

  test("extracts a title when the streamed body starts on the next line", () => {
    expect(reasoningSummary("**Continuing Quality Review**\n- Details.")).toEqual({
      title: "Continuing Quality Review",
      body: "- Details.",
    })
  })

  test("preserves markdown-significant indentation in the extracted body", () => {
    expect(reasoningSummary("**Continuing Quality Review**\n\n    const value = true\n")).toEqual({
      title: "Continuing Quality Review",
      body: "    const value = true",
    })
  })

  test("does not consume ordinary leading bold content", () => {
    expect(reasoningSummary("**Important:** keep this in the body.")).toEqual({
      title: null,
      body: "**Important:** keep this in the body.",
    })
  })

  test("leaves content without a leading title in its body", () => {
    expect(reasoningSummary("Details only.")).toEqual({ title: null, body: "Details only." })
  })

  test("rejects the polish prompt's literal placeholder words as titles", () => {
    expect(reasoningSummary("**Title**\n\n- VERIFIED point")).toEqual({ title: null, body: "- VERIFIED point" })
    expect(reasoningSummary("**Thought**")).toEqual({ title: null, body: "" })
    expect(reasoningSummary("**Thinking**\n\ndetails")).toEqual({ title: null, body: "details" })
    expect(reasoningSummary("**Summary**\n\nbody")).toEqual({ title: null, body: "body" })
  })

  test("rejects titles about unavailable request context", () => {
    for (const topic of ["Missing Request Context", "No request provided", "Request not included", "Thought: Auth files"]) {
      expect(reasoningSummary(`**${topic}**\n\n- inspect files`)).toEqual({
        title: null,
        body: "- inspect files",
      })
    }
  })

  test("rejects generic task labels", () => {
    for (const topic of ["Review task", "Read files", "Continue work", "Plan review"]) {
      expect(reasoningSummary(`**${topic}**\n\nbody`)).toEqual({ title: null, body: "body" })
      expect(thinkingTopic({ ocx: { topic } })).toBe(null)
    }
    expect(reasoningSummary("**Draft**\n\nbody")).toEqual({ title: null, body: "body" })
  })

  test("keeps real titles that merely contain placeholder words", () => {
    expect(reasoningSummary("**Title page review**\n\nbody")).toEqual({
      title: "Title page review",
      body: "body",
    })
  })
})

describe("isRawThinking", () => {
  test("flags parts the server marked as unpolished reasoning", () => {
    expect(isRawThinking({ ocx: { rawThinking: true } })).toBe(true)
  })

  test("ignores parts without the raw flag", () => {
    expect(isRawThinking({ ocx: { rawThinking: false } })).toBe(false)
    expect(isRawThinking({ anthropic: { signature: "sig" } })).toBe(false)
    expect(isRawThinking(undefined)).toBe(false)
  })
})

describe("thinkingTopic", () => {
  test("reads the topic the pipeline stamped on the part", () => {
    expect(thinkingTopic({ ocx: { topic: "Reading auth.ts" } })).toBe("Reading auth.ts")
  })

  test("ignores missing, empty, and non-string topics", () => {
    expect(thinkingTopic(undefined)).toBe(null)
    expect(thinkingTopic({})).toBe(null)
    expect(thinkingTopic({ ocx: {} })).toBe(null)
    expect(thinkingTopic({ ocx: { topic: "   " } })).toBe(null)
    expect(thinkingTopic({ ocx: { topic: 42 } })).toBe(null)
    expect(thinkingTopic({ ocx: { topic: "Working" } })).toBe(null)
  })

  test("ignores unavailable request context topics", () => {
    for (const topic of [
      "Missing Request Context",
      "Unavailable Request Handling",
      "Request Availability",
      "Unavailable Request Review",
      "No request provided",
      "Request not included",
      "Thought: Auth files",
    ]) {
      expect(thinkingTopic({ ocx: { topic } })).toBe(null)
    }
  })
})

describe("reasoningTitle", () => {
  test("keeps the admitted topic ahead of streamed reasoning content", () => {
    expect(reasoningTitle("**Raw thought title**\n\nbody", { ocx: { topic: "Search auth files" } })).toBe(
      "Search auth files",
    )
  })

  test("uses a provider summary title when no topic was admitted", () => {
    expect(reasoningTitle("**Provider summary**\n\nbody", undefined)).toBe("Provider summary")
  })
})
