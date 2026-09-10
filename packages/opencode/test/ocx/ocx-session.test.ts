import { expect, test } from "bun:test"
import { OCXSession } from "../../src/ocx/ocx-session"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import { PlanWorkstreamState } from "../../src/ocx/plan-workstream-state"

const messages = (count: number): SessionV1.WithParts[] =>
  Array.from({ length: count }, (_, index) => ({
    info: {
      id: `msg-${index}`,
      role: index % 2 === 0 ? "user" : "assistant",
      time: { created: index },
      ...(index % 2 === 1 ? { finish: "stop" } : {}),
    },
    parts: [{ type: "text", text: `message ${index}` }],
  }) as unknown as SessionV1.WithParts)

test("ocx_session snapshot is bounded and preserves only current-session metadata", () => {
  const result = OCXSession.snapshot(messages(30), 50)

  expect(result).toHaveLength(20)
  expect(result[0]?.id).toBe("msg-10")
  expect(result.at(-1)?.parts[0]?.text).toBe("message 29")
})

test("ocx_session snapshot reports tool status without tool output", () => {
  const result = OCXSession.snapshot([
    {
      info: { id: "msg-1", role: "assistant", time: { created: 1 }, finish: "stop" },
      parts: [
        {
          type: "tool",
          tool: "read",
          callID: "call-1",
          state: {
            status: "completed",
            input: {},
            output: "secret output",
            title: "Read",
            metadata: {},
            time: { start: 1, end: 2 },
          },
        },
      ],
    } as unknown as SessionV1.WithParts,
  ])

  expect(result[0]?.parts[0]).toEqual({ type: "tool", tool: "read", status: "completed", outputLength: 13 })
})


test("ocx_session summary reports authoritative workflow phase", () => {
  const output = OCXSession.renderSummary({
    sessionID: "ses_phase_summary",
    messageCount: 34,
    fallbackWorkflow: "codegen",
    state: {
      workflow: "codegen",
      phase: "contract",
      phases: [
        { id: "context", goal: "inspect" },
        { id: "contract", goal: "record contract" },
        { id: "codegen", goal: "implement" },
      ],
      workstreams: [],
    } as never,
  })
  expect(output).toContain("task=coding")
  expect(output).toContain("workflow=codegen")
  expect(output).toContain("stage=plan:contract")
  expect(output).toContain("next=act:codegen")
  expect(output).toContain("purpose=record contract")
  expect(output).toContain("legal=ocx_plan,design")
  expect(output).toContain("action=Record a concrete plan")
})


test("ocx_session summary exposes the next ready step instead of activeStep none", () => {
  const plan = PlanWorkstreamState.parseExecutionPlan([
    "goal=Build landing",
    "workstream=assets",
    "  target=assets",
    "  step=Download local assets",
    "    target=assets",
    "    check=Files exist on disk",
  ].join("\n")).plan!
  const output = OCXSession.renderSummary({
    sessionID: "ses_ready_summary",
    messageCount: 8,
    state: {
      workflow: "codegen",
      phase: "codegen",
      phases: [{ id: "codegen", goal: "implement" }],
      plan,
      done: false,
    } as never,
  })
  expect(output).toContain("done=no")
  expect(output).toContain("ready_ws=assets")
  expect(output).toContain("ready_sp=download-local-assets")
  expect(output).toContain("ready_action=Download local assets")
})
