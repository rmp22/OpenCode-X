import { createHash } from "node:crypto"
import type { CompactionOptions, CompactionResult } from "./types"
import type { SemanticMemoryStore } from "./store"

export function compactMemoryStore(
  store: SemanticMemoryStore,
  options?: CompactionOptions,
): CompactionResult {
  const maxActive = options?.maxActiveEntries ?? 10
  const active = store.getEntries("L1_active")

  let compactedCount = 0
  let freedTokens = 0

  if (active.length > maxActive) {
    const toCompact = active.slice(0, active.length - maxActive)

    for (const entry of toCompact) {
      if (entry.preservedFromCompaction) continue
      if (options?.preserveRequirements && entry.kind === "requirement") continue
      if (options?.preserveDecisions && entry.kind === "decision") continue

      if (entry.kind === "tool_output") {
        const hash = createHash("sha256").update(entry.content).digest("hex")
        const originalLength = entry.content.length
        entry.content = `[Compacted tool output (${originalLength} chars). Hash: ${hash.slice(0, 12)}]`
        entry.provenanceHash = hash
        entry.tier = "L2_stowed"
        compactedCount++
        freedTokens += Math.max(0, Math.ceil((originalLength - entry.content.length) / 4))
      }
    }
  }

  const remainingActive = store.getEntries("L1_active").length
  const stowed = store.getEntries("L2_stowed").length

  return {
    compactedCount,
    activeCount: remainingActive,
    stowedCount: stowed,
    freedEstimatedTokens: freedTokens,
  }
}
