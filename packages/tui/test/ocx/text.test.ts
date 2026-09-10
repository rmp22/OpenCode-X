import { describe, expect, test } from "bun:test"
import {
  auditLabel,
  cleanInputArgs,
  formatOcxTool,
  parseDeliveryHeader,
  strategyLabel,
  stripAttentionTags,
  stripPhaseMarkers,
} from "../../src/ocx/text"

describe("stripPhaseMarkers", () => {
  test("removes the canonical delivery header line", () => {
    const text = "PHASE: deliver DEPTH: comprehensive STATE: done\n\nVerified: all checks pass."
    expect(stripPhaseMarkers(text)).toBe("Verified: all checks pass.")
  })

  test("removes simple state marker line", () => {
    const text = "STATE: done\n\nSummary of work."
    expect(stripPhaseMarkers(text)).toBe("Summary of work.")
  })

  test("removes the answer-start phase marker line", () => {
    const text = "<PHASE>: explore DEPTH:standard STATE:done\n\nReading the code now."
    expect(stripPhaseMarkers(text)).toBe("Reading the code now.")
  })

  test("removes bolded phase marker variants", () => {
    const text = "**<PHASE>: plan**\n\nListing changes."
    expect(stripPhaseMarkers(text)).toBe("Listing changes.")
  })

  test("removes standalone phase transition announce lines", () => {
    expect(stripPhaseMarkers("phase: explore -> plan\ndoing work")).toBe("doing work")
    expect(stripPhaseMarkers("intro\nPhase: Explore -> Plan\noutro")).toBe("intro\noutro")
    expect(stripPhaseMarkers("**phase: plan -> implement**\nbody")).toBe("body")
  })

  test("keeps prose that only mentions phases", () => {
    const text = "The verify phase comes next.\nphase: explore is where we started\nSee docs for phase: x -> y details."
    expect(stripPhaseMarkers(text)).toBe(text)
  })

  test("keeps a lone phase label without a transition", () => {
    expect(stripPhaseMarkers("phase: explore")).toBe("phase: explore")
  })

  test("collapses blank runs left by removal", () => {
    const text = "<PHASE>: explore DEPTH:standard STATE:done\n\n\n\nFirst real line."
    expect(stripPhaseMarkers(text)).toBe("First real line.")
  })

  test("leaves text without markers untouched", () => {
    const text = "# Title\n\n- one\n- two\n"
    expect(stripPhaseMarkers(text)).toBe(text)
  })

  test("removes declarative attention control tags from display text", () => {
    const text = 'Surveying.\n<focus segments="tool:abc">\nChecking the value.\n</focus>\nDone.'
    expect(stripPhaseMarkers(text)).toBe("Surveying.\nChecking the value.\nDone.")
  })

  test("removes local and global tags while keeping extracted values", () => {
    expect(stripAttentionTags("<local>2 + 2 = 4</local>")).toBe("2 + 2 = 4")
    expect(stripAttentionTags('<focus magic_chunks="2">founded 2003</focus>')).toBe("founded 2003")
    expect(stripAttentionTags("Plan.\n<global>\nLocate.\n")).toBe("Plan.\nLocate.\n")
  })

  test("removes unclosed attention tags", () => {
    expect(stripAttentionTags('Looking closer.\n<focus segments="tool:abc">')).toBe("Looking closer.")
  })

  test("keeps answer tags and unrelated markup", () => {
    const text = "<answer>8 years</answer>\n\n<div>html</div>"
    expect(stripAttentionTags(text)).toBe(text)
  })
})

describe("tool labels", () => {
  test("formats strategy with the Thinking-style prefix", () => {
    expect(strategyLabel({ names: ["quality", "write"] })).toBe("Strategy: quality, write")
    expect(strategyLabel({})).toBe("Strategy")
  })

  test("formats audit with artifact and axes", () => {
    expect(auditLabel({ artifact: "src/index.ts", axes: ["content", "behavior"] })).toBe(
      "Audit: src/index.ts (content, behavior)",
    )
    expect(auditLabel({ artifact: "  " })).toBe("Audit")
  })

  test("formats cleanInputArgs without square brackets", () => {
    expect(cleanInputArgs({ offset: 1, limit: 50 })).toBe("(offset: 1 · limit: 50)")
    expect(cleanInputArgs({ filePath: "src/a.ts", limit: 10 }, ["filePath"])).toBe("(limit: 10)")
    expect(cleanInputArgs({})).toBe("")
  })

  test("formats ocx tools into presentable UI labels", () => {
    const plan = formatOcxTool("ocx_plan", {
      summary: "Refactor session state",
      steps: [{ content: "Step 1", status: "completed" }, { content: "Step 2", status: "in_progress" }],
    })
    expect(plan.title).toBe("Plan: Refactor session state")
    expect(plan.icon).toBe("≡")
    expect(plan.items).toEqual(["↳ ✓ Step 1", "↳ ⠋ Step 2"])

    const ctx = formatOcxTool("ocx_context", { operation: "explore", query: "auth token" })
    expect(ctx.title).toBe('Context: Explore "auth token"')
    expect(ctx.icon).toBe("◈")

    const codebase = formatOcxTool("ocx_codebase", { operation: "get_repository_profile" })
    expect(codebase.title).toBe("Codebase: Profile repository intelligence")
    expect(codebase.icon).toBe("⌘")

    const session = formatOcxTool("ocx_session", { view: "summary" })
    expect(session.title).toBe("Session: Inspect summary")
    expect(session.icon).toBe("◈")

    const custom = formatOcxTool("ocx_custom_tool", { arg: "val" })
    expect(custom.title).toBe("Custom tool: arg: val")
  })
})

describe("parseDeliveryHeader", () => {
  test("parses canonical delivery header", () => {
    const verdict = parseDeliveryHeader("PHASE: deliver DEPTH: comprehensive STATE: done\n\nVerified: tests pass.")
    expect(verdict).toEqual({
      phase: "deliver",
      depth: "comprehensive",
      state: "done",
    })
  })

  test("parses blocked and needs_input states", () => {
    expect(parseDeliveryHeader("PHASE: verify DEPTH: standard STATE: blocked")).toEqual({
      phase: "verify",
      depth: "standard",
      state: "blocked",
    })
    expect(parseDeliveryHeader("PHASE: intake DEPTH: concise STATE: needs_input")).toEqual({
      phase: "intake",
      depth: "concise",
      state: "needs_input",
    })
  })

  test("parses simple state header", () => {
    expect(parseDeliveryHeader("STATE: done\nFinished.")).toEqual({
      phase: "deliver",
      depth: "comprehensive",
      state: "done",
    })
  })

  test("returns undefined for regular text", () => {
    expect(parseDeliveryHeader("Just a regular response.")).toBeUndefined()
    expect(parseDeliveryHeader("PHASE is mentioned here but not header format")).toBeUndefined()
  })
})
