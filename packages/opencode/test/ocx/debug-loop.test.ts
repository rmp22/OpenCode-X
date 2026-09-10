import { describe, expect, test } from "bun:test"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import { DebugLoop } from "../../src/ocx/debug-loop"

const message = (...parts: unknown[]) =>
  ({ info: { role: "assistant", id: "assistant" }, parts }) as unknown as SessionV1.WithParts

const command = (command: string, exit: number | null = 0) =>
  ({ type: "tool", tool: "bash", state: { status: "completed", input: { command }, metadata: { exit } } }) as unknown as SessionV1.Part

const edit = (filePath: string) =>
  ({ type: "tool", tool: "edit", state: { status: "completed", input: { filePath } } }) as unknown as SessionV1.Part

const text = (value: string) => ({ type: "text", text: value }) as unknown as SessionV1.Part

describe("debugging evidence lock", () => {
  test("locks file mutation before the first failing run", () => {
    const messages = [message(edit("/repo/src/fix.ts"))]
    expect(DebugLoop.inspect(messages)).toMatchObject({ hasFailingRun: false, consecutiveRedRuns: 0 })
    expect(DebugLoop.lockedTools(messages)).toContain("edit")
    expect(DebugLoop.directive(messages)).toContain("failing command")
  })

  test("unlocks file mutation after a failing run", () => {
    const messages = [message(command("bun test", 1))]
    expect(DebugLoop.inspect(messages)).toMatchObject({ hasFailingRun: true, consecutiveRedRuns: 1 })
    expect(DebugLoop.lockedTools(messages)).toEqual([])
    expect(DebugLoop.directive(messages)).toBeUndefined()
  })

  test("requires a rubber-duck explanation after two consecutive failures", () => {
    const messages = [message(command("bun test", 1)), message(command("bun test", 1), edit("/repo/src/fix.ts"))]
    expect(DebugLoop.inspect(messages)).toMatchObject({ consecutiveRedRuns: 2, needsExplanation: true })
    expect(DebugLoop.lockedTools(messages)).toContain("write")
    expect(DebugLoop.directive(messages)).toContain("RUBBER-DUCK")
  })

  test("accepts an explanation after the latest failure", () => {
    const messages = [
      message(command("bun test", 1)),
      message(command("bun test", 1)),
      message(text("RUBBER-DUCK: changed hunk in src/fix.ts causes the observed failure because input is stale.")),
    ]
    expect(DebugLoop.inspect(messages)).toMatchObject({ consecutiveRedRuns: 2, needsExplanation: false })
    expect(DebugLoop.lockedTools(messages)).toEqual([])
  })

  test("a passing command ends the consecutive red streak", () => {
    const messages = [message(command("bun test", 1)), message(command("bun test", 0))]
    expect(DebugLoop.inspect(messages)).toMatchObject({ hasFailingRun: true, consecutiveRedRuns: 0 })
    expect(DebugLoop.lockedTools(messages)).toEqual([])
  })
})
