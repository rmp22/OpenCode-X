import { describe, expect, test } from "bun:test"
import {
  appendActivityEntry,
  groupByMessage,
  workflowLogEntries,
  type OcxLogEntry,
} from "../../src/ocx/ocx-log"

describe("ocx log entries", () => {
  test("emits workflow and phase on the first update", () => {
    let seq = 0
    const entries = workflowLogEntries(undefined, { workflow: "feature", phase: "explore" }, () => ++seq, 100)
    expect(entries).toEqual([
      { seq: 1, kind: "workflow", value: "feature", time: 100, summary: "selected for this request" },
      { seq: 2, kind: "phase", value: "explore", time: 100, summary: "starting feature phase at explore" },
    ])
  })

  test("emits nothing when the state repeats", () => {
    const previous = { workflow: "feature", phase: "explore" }
    expect(workflowLogEntries(previous, { ...previous }, () => 1, 100)).toEqual([])
  })

  test("emits only the phase on an advance", () => {
    let seq = 5
    const entries = workflowLogEntries(
      { workflow: "feature", phase: "explore" },
      { workflow: "feature", phase: "plan" },
      () => ++seq,
      200,
    )
    expect(entries).toEqual([
      { seq: 6, kind: "phase", value: "plan", time: 200, summary: "advancing feature phase to plan" },
    ])
  })

  test("emits only the workflow when the name changes", () => {
    const entries = workflowLogEntries(
      { workflow: "feature", phase: "plan" },
      { workflow: "debugging", phase: "plan" },
      () => 7,
      300,
    )
    expect(entries).toEqual([
      { seq: 7, kind: "workflow", value: "debugging", time: 300, summary: "switched from feature" },
    ])
  })

  test("describes a phase that moves with a workflow switch", () => {
    const entries = workflowLogEntries(
      { workflow: "feature", phase: "explore" },
      { workflow: "debugging", phase: "reproduce" },
      () => 9,
      400,
    )
    expect(entries.map((entry) => entry.kind)).toEqual(["workflow", "phase"])
    expect(entries[1].summary).toBe("moving to debugging phase at reproduce")
  })

  test("deduplicates terminal activity history", () => {
    const activity: OcxLogEntry = {
      seq: 1,
      kind: "activity",
      value: "Focused tests",
      time: 100,
      state: "completed",
      activityID: "act-1",
    }
    const once = appendActivityEntry([], activity)
    expect(appendActivityEntry(once, activity)).toEqual(once)
  })

  test("groups entries under the message they follow", () => {
    const messages = [
      { id: "msg_1", time: { created: 100 } },
      { id: "msg_2", time: { created: 300 } },
    ]
    const entries = [
      { seq: 1, kind: "activity" as const, value: "optimize", time: 150, state: "completed" as const },
      { seq: 2, kind: "activity" as const, value: "workflow", time: 200, state: "completed" as const },
      { seq: 3, kind: "activity" as const, value: "reasoning", time: 350, state: "completed" as const },
    ]
    const { groups, leading } = groupByMessage(messages, entries)
    expect([...groups.keys()]).toEqual(["msg_1", "msg_2"])
    expect(groups.get("msg_1")?.map((entry) => entry.value)).toEqual(["optimize", "workflow"])
    expect(groups.get("msg_2")?.map((entry) => entry.value)).toEqual(["reasoning"])
    expect(leading).toEqual([])
  })

  test("keeps entries before the first message leading", () => {
    const { groups, leading } = groupByMessage(
      [{ id: "msg_1", time: { created: 500 } }],
      [
        { seq: 1, kind: "activity", value: "topic", time: 100, state: "completed" },
        { seq: 2, kind: "activity", value: "optimize", time: 600, state: "completed" },
      ],
    )
    expect(leading.map((entry) => entry.value)).toEqual(["topic"])
    expect(groups.get("msg_1")?.map((entry) => entry.value)).toEqual(["optimize"])
  })

  test("treats an entry at a message timestamp as following it", () => {
    const { groups, leading } = groupByMessage(
      [{ id: "msg_1", time: { created: 100 } }],
      [{ seq: 1, kind: "activity", value: "optimize", time: 100, state: "completed" }],
    )
    expect(groups.get("msg_1")?.length).toBe(1)
    expect(leading).toEqual([])
  })
})
