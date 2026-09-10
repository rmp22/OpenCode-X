export type AttentionMode = "global" | "focus" | "local"

export type SegmentKind =
  | "tool_output"
  | "file_content"
  | "search_result"
  | "diff"
  | "command_log"
  | "plan"
  | "conversation_turn"
  | "generic"

export type MemoryTier = "L1_ACTIVE" | "L2_STOWED" | "L3_ARCHIVED"

export interface AttentionSegment {
  readonly id: string
  readonly name: string
  readonly kind: SegmentKind
  readonly content: string
  readonly tokenCount: number
  readonly summary: string
  readonly blockAlignedTokenCount: number
  readonly tier?: MemoryTier
  readonly turnRegistered?: number
  readonly lastAccessedTurn?: number
  readonly metadata?: Record<string, unknown>
}

export type ProviderAttentionCapability =
  | "ATTENTION_NONE"
  | "REQUEST_PROJECTION"
  | "INTERLEAVED_FOCUS"
  | "NATIVE_DECODE_MASK"

export type AttentionTelemetrySource = "REQUEST_PROJECTION" | "NATIVE_DA" | "SIMULATION"

export interface ProviderAttentionNegotiation {
  readonly provider: string
  readonly model: string
  readonly capability: ProviderAttentionCapability
  readonly telemetrySource: AttentionTelemetrySource
}

export interface AttentionScaffold {
  readonly systemInstruction: string
  readonly userQuery: string
  readonly protocolDirective: string
  readonly tokenCount: number
}

export interface AttentionDeclaration {
  readonly mode: AttentionMode
  readonly targetSegmentIds: readonly string[]
  readonly rationale?: string
  readonly rawTag: string
}

export interface AttentionMask {
  readonly mode: AttentionMode
  readonly focusedSegmentIds: readonly string[]
  readonly attendedSegments: readonly AttentionSegment[]
  readonly maskedSegments: readonly AttentionSegment[]
  readonly scaffoldTokens: number
  readonly totalContextTokens: number
  readonly attendedContextTokens: number
  readonly totalAttendedTokens: number
  readonly savedTokens: number
  readonly reductionRatio: number
}

export interface AttentionTelemetry {
  readonly sessionId: string
  readonly turnIndex: number
  readonly modesEmitted: readonly AttentionMode[]
  readonly segmentCount: number
  readonly totalTokens: number
  readonly attendedTokens: number
  readonly savedTokens: number
  readonly reductionRatio: number
}

export interface AttentionConfig {
  readonly targetChunkSize: number
  readonly hardCapTokens?: number
  readonly measureTokens?: (text: string) => number
  readonly blockSize: number
  readonly defaultMode: AttentionMode
  readonly enableVirtualization: boolean
}

export const DEFAULT_ATTENTION_CONFIG: AttentionConfig = {
  targetChunkSize: 2048,
  blockSize: 16,
  defaultMode: "global",
  enableVirtualization: true,
}

export function alignToBlock(tokenCount: number, blockSize: number = 16): number {
  if (tokenCount <= 0) return 0
  const remainder = tokenCount % blockSize
  if (remainder === 0) return tokenCount
  return tokenCount + (blockSize - remainder)
}

export function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.ceil(text.length / 4)
}
