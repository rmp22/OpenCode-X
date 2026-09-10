import { describe, expect, test } from "bun:test"
import {
  resolveAttentionCapability,
  filterSegmentsByExactId,
  TurnAttentionScope,
} from "@/ocx/attention/backend"
import type { AttentionSegment } from "@/ocx/attention/types"

describe("Declarative Attention Backend & Capability Router", () => {
  test("truthfully negotiates provider attention capabilities", () => {
    const anthropic = resolveAttentionCapability("anthropic", "claude-3-5-sonnet")
    expect(anthropic.capability).toBe("REQUEST_PROJECTION")
    expect(anthropic.telemetrySource).toBe("REQUEST_PROJECTION")

    const native = resolveAttentionCapability("custom-native", "fast-model")
    expect(native.capability).toBe("NATIVE_DECODE_MASK")
    expect(native.telemetrySource).toBe("NATIVE_DA")

    const other = resolveAttentionCapability("ollama", "qwen")
    expect(other.capability).toBe("ATTENTION_NONE")
    expect(other.telemetrySource).toBe("SIMULATION")
  })

  test("filters segments by exact stable segment ID", () => {
    const segments: AttentionSegment[] = [
      { id: "seg-1", name: "system", kind: "generic", content: "sys", tokenCount: 10, summary: "sys", blockAlignedTokenCount: 16 },
      { id: "seg-10", name: "tool", kind: "tool_output", content: "tool", tokenCount: 20, summary: "tool", blockAlignedTokenCount: 32 },
      { id: "seg-2", name: "user", kind: "conversation_turn", content: "user", tokenCount: 15, summary: "user", blockAlignedTokenCount: 16 },
    ]

    const filtered = filterSegmentsByExactId(segments, ["seg-1"])
    expect(filtered).toHaveLength(1)
    expect(filtered[0].id).toBe("seg-1")
  })

  test("resets attention scope across turns", () => {
    const scope = new TurnAttentionScope()
    scope.setFocus(["seg-1", "seg-2"])
    expect(scope.getFocus()).toEqual(["seg-1", "seg-2"])

    scope.resetForNewTurn()
    expect(scope.getFocus()).toEqual([])
  })
})
