import { describe, expect, test } from "bun:test"
import {
  AttentionPromptProtocol,
  AttentionStateMachine,
  ContextSegmenter,
} from "../../src/ocx/attention"
import { AttentionCoordinator } from "../../src/ocx/attention/coordinator"
import { toModelMessages } from "../../src/session/message-v2"

describe("OCX Attention fail-open edge cases", () => {
  const segmenter = new ContextSegmenter({ targetChunkSize: 2048, blockSize: 16 })
  const scaffold = AttentionPromptProtocol.createScaffold({
    systemInstruction: "You are OpenCoder-X.",
    userQuery: "Fix the thing",
  })

  function twoSegments() {
    const seg1 = segmenter.fromToolResult("read", "call-read-1", "export function auth() {}")[0]
    const seg2 = segmenter.fromToolResult("bash", "call-bash-2", "Tests failed: 1 failure")[0]
    return [seg1, seg2] as const
  }

  test("focus on unknown segment ids falls back to global instead of stowing everything", () => {
    const [seg1, seg2] = twoSegments()
    const sm = new AttentionStateMachine(scaffold, [seg1, seg2])
    const mask = sm.transition("focus", ["tool:nope-missing", "tool:also-missing"])
    expect(mask.mode).toBe("global")
    expect(mask.attendedSegments.length).toBe(2)
    expect(mask.maskedSegments.length).toBe(0)
  })

  test("focus with out-of-range numeric reference falls back to global", () => {
    const [seg1, seg2] = twoSegments()
    const sm = new AttentionStateMachine(scaffold, [seg1, seg2])
    const mask = sm.transition("focus", ["999"])
    expect(mask.mode).toBe("global")
    expect(mask.attendedSegments.length).toBe(2)
  })

  test("focus on a parent id still resolves to split parts", () => {
    const longContent = "line of code with enough characters to fill tokens\n".repeat(700)
    const parts = segmenter.createSegment({
      id: "tool:big-read",
      name: "big.ts",
      kind: "file_content",
      content: longContent,
    })
    expect(parts.length).toBeGreaterThan(1)
    const sm = new AttentionStateMachine(scaffold, parts)
    const mask = sm.transition("focus", ["tool:big-read"])
    expect(mask.mode).toBe("focus")
    expect(mask.attendedSegments.length).toBe(parts.length)
  })

  test("unclosed focus tags are parsed as declarations", () => {
    const sm = new AttentionStateMachine(scaffold, [])
    const decls = sm.parseAllDeclarations(
      "Let me look closer.\n<focus segments=\"tool:call-read-1\">\n",
    )
    expect(decls.length).toBe(1)
    expect(decls[0].mode).toBe("focus")
    expect(decls[0].targetSegmentIds).toEqual(["tool:call-read-1"])
  })

  test("a <global> opener produces no transition in the streaming parser", () => {
    const [seg1, seg2] = twoSegments()
    const sm = new AttentionStateMachine(scaffold, [seg1, seg2])
    sm.transition("focus", [seg1.id])
    expect(sm.getMode()).toBe("focus")
    const step = sm.processChunk("Still reasoning. <global> surveying everything again.")
    expect(step.changed).toBe(false)
    expect(sm.getMode()).toBe("focus")
    expect(step.mask.attendedSegments.length).toBe(1)
  })

  test("segment edges never fall inside a word", () => {
    const localSegmenter = new ContextSegmenter({ targetChunkSize: 64, blockSize: 16 })
    const content = Array.from({ length: 60 }, (_, i) => `token${i}`).join(" ")
    const parts = localSegmenter.createSegment({
      id: "words",
      name: "words.txt",
      kind: "file_content",
      content,
    })
    expect(parts.length).toBeGreaterThan(1)
    for (const part of parts) {
      const words = part.content.split(/\s+/).filter((w) => w.length > 0)
      expect(words.length).toBeGreaterThan(0)
      for (const word of words) {
        expect(word).toMatch(/^token\d+$/)
      }
    }
    const rejoined = parts.map((p) => p.content).join("")
    for (let i = 0; i < 60; i++) {
      expect(rejoined).toContain(`token${i}`)
    }
    expect(rejoined).toBe(content)
  })

  test("segmentation prefers sentence and clause boundaries", () => {
    const localSegmenter = new ContextSegmenter({ targetChunkSize: 24, blockSize: 16 })
    const content =
      "First sentence states the founding year. Second sentence gives the IPO year; third clause adds the venue, final clause names the exchange."
    const parts = localSegmenter.createSegment({
      id: "sentences",
      name: "doc.txt",
      kind: "file_content",
      content,
    })
    expect(parts.length).toBeGreaterThan(1)
    for (const part of parts) {
      expect(part.blockAlignedTokenCount % 16).toBe(0)
    }
  })

  test("scaffold directive carries the three declarative-attention requirements", () => {
    const built = AttentionPromptProtocol.createScaffold({
      systemInstruction: "System",
      userQuery: "Query",
    })
    expect(built.protocolDirective).toContain("most common failure mode")
    expect(built.protocolDirective).toContain("commitment step")
    expect(built.protocolDirective).toContain("close </local>")
  })

  test("coordinate keeps everything visible when the model declares nothing", () => {
    const messages: any[] = [
      {
        info: { id: "u1", role: "user" },
        parts: [{ type: "text", text: "Fix it" }],
      },
      {
        info: { id: "a1", role: "assistant" },
        parts: [
          {
            type: "tool",
            tool: "read",
            callID: "call-read-1",
            state: { status: "completed", output: "export function auth() {}" },
          },
          {
            type: "tool",
            tool: "bash",
            callID: "call-bash-2",
            state: { status: "completed", output: "Tests failed: 1 failure" },
          },
        ],
      },
    ]
    const coordinated = AttentionCoordinator.coordinate({ messages, userQuery: "Fix it" })
    expect(coordinated.attentionMask.mode).toBe("global")
    expect(coordinated.attentionMask.attendedSegments.length).toBe(2)
    expect(coordinated.attentionMask.maskedSegments.length).toBe(0)
  })

  test("coordinate honors a declared focus on the next turn", () => {
    const messages: any[] = [
      {
        info: { id: "u1", role: "user" },
        parts: [{ type: "text", text: "Fix it" }],
      },
      {
        info: { id: "a1", role: "assistant" },
        parts: [
          {
            type: "tool",
            tool: "read",
            callID: "call-read-1",
            state: { status: "completed", output: "export function auth() {}" },
          },
          {
            type: "tool",
            tool: "bash",
            callID: "call-bash-2",
            state: { status: "completed", output: "Tests failed: 1 failure" },
          },
        ],
      },
      {
        info: { id: "a2", role: "assistant" },
        parts: [{ type: "text", text: '<focus segments="tool:call-read-1">export function auth() {}</focus>' }],
      },
    ]
    const coordinated = AttentionCoordinator.coordinate({ messages, userQuery: "Fix it" })
    expect(coordinated.attentionMask.mode).toBe("focus")
    expect(coordinated.attentionMask.attendedSegments.map((s) => s.id)).toEqual(["tool:call-read-1"])
  })

  test("coordinate falls back to global when the declared focus resolves nowhere", () => {
    const messages: any[] = [
      {
        info: { id: "a1", role: "assistant" },
        parts: [
          {
            type: "tool",
            tool: "read",
            callID: "call-read-1",
            state: { status: "completed", output: "export function auth() {}" },
          },
        ],
      },
      {
        info: { id: "a2", role: "assistant" },
        parts: [{ type: "text", text: '<focus segments="tool:stale-id">guessing</focus>' }],
      },
    ]
    const coordinated = AttentionCoordinator.coordinate({ messages, userQuery: "Fix it" })
    expect(coordinated.attentionMask.mode).toBe("global")
    expect(coordinated.attentionMask.attendedSegments.length).toBe(1)
  })

  test("coordinator stamps recency so newest reads outrank stale ones", () => {
    const messages: any[] = [
      {
        info: { id: "a1", role: "assistant" },
        parts: [
          {
            type: "tool",
            tool: "read",
            callID: "old-read",
            state: { status: "completed", output: "old content" },
          },
        ],
      },
      {
        info: { id: "a2", role: "assistant" },
        parts: [
          {
            type: "tool",
            tool: "read",
            callID: "new-read",
            state: { status: "completed", output: "new content" },
          },
        ],
      },
    ]
    const segments = AttentionCoordinator.extractSegmentsFromMessages(messages)
    const byId = new Map(segments.map((s) => [s.id, s]))
    expect((byId.get("tool:old-read")?.turnRegistered ?? 0)).toBeLessThan(
      byId.get("tool:new-read")?.turnRegistered ?? 0,
    )
  })

  test("split read parts stay visible when focusing on the parent tool call", async () => {    const bigOutput = "const x = 1; // padding to reach split threshold\n".repeat(700)
    const mockMessages: any[] = [
      {
        info: { id: "u1", role: "user" },
        parts: [{ type: "text", text: "Fix it" }],
      },
      {
        info: { id: "a1", role: "assistant" },
        parts: [
          {
            id: "p1",
            type: "tool",
            tool: "read",
            callID: "call-big-read",
            state: {
              status: "completed",
              input: { filePath: "src/big.ts" },
              output: bigOutput,
              time: { start: 1, end: 2 },
            },
          },
        ],
      },
      {
        info: { id: "u2", role: "user" },
        parts: [{ type: "text", text: "Proceed" }],
      },
    ]
    const fakeModel = { id: "test-model", provider: "test", capabilities: {} } as any
    const segments = AttentionCoordinator.extractSegmentsFromMessages(mockMessages)
    expect(segments.length).toBeGreaterThan(1)
    const sm = new AttentionStateMachine(scaffold, segments)
    const focusMask = sm.transition("focus", ["tool:call-big-read"])
    expect(focusMask.mode).toBe("focus")
    const modelMsgs = await toModelMessages(mockMessages, fakeModel, { attentionMask: focusMask })
    const serialized = JSON.stringify(modelMsgs)
    expect(serialized).toContain("const x = 1;")
    expect(serialized).not.toContain("STOWED TOOL RESULT")
  })

  test("a whitespace-free run is atomic and never cut mid-word", () => {
    const localSegmenter = new ContextSegmenter({ targetChunkSize: 64, blockSize: 16 })
    const blob = "aBcDeF0123456789".repeat(100)
    expect(blob.includes(" ")).toBe(false)
    const parts = localSegmenter.createSegment({
      id: "blob",
      name: "blob.bin",
      kind: "file_content",
      content: blob,
    })
    expect(parts.length).toBe(1)
    expect(parts[0].content).toBe(blob)
  })

  test("segments form a lossless partition of mixed content", () => {
    const localSegmenter = new ContextSegmenter({ targetChunkSize: 48, blockSize: 16 })
    const content = [
      "First paragraph states the founding year of the company in detail.",
      "Second paragraph continues with early history and more background facts.",
      "",
      "Third paragraph after a blank line carries the IPO year and venue info.",
      "A final line wraps up the document with a short concluding sentence here.",
    ].join("\n")
    const parts = localSegmenter.createSegment({
      id: "doc",
      name: "doc.txt",
      kind: "file_content",
      content,
    })
    expect(parts.length).toBeGreaterThan(1)
    expect(parts.map((p) => p.content).join("")).toBe(content)
    for (const part of parts) {
      expect(part.blockAlignedTokenCount % 16).toBe(0)
    }
  })

  test("empty output renders an addressable placeholder segment", () => {
    const parts = segmenter.fromToolResult("read", "call-empty", "   \n  ")
    expect(parts.length).toBe(1)
    expect(parts[0].content).toBe("<empty_context>")
  })
})
