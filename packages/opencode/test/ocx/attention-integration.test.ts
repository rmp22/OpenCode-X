import { describe, expect, test } from "bun:test"
import {
  AttentionPromptProtocol,
  AttentionStateMachine,
  ContextSegmenter,
} from "../../src/ocx/attention"
import { toModelMessages } from "../../src/session/message-v2"

describe("OCX Model Attention Integration & Reversible Tool Virtualization", () => {
  const segmenter = new ContextSegmenter({ targetChunkSize: 2048, blockSize: 16 })

  const fakeModel = {
    id: "test-model",
    name: "Test Model",
    provider: "test",
    capabilities: {},
  } as any

  const sampleToolOutput1 = "Line 1: function authenticate() {}\nLine 2: return true;"
  const sampleToolOutput2 = "FAIL: 1 test failed in auth.test.ts\nAssertionError: expected true to be false"

  const mockMessages: any[] = [
    {
      info: { id: "u1", role: "user" },
      parts: [{ type: "text", text: "Fix authentication test" }],
    },
    {
      info: { id: "a1", role: "assistant" },
      parts: [
        {
          id: "p1",
          type: "tool",
          tool: "read",
          callID: "call-read-1",
          state: {
            status: "completed",
            input: { filePath: "src/auth.ts" },
            output: sampleToolOutput1,
            time: { start: 1, end: 2 },
          },
        },
        {
          id: "p2",
          type: "tool",
          tool: "bash",
          callID: "call-bash-2",
          state: {
            status: "completed",
            input: { command: "bun test" },
            output: sampleToolOutput2,
            time: { start: 3, end: 4 },
          },
        },
      ],
    },
    {
      info: { id: "u2", role: "user" },
      parts: [{ type: "text", text: "Proceed with the fix" }],
    },
  ]

  test("toModelMessages renders full tool outputs in global mode", async () => {
    const seg1 = segmenter.fromToolResult("read", "call-read-1", sampleToolOutput1)[0]
    const seg2 = segmenter.fromToolResult("bash", "call-bash-2", sampleToolOutput2)[0]

    const scaffold = AttentionPromptProtocol.createScaffold({
      systemInstruction: "You are OpenCoder-X.",
      userQuery: "Proceed with the fix",
    })

    const stateMachine = new AttentionStateMachine(scaffold, [seg1, seg2])
    const globalMask = stateMachine.computeMask()

    const modelMsgs = await toModelMessages(mockMessages, fakeModel, {
      attentionMask: globalMask,
    })

    const serialized = JSON.stringify(modelMsgs)
    expect(serialized).toContain("function authenticate()")
    expect(serialized).toContain("FAIL: 1 test failed in auth.test.ts")
    expect(serialized).not.toContain("[STOWED TOOL RESULT:")
  })

  test("toModelMessages virtualizes unreferenced tool outputs in focus mode", async () => {
    const seg1 = segmenter.fromToolResult("read", "call-read-1", sampleToolOutput1)[0]
    const seg2 = segmenter.fromToolResult("bash", "call-bash-2", sampleToolOutput2)[0]

    const scaffold = AttentionPromptProtocol.createScaffold({
      systemInstruction: "You are OpenCoder-X.",
      userQuery: "Proceed with the fix",
    })

    const stateMachine = new AttentionStateMachine(scaffold, [seg1, seg2])
    const focusMask = stateMachine.transition("focus", ["tool:call-read-1"])

    const modelMsgs = await toModelMessages(mockMessages, fakeModel, {
      attentionMask: focusMask,
    })

    const serialized = JSON.stringify(modelMsgs)
    expect(serialized).toContain("function authenticate()")
    expect(serialized).not.toContain("FAIL: 1 test failed in auth.test.ts")
    expect(serialized).toContain('STOWED TOOL RESULT: id=\\"tool:call-bash-2\\"')
  })

  test("toModelMessages virtualizes all tool results in local synthesis mode", async () => {
    const seg1 = segmenter.fromToolResult("read", "call-read-1", sampleToolOutput1)[0]
    const seg2 = segmenter.fromToolResult("bash", "call-bash-2", sampleToolOutput2)[0]

    const scaffold = AttentionPromptProtocol.createScaffold({
      systemInstruction: "You are OpenCoder-X.",
      userQuery: "Synthesize answer",
    })

    const stateMachine = new AttentionStateMachine(scaffold, [seg1, seg2])
    const localMask = stateMachine.transition("local", [])

    const modelMsgs = await toModelMessages(mockMessages, fakeModel, {
      attentionMask: localMask,
    })

    const serialized = JSON.stringify(modelMsgs)
    expect(serialized).not.toContain("function authenticate()")
    expect(serialized).not.toContain("FAIL: 1 test failed in auth.test.ts")
    expect(serialized).toContain('STOWED TOOL RESULT: id=\\"tool:call-read-1\\"')
    expect(serialized).toContain('STOWED TOOL RESULT: id=\\"tool:call-bash-2\\"')
  })

  test("virtualization is fully reversible without data loss", async () => {
    const seg1 = segmenter.fromToolResult("read", "call-read-1", sampleToolOutput1)[0]
    const seg2 = segmenter.fromToolResult("bash", "call-bash-2", sampleToolOutput2)[0]

    const scaffold = AttentionPromptProtocol.createScaffold({
      systemInstruction: "You are OpenCoder-X.",
      userQuery: "Check",
    })

    const stateMachine = new AttentionStateMachine(scaffold, [seg1, seg2])

    stateMachine.transition("focus", ["tool:call-read-1"])
    let msgs = await toModelMessages(mockMessages, fakeModel, {
      attentionMask: stateMachine.computeMask(),
    })
    expect(JSON.stringify(msgs)).toContain('STOWED TOOL RESULT: id=\\"tool:call-bash-2\\"')

    stateMachine.transition("focus", ["tool:call-bash-2"])
    msgs = await toModelMessages(mockMessages, fakeModel, {
      attentionMask: stateMachine.computeMask(),
    })
    expect(JSON.stringify(msgs)).toContain("FAIL: 1 test failed in auth.test.ts")
    expect(JSON.stringify(msgs)).toContain('STOWED TOOL RESULT: id=\\"tool:call-read-1\\"')

    stateMachine.transition("global", [])
    msgs = await toModelMessages(mockMessages, fakeModel, {
      attentionMask: stateMachine.computeMask(),
    })
    expect(JSON.stringify(msgs)).toContain("function authenticate()")
    expect(JSON.stringify(msgs)).toContain("FAIL: 1 test failed in auth.test.ts")
  })
})
