import { describe, expect, test } from "bun:test"
import { Header as OCXHeader } from "../../src/ocx/header"

describe("session header", () => {
  test("keeps known strategies and reports unknown ones", () => {
    const header = OCXHeader.parseHeader({
      topic: "Fixing login redirect",
      strategies: ["web", "ui", "made-up"],
      risks: [],
    })
    expect(header.strategies).toEqual(["web", "ui"])
    expect(header.unknownStrategies).toEqual(["made-up"])
  })

  test("truncates topics past six words or 48 characters", () => {
    const byWords = OCXHeader.parseHeader({
      topic: "one two three four five six seven eight",
      strategies: [],
      risks: [],
    })
    expect(byWords.topic).toBe("one two three four five six")
    const byChars = OCXHeader.parseHeader({
      topic: "aaaaaaaaaa bbbbbbbbbb cccccccccc dddddddddd eeeeeeeeee ffffffff",
      strategies: [],
      risks: [],
    })
    expect(byChars.topic.endsWith("...")).toBe(true)
  })

  test("caps risks at three and drops junk lines", () => {
    const header = OCXHeader.parseHeader({
      topic: "t",
      strategies: [],
      risks: [
        "x",
        "unverified claims stated as fact",
        "  ",
        42,
        "second risk here",
        "third risk here",
        "fourth risk here",
      ],
    })
    expect(header.risks).toHaveLength(3)
    expect(header.risks.every((risk: string) => risk.length >= 8)).toBe(true)
  })

  test("rejects missing and generic topics before header admission", () => {
    const header = OCXHeader.parseHeader({ strategies: [], risks: [] }, { storedWorkflow: "debugging" })
    expect(header.topic).toBe("")
    expect(OCXHeader.isValidTopic(undefined)).toBe(false)
    for (const topic of ["Review task", "Read files", "Continue work", "Plan review"]) {
      expect(OCXHeader.isValidTopic(topic)).toBe(false)
    }
    for (const topic of ["No request provided", "Request not included", "Summary: Auth files", "Thought: Auth files"]) {
      expect(OCXHeader.isValidTopic(topic)).toBe(false)
    }
    expect(OCXHeader.isValidTopic("Fix login redirect")).toBe(true)
  })

  test("stage rows follow pipeline order and include workflow only when decided", () => {
    const withWorkflow = OCXHeader.stageRows(
      OCXHeader.parseHeader({ topic: "t", workflow: "debugging", phase: "reproduce", strategies: [], risks: [] }),
    )
    expect(withWorkflow).toEqual(["topic", "optimize", "thinking", "workflow", "guard"])
    const without = OCXHeader.stageRows(OCXHeader.parseHeader({ topic: "t", strategies: [], risks: [] }))
    expect(without).toEqual(["topic", "optimize", "thinking", "guard"])
  })

  test("normalizes workstreams and requires them for coding contracts", () => {
    const header = OCXHeader.parseHeader({
      topic: "Implement guard",
      workflow: "codegen",
      strategies: ["write"],
      risks: [],
      plan: [
        { do: "Read the target module", expect: "target is understood" },
        { do: "Run the focused test", expect: "test result is recorded" },
      ],
      workstreams: [{ id: "Guard Rules", goal: "Enforce mutation prerequisites" }],
    })
    expect(header.workstreams).toEqual([{ id: "guard-rules", goal: "Enforce mutation prerequisites" }])
    expect(OCXHeader.executionPlanGaps(header)).toEqual([])
    expect(OCXHeader.executionPlanGaps({ ...header, workstreams: [], plan: [header.plan[0]] })).toEqual([
      "at least two plan steps",
      "at least one workstream",
    ])
  })
})
