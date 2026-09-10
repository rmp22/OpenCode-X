import { describe, expect, test } from "bun:test"
import { compactMemoryStore } from "@/ocx/memory/compaction"
import { SemanticMemoryStore } from "@/ocx/memory/store"

describe("Semantic Memory & Compaction", () => {
  test("compacts older tool outputs into summaries with provenance hashes", () => {
    const store = new SemanticMemoryStore()

    for (let i = 0; i < 5; i++) {
      store.addEntry({
        id: `tool-${i}`,
        tier: "L1_active",
        turnIndex: i,
        kind: "tool_output",
        content: `Very large tool output line 1\nline 2\nline 3 from turn ${i} with lots of bytes...`,
      })
    }

    store.addEntry({
      id: "req-active",
      tier: "L1_active",
      turnIndex: 5,
      kind: "requirement",
      content: "Active requirement: zero data loss",
      preservedFromCompaction: true,
    })

    const result = compactMemoryStore(store, {
      maxActiveEntries: 2,
      preserveRequirements: true,
    })

    expect(result.compactedCount).toBeGreaterThan(0)
    expect(result.stowedCount).toBeGreaterThan(0)

    const stowed = store.getEntries("L2_stowed")
    expect(stowed[0].content).toContain("[Compacted tool output")
    expect(stowed[0].provenanceHash).toBeDefined()

    const activeReq = store.getEntries("L1_active").find((e) => e.id === "req-active")
    expect(activeReq).toBeDefined()
  })
})
