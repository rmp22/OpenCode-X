export type ModelTier = "frontier" | "strong" | "standard" | "compact"

export interface ModelCapabilities {
  contextWindow: number
  maxOutputTokens: number
  supportsStructuredOutputs: boolean
  supportsToolCalling: boolean
  reasoningEffortSupported: boolean
  tier: ModelTier
}

export interface ModelProfile {
  id: string
  name: string
  provider: string
  capabilities: ModelCapabilities
}

export interface AdaptiveScaffold {
  profileId: string
  promptStyle: "lean" | "standard" | "comprehensive"
  guidanceText: string
  includeStepByStepExamples: boolean
}
