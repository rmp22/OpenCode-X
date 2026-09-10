import { describe, expect, test } from "bun:test"
import type { Tool as AITool } from "ai"
import { PromptTools } from "../../src/ocx/prompt-tools"
import { SessionID } from "../../src/session/schema"

const base = {
  sessionID: SessionID.make("ses_prompt"),
  messages: [],
  practicesEnabled: false,
  turnDone: false,
  workdir: "/tmp",
}

describe("OCX prompt tools", () => {
  test("always installs the playbook and gates pipeline tools", () => {
    const baseline: Record<string, AITool> = {}
    PromptTools.install({ ...base, tools: baseline, pipelineEnabled: false })
    expect(Object.keys(baseline)).toEqual(["ocx_playbook"])

    const pipeline: Record<string, AITool> = {}
    PromptTools.install({ ...base, tools: pipeline, pipelineEnabled: true })
    expect(Object.keys(pipeline)).toEqual(["ocx_session"])
  })

  test("does not add progress after the turn is complete", () => {
    const tools: Record<string, AITool> = {}
    PromptTools.install({ ...base, tools, pipelineEnabled: true, turnDone: true })
    expect(Object.keys(tools)).toEqual(["ocx_session"])
  })
  test("keeps ocx_plan installed after plan acceptance so bounded replans remain possible", () => {
    const tools: Record<string, AITool> = {}
    const messages = [
      {
        info: { id: "assistant-header", role: "assistant", time: { created: 1 }, finish: "tool-calls" },
        parts: [
          {
            type: "tool",
            tool: "ocx_header",
            callID: "header-call",
            state: { status: "completed", input: {}, output: "OK", title: "header", metadata: { valid: true }, time: { start: 1, end: 2 } },
          },
        ],
      },
    ] as never
    const store = {
      get: () => ({
        workflow: "codegen",
        phase: "contract",
        phases: [{ id: "contract", goal: "record contract" }],
        plan: { revision: 1 },
      }),
    } as never
    PromptTools.install({ ...base, tools, messages, pipelineEnabled: true, store })
    expect(Object.keys(tools)).toContain("ocx_plan")
    expect(Object.keys(tools)).not.toContain("ocx_progress")
  })

  test("does not expose manual practice lookup in pipeline mode", () => {
    const tools: Record<string, AITool> = {}
    PromptTools.install({ ...base, tools, pipelineEnabled: true, practicesEnabled: true })
    expect(Object.keys(tools)).not.toContain("ocx_practice")
  })

})
