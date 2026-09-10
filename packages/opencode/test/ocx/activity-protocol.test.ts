import { describe, expect, test, beforeEach } from "bun:test"
import { Effect, Schema } from "effect"
import type { EventV2 } from "@opencode-ai/core/event"
import { OCXActivityEvent } from "@opencode-ai/schema/ocx-activity-event"
import { ActivityRuntime } from "../../src/ocx/activity/runtime"
import { ProviderReasoning } from "../../src/ocx/reasoning/provider"

type TestPublisher = Pick<EventV2.Interface, "publish"> & { published: { data: unknown }[] }

beforeEach(() => ActivityRuntime.clearAll())

function publisher() {
  const published: { data: unknown }[] = []
  const events = {
    published,
    publish: (_definition: unknown, data: unknown) => {
      published.push({ data })
      return Effect.succeed(data)
    },
  } as unknown as TestPublisher
  return events
}

describe("exact provider reasoning segments", () => {
  test("uses the current paragraph or line without rewriting or slicing", () => {
    expect(ProviderReasoning.latestReasoningSegment("paragraph A\n\nparagraph B\n\nparagraph C")).toBe("paragraph C")
    expect(ProviderReasoning.latestReasoningSegment("- check the complete current line")).toBe("check the complete current line")
    const exact = "This reasoning segment is longer than eighty characters and must remain complete for inspection."
    expect(ProviderReasoning.latestReasoningSegment(exact)).toBe(exact)
  })

  test("returns undefined for empty reasoning", () => {
    expect(ProviderReasoning.latestReasoningSegment("\n\n")).toBeUndefined()
  })
})

describe("canonical activity projection", () => {

  test("classifies remote evidence gathering as research", () => {
    expect(ActivityRuntime.kindForTool("websearch")).toBe("research")
    expect(ActivityRuntime.kindForTool("webfetch")).toBe("research")
    expect(ActivityRuntime.kindForTool("read")).toBe("exploring")
  })
  test("publishes typed active and none projections with increasing sequence", async () => {
    const events = publisher()
    const lease = ActivityRuntime.createLease({
      sessionID: "ses_activity",
      ownerType: "assistant",
      ownerID: "assistant",
      kind: "thinking",
      title: "Thinking",
      detail: "exact current reasoning",
    })
    await Effect.runPromise(ActivityRuntime.publishPrimary("ses_activity", events))
    ActivityRuntime.completeLease("ses_activity", lease.id)
    await Effect.runPromise(ActivityRuntime.publishPrimary("ses_activity", events))

    const active = Schema.decodeUnknownSync(OCXActivityEvent.Projection)(events.published[0]!.data)
    const none = Schema.decodeUnknownSync(OCXActivityEvent.Projection)(events.published[1]!.data)
    expect(active).toMatchObject({ seq: 1, activityID: lease.id, kind: "thinking", state: "active", detail: "exact current reasoning" })
    expect(none).toMatchObject({ seq: 2, activityID: lease.id, state: "none" })
  })

  test("keeps exact details longer than the old activity cap", () => {
    const detail = "reasoning ".repeat(80)
    const lease = ActivityRuntime.createLease({
      sessionID: "ses_detail",
      ownerType: "assistant",
      ownerID: "assistant",
      kind: "thinking",
      title: "Thinking",
      detail,
    })
    expect(lease.detail).toBe(detail)
    ActivityRuntime.updatePrimaryDetail("ses_detail", detail + "next")
    expect(ActivityRuntime.selectPrimary("ses_detail")?.detail).toBe(detail + "next")
  })

  test("does not publish a none event before a primary exists", async () => {
    const events = publisher()
    await Effect.runPromise(ActivityRuntime.publishPrimary("ses_empty", events))
    expect(events.published).toEqual([])
  })

  test("publishes stage completion before the resulting primary projection", async () => {
    const events = publisher()
    await Effect.runPromise(ActivityRuntime.publishStage({ sessionID: "ses_stage", stage: "thinking", active: true, summary: "Planning" }, events))
    await Effect.runPromise(ActivityRuntime.publishStage({ sessionID: "ses_stage", stage: "thinking", active: false }, events))

    expect(events.published.map((item) => (item.data as { state?: string }).state)).toEqual(["active", "completed", "none"])
  })
})
