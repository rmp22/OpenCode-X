import { describe, expect, test } from "bun:test"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import { FailureSignal } from "../../src/ocx/reasoning/failure-signal"

const assistant = (...parts: unknown[]) =>
  ({ info: { role: "assistant", id: "assistant" }, parts }) as unknown as SessionV1.WithParts

const tool = (name: string, state: Record<string, unknown>) => ({ type: "tool", tool: name, state })

describe("OCX reasoning failure signal", () => {
  test("treats policy tool errors as recovery failures", () => {
    const messages = [assistant(tool("read", { status: "error", error: "SCOPE_BLOCKED operation=read" }))]
    expect(FailureSignal.inspect(messages)).toMatchObject({
      hasFailure: true,
      code: "SCOPE_BLOCKED",
      tool: "read",
      retrySameSemanticAction: false,
    })
  })

  test("treats plan scope errors as non-retriable semantic operations", () => {
    const messages = [assistant(tool("bash", { status: "error", error: "PLAN_SCOPE_BLOCKED target=/repo/assets" }))]
    expect(FailureSignal.inspect(messages)).toMatchObject({ hasFailure: true, code: "PLAN_SCOPE_BLOCKED", retrySameSemanticAction: false })
  })

  test("treats a busy owner as a queued wait condition rather than a retry loop", () => {
    const messages = [assistant(tool("task", { status: "error", error: "OWNER_BUSY owner=owner-1 task=task-1" }))]
    const signal = FailureSignal.inspect(messages)
    expect(signal).toMatchObject({ hasFailure: true, code: "OWNER_BUSY", retrySameSemanticAction: false })
    expect(FailureSignal.render(signal)).toContain("task is queued")
  })

  test("a later successful tool action clears recovery mode", () => {
    const messages = [
      assistant(tool("read", { status: "error", error: "SCOPE_BLOCKED operation=read" })),
      assistant(tool("glob", { status: "completed", output: "src/index.ts" })),
    ]
    expect(FailureSignal.inspect(messages).hasFailure).toBe(false)
  })

  test("detects failed shell exits without requiring DebugLoop", () => {
    const messages = [assistant(tool("bash", { status: "completed", metadata: { exit: 1, stderr: "test failed" } }))]
    expect(FailureSignal.inspect(messages)).toMatchObject({ hasFailure: true, tool: "bash", retrySameSemanticAction: true })
  })
})
