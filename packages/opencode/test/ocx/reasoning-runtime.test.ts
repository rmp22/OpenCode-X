import { describe, expect, test } from "bun:test"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import { Intent } from "../../src/ocx/reasoning/intent"
import { Resourcefulness } from "../../src/ocx/reasoning/resourcefulness"
import { Salience } from "../../src/ocx/reasoning/salience"
import { Stuck } from "../../src/ocx/reasoning/stuck"
import { LoopGuard } from "../../src/ocx/reasoning/loop-guard"

const message = (...parts: unknown[]) =>
  ({ info: { role: "assistant", id: "assistant" }, parts }) as unknown as SessionV1.WithParts

const user = (text: string) =>
  ({ info: { role: "user", id: "user" }, parts: [{ type: "text", text }] }) as unknown as SessionV1.WithParts

const command = (value: string, exit: number) =>
  ({ type: "tool", tool: "bash", state: { status: "completed", input: { command: value }, metadata: { exit } } }) as unknown as SessionV1.Part

const read = (filePath: string) =>
  ({ type: "tool", tool: "read", state: { status: "completed", input: { filePath } } }) as unknown as SessionV1.Part

const edit = (filePath: string) =>
  ({ type: "tool", tool: "edit", state: { status: "completed", input: { filePath } } }) as unknown as SessionV1.Part

describe("OCX reasoning runtime", () => {
  test("renders phase-specific salience without replaying the full prompt", () => {
    const text = Salience.render({ workflow: "codegen", phase: "verify", hasOpenTodos: true, hasFailure: true })
    expect(text).toContain("workflow: codegen; stage: verify.")
    expect(text).toContain("run the task-appropriate checks")
    expect(text).toContain("Open todos remain")
    expect(text).toContain("change the next action")
    expect(text.length).toBeLessThan(600)
  })

  test("detects an explicit prohibited code path", () => {
    const messages = [user("Implement the parser, but do not change src/generated.ts")] as never
    expect(Intent.check(messages, ["/repo/src/generated.ts"])).toContain("prohibited")
    expect(Intent.check(messages, ["/repo/src/parser.ts"])).toBeUndefined()
  })

  test("detects repeated failed commands and points to a higher-information action", () => {
    const messages = [message(command("bun test", 1)), message(command("bun test", 1)), message(command("bun test", 1))]
    const state = Stuck.inspect(messages as never)
    expect(state.detected).toBe(true)
    expect(Stuck.directive(messages as never)).toContain("Resourcefulness level 3")
  })

  test("detects repeated reads but does not flag one read", () => {
    expect(Stuck.inspect([message(read("/repo/src/a.ts"))] as never).detected).toBe(false)
    expect(Stuck.directive([message(read("/repo/src/a.ts")), message(read("/repo/src/a.ts"))] as never)).toContain(
      "same path was read repeatedly",
    )
  })

  test("detects equivalent edits after three repetitions", () => {
    const messages = [message(edit("/repo/src/a.ts")), message(edit("/repo/src/a.ts")), message(edit("/repo/src/a.ts"))]
    expect(Stuck.inspect(messages as never)).toMatchObject({ detected: true, attempts: 2 })
  })

  test("escalates the resourcefulness ladder and clamps at its final level", () => {
    expect(Resourcefulness.next(0).level).toBe(1)
    expect(Resourcefulness.next(2).action).toContain("known-good")
    expect(Resourcefulness.next(100).level).toBe(6)
  })

  test("flags consecutive successful downloads as a batch opportunity", () => {
    const messages = [
      message(command("curl -L -o assets/a.jpg https://example.com/a", 0)),
      message(command("curl -L -o assets/b.jpg https://example.com/b", 0)),
      message(command("curl -L -o assets/c.jpg https://example.com/c", 0)),
    ]
    expect(LoopGuard.inspect(messages as never)).toMatchObject({ detected: true, program: "curl", attempts: 3 })
    expect(LoopGuard.directive(messages as never)).toContain("BATCH OPPORTUNITY")
  })

  test("ignores short streaks, mixed tools, checks, and failures", () => {
    const short = [message(command("curl https://example.com/a", 0)), message(command("curl https://example.com/b", 0))]
    expect(LoopGuard.inspect(short as never).detected).toBe(false)
    const mixed = [message(command("curl https://example.com/a", 0)), message(command("ls assets", 0)), message(command("curl https://example.com/b", 0))]
    expect(LoopGuard.inspect(mixed as never).detected).toBe(false)
    const checks = [message(command("bun test", 0)), message(command("bun test", 0)), message(command("bun test", 0))]
    expect(LoopGuard.inspect(checks as never).detected).toBe(false)
    const failed = [message(command("curl https://example.com/a", 1)), message(command("curl https://example.com/b", 1)), message(command("curl https://example.com/c", 1))]
    expect(LoopGuard.inspect(failed as never).detected).toBe(false)
    expect(LoopGuard.directive(short as never)).toBeUndefined()
  })
})
