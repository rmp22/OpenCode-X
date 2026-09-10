import type { ModelProfile } from "./types"

const PROFILES: Record<string, ModelProfile> = {
  "anthropic/claude-3-5-sonnet": {
    id: "anthropic/claude-3-5-sonnet",
    name: "Claude 3.5 Sonnet",
    provider: "anthropic",
    capabilities: {
      contextWindow: 200_000,
      maxOutputTokens: 8_192,
      supportsStructuredOutputs: true,
      supportsToolCalling: true,
      reasoningEffortSupported: false,
      tier: "frontier",
    },
  },
  "openai/gpt-4o": {
    id: "openai/gpt-4o",
    name: "GPT-4o",
    provider: "openai",
    capabilities: {
      contextWindow: 128_000,
      maxOutputTokens: 16_384,
      supportsStructuredOutputs: true,
      supportsToolCalling: true,
      reasoningEffortSupported: false,
      tier: "frontier",
    },
  },
  "google/gemini-1.5-pro": {
    id: "google/gemini-1.5-pro",
    name: "Gemini 1.5 Pro",
    provider: "google",
    capabilities: {
      contextWindow: 1_000_000,
      maxOutputTokens: 8_192,
      supportsStructuredOutputs: true,
      supportsToolCalling: true,
      reasoningEffortSupported: true,
      tier: "frontier",
    },
  },
  "google/gemini-1.5-flash": {
    id: "google/gemini-1.5-flash",
    name: "Gemini 1.5 Flash",
    provider: "google",
    capabilities: {
      contextWindow: 1_000_000,
      maxOutputTokens: 8_192,
      supportsStructuredOutputs: true,
      supportsToolCalling: true,
      reasoningEffortSupported: false,
      tier: "strong",
    },
  },
  default: {
    id: "default",
    name: "Standard Model",
    provider: "unknown",
    capabilities: {
      contextWindow: 64_000,
      maxOutputTokens: 4_096,
      supportsStructuredOutputs: false,
      supportsToolCalling: true,
      reasoningEffortSupported: false,
      tier: "standard",
    },
  },
}

export function resolveModelProfile(modelId: string): ModelProfile {
  const match = PROFILES[modelId]
  if (match) return match

  for (const [key, prof] of Object.entries(PROFILES)) {
    if (modelId.toLowerCase().includes(key.toLowerCase())) {
      return prof
    }
  }

  return PROFILES.default
}
