import type {
  AttentionSegment,
  ProviderAttentionCapability,
  ProviderAttentionNegotiation,
} from "./types"

export function resolveAttentionCapability(
  provider: string,
  model: string,
): ProviderAttentionNegotiation {
  const normProvider = provider.toLowerCase()
  const normModel = model.toLowerCase()

  if (normProvider === "custom-native" || normModel.includes("native-mask")) {
    return {
      provider,
      model,
      capability: "NATIVE_DECODE_MASK",
      telemetrySource: "NATIVE_DA",
    }
  }

  if (normProvider === "anthropic" || normProvider === "openai" || normProvider === "google") {
    return {
      provider,
      model,
      capability: "REQUEST_PROJECTION",
      telemetrySource: "REQUEST_PROJECTION",
    }
  }

  return {
    provider,
    model,
    capability: "ATTENTION_NONE",
    telemetrySource: "SIMULATION",
  }
}

export function filterSegmentsByExactId(
  segments: readonly AttentionSegment[],
  targetIds: readonly string[],
): AttentionSegment[] {
  const targetSet = new Set(targetIds)
  return segments.filter((s) => targetSet.has(s.id))
}

export class TurnAttentionScope {
  private activeTargetIds: string[] = []
  private readonly defaultCapability: ProviderAttentionCapability

  constructor(defaultCapability: ProviderAttentionCapability = "REQUEST_PROJECTION") {
    this.defaultCapability = defaultCapability
  }

  setFocus(targetIds: string[]): void {
    this.activeTargetIds = [...targetIds]
  }

  getFocus(): string[] {
    return [...this.activeTargetIds]
  }

  resetForNewTurn(): void {
    this.activeTargetIds = []
  }

  get capability(): ProviderAttentionCapability {
    return this.defaultCapability
  }
}
