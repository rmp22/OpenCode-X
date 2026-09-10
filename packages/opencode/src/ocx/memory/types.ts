export type MemoryTier = "L1_active" | "L2_stowed" | "L3_archived"

export interface MemoryEntry {
  id: string
  tier: MemoryTier
  turnIndex: number
  kind: "user_prompt" | "assistant_reasoning" | "tool_output" | "requirement" | "decision"
  content: string
  provenanceHash?: string
  timestamp: number
  preservedFromCompaction?: boolean
}

export interface CompactionOptions {
  maxActiveEntries?: number
  preserveRequirements?: boolean
  preserveDecisions?: boolean
}

export interface CompactionResult {
  compactedCount: number
  activeCount: number
  stowedCount: number
  freedEstimatedTokens: number
}
