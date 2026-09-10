import { describe, expect, test } from "bun:test"
import { ViolationReminder } from "../../src/ocx/violation-reminder"

const record = (ids: string[]) => JSON.stringify({ findings: ids.map((id) => ({ id })) })

describe("violation reminders", () => {
  test("ranks most-broken finding ids and maps them to rule lines", () => {
    const lines = [record(["C7-edit-before-read"]), record(["C7-edit-before-read", "C4-tests-not-green"])]
    expect(ViolationReminder.reminderLines(lines)).toEqual([
      "Read a file before editing it",
      "Run the test suite before claiming success",
    ])
  })

  test("caps at three reminders and drops unknown ids", () => {
    const lines = [
      record(["C14-added-comment", "C14-added-comment", "C14-added-comment", "unknown-id", "C6-open-todos"]),
    ]
    const out = ViolationReminder.reminderLines(lines)
    expect(out).toEqual([
      ...new Set(["No comments in code", "Close or update todos before finishing"]),
    ].slice(0, 2))
  })

  test("tolerates malformed lines and dedups mapped rules", () => {
    const lines = ["{broken json", record(["E13-comments-remain"]), "", record(["C20-import-cycle"])]
    const out = ViolationReminder.reminderLines(lines)
    expect(out).toHaveLength(2)
  })

  test("returns empty for no records", () => {
    expect(ViolationReminder.reminderLines([])).toEqual([])
  })

  test("maps new enforcement findings", () => {
    expect(
      ViolationReminder.reminderLines([
        record(["O1-output-header", "C29-plan-check-unknown", "C30-scope-reduced"]),
      ]),
    ).toEqual([
      "Start every reply with the required PHASE, DEPTH, and STATE line",
      "Name the exact check your plan expects",
      "Get user approval before narrowing a broad request",
    ])
  })
})
