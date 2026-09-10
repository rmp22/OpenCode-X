import { describe, expect, test } from "bun:test"
import {
  alignToBlock,
  AttentionPromptProtocol,
  AttentionStateMachine,
  ContextSegmenter,
  MaskProjector,
} from "../../src/ocx/attention"

describe("OCX Declarative Attention System", () => {
  const segmenter = new ContextSegmenter({ targetChunkSize: 256, blockSize: 16 })

  const sampleToolOutput1 = `
File: packages/core/src/auth.ts
Line 1: export function verifyToken(token: string): boolean {
Line 2:   if (!token) return false;
Line 3:   return token.startsWith("ey");
Line 4: }
`

  const sampleToolOutput2 = `
File: packages/core/src/db.ts
Line 1: export class DatabaseSession {
Line 2:   connect() { return true; }
Line 3: }
`

  test("alignToBlock ensures block boundary rounding matching PagedAttention/FlashAttention", () => {
    expect(alignToBlock(0, 16)).toBe(0)
    expect(alignToBlock(1, 16)).toBe(16)
    expect(alignToBlock(16, 16)).toBe(16)
    expect(alignToBlock(17, 16)).toBe(32)
    expect(alignToBlock(33, 16)).toBe(48)
  })

  test("ContextSegmenter splits oversized content and aligns tokens", () => {
    const longContent = "A very long text segment paragraph.\n\n".repeat(50)
    const segments = segmenter.createSegment({
      id: "doc-1",
      name: "LongDocument.md",
      kind: "file_content",
      content: longContent,
    })

    expect(segments.length).toBeGreaterThan(1)
    expect(segments[0].id).toBe("doc-1:part_1")
    expect(segments[0].blockAlignedTokenCount % 16).toBe(0)
  })

  test("ContextSegmenter creates typed segments from tool results", () => {
    const segments = segmenter.fromToolResult("read", "call-123", sampleToolOutput1)
    expect(segments.length).toBe(1)
    expect(segments[0].id).toBe("tool:call-123")
    expect(segments[0].kind).toBe("file_content")
  })

  test("AttentionStateMachine executes global, focus, and local mode transitions with telemetry", () => {
    const defaultSegmenter = new ContextSegmenter({ targetChunkSize: 2048, blockSize: 16 })
    const seg1 = defaultSegmenter.fromToolResult("read", "read-auth", sampleToolOutput1.repeat(15))[0]
    const seg2 = defaultSegmenter.fromToolResult("bash", "test-run", sampleToolOutput2.repeat(20))[0]

    const scaffold = AttentionPromptProtocol.createScaffold({
      systemInstruction: "You are OpenCoder-X.",
      userQuery: "Fix the auth token verification logic.",
    })

    const stateMachine = new AttentionStateMachine(scaffold, [seg1, seg2], { blockSize: 16 })

    const globalMask = stateMachine.computeMask()
    expect(globalMask.mode).toBe("global")
    expect(globalMask.attendedSegments.length).toBe(2)
    expect(globalMask.maskedSegments.length).toBe(0)
    expect(globalMask.savedTokens).toBe(0)
    expect(globalMask.reductionRatio).toBe(0)

    const focusMask = stateMachine.transition("focus", ["tool:read-auth"])
    expect(focusMask.mode).toBe("focus")
    expect(focusMask.attendedSegments.length).toBe(1)
    expect(focusMask.attendedSegments[0].id).toBe("tool:read-auth")
    expect(focusMask.maskedSegments.length).toBe(1)
    expect(focusMask.maskedSegments[0].id).toBe("tool:test-run")
    expect(focusMask.savedTokens).toBeGreaterThan(0)
    expect(focusMask.reductionRatio).toBeGreaterThan(0.3)

    const localMask = stateMachine.transition("local", [])
    expect(localMask.mode).toBe("local")
    expect(localMask.attendedSegments.length).toBe(0)
    expect(localMask.maskedSegments.length).toBe(2)
    expect(localMask.attendedContextTokens).toBe(0)
    expect(localMask.totalAttendedTokens).toBe(scaffold.tokenCount)
    expect(localMask.reductionRatio).toBeGreaterThan(0.7)

    const revertedMask = stateMachine.transition("global", [])
    expect(revertedMask.mode).toBe("global")
    expect(revertedMask.attendedSegments.length).toBe(2)

    const telemetry = stateMachine.getTelemetry("test-session", 1)
    expect(telemetry.sessionId).toBe("test-session")
    expect(telemetry.modesEmitted).toContain("focus")
    expect(telemetry.modesEmitted).toContain("local")
  })

  test("AttentionStateMachine stream chunk processing parses DA tags and reverts on close", () => {
    const seg1 = segmenter.fromToolResult("read", "read-auth", sampleToolOutput1)[0]
    const scaffold = AttentionPromptProtocol.createScaffold({
      systemInstruction: "You are OpenCoder-X.",
      userQuery: "Check auth",
    })
    const stateMachine = new AttentionStateMachine(scaffold, [seg1])

    const step1 = stateMachine.processChunk("Let me survey the codebase. <focus segments=\"tool:read-auth\">")
    expect(step1.changed).toBe(true)
    expect(step1.mask.mode).toBe("focus")
    expect(stateMachine.getMode()).toBe("focus")

    const step2 = stateMachine.processChunk("Inside the token verification function.")
    expect(step2.changed).toBe(false)

    const step3 = stateMachine.processChunk("</focus> Now I know the answer.")
    expect(step3.changed).toBe(true)
    expect(step3.mask.mode).toBe("global")

    const step4 = stateMachine.processChunk("<local> 2 + 2 = 4 </local>")
    expect(step4.changed).toBe(true)
    expect(stateMachine.getMode()).toBe("global")
  })

  test("MaskProjector virtualizes context in focus and local modes", () => {
    const seg1 = segmenter.fromToolResult("read", "read-auth", "export function auth() {}")[0]
    const seg2 = segmenter.fromToolResult("bash", "test-run", "Tests failed: 1 failure")[0]
    const scaffold = AttentionPromptProtocol.createScaffold({
      systemInstruction: "System",
      userQuery: "Query",
    })
    const stateMachine = new AttentionStateMachine(scaffold, [seg1, seg2])

    stateMachine.transition("focus", ["tool:read-auth"])
    const focusProjection = MaskProjector.projectContext(stateMachine.computeMask())
    expect(focusProjection).toContain("=== FOCUSED SEGMENT [id=\"tool:read-auth\"]")
    expect(focusProjection).toContain("export function auth() {}")
    expect(focusProjection).toContain("[STOWED SEGMENT: id=\"tool:test-run\"")
    expect(focusProjection).not.toContain("Tests failed: 1 failure")

    stateMachine.transition("local")
    const localProjection = MaskProjector.projectContext(stateMachine.computeMask())
    expect(localProjection).toContain("[STOWED CONTEXT: id=\"tool:read-auth\"")
    expect(localProjection).toContain("[STOWED CONTEXT: id=\"tool:test-run\"")
    expect(localProjection).not.toContain("export function auth() {}")
  })

  test("MaskProjector generates block table indices for PagedAttention/FlashAttention", () => {
    const seg1 = segmenter.fromToolResult("read", "read-auth", "A".repeat(200))[0]
    const seg2 = segmenter.fromToolResult("bash", "test-run", "B".repeat(200))[0]
    const scaffold = AttentionPromptProtocol.createScaffold({
      systemInstruction: "System",
      userQuery: "Query",
    })
    const stateMachine = new AttentionStateMachine(scaffold, [seg1, seg2])

    stateMachine.transition("focus", ["tool:read-auth"])
    const blockTable = MaskProjector.projectBlockTable(stateMachine.computeMask(), 16)

    expect(blockTable.totalBlocks).toBeGreaterThan(0)
    expect(blockTable.attendedBlockIndices.length).toBeLessThan(blockTable.totalBlocks)
  })

  test("AttentionPromptProtocol renders segment directory for model navigation", () => {
    const seg = segmenter.fromToolResult("read", "auth-file", "content")[0]
    const dir = AttentionPromptProtocol.renderSegmentDirectory([seg])
    expect(dir).toContain("=== AVAILABLE CONTEXT SEGMENTS")
    expect(dir).toContain("id=\"tool:auth-file\"")
  })
})
