import type { AdaptiveScaffold, ModelProfile } from "./types"

export function getAdaptiveScaffold(profile: ModelProfile): AdaptiveScaffold {
  if (profile.capabilities.tier === "frontier") {
    return {
      profileId: profile.id,
      promptStyle: "lean",
      guidanceText: "Be direct, concise, and technically accurate. Follow repo instructions directly.",
      includeStepByStepExamples: false,
    }
  }

  if (profile.capabilities.tier === "strong") {
    return {
      profileId: profile.id,
      promptStyle: "standard",
      guidanceText: "Follow these steps: 1. Ground truth read. 2. Minimal surgical edits. 3. Verification checks.",
      includeStepByStepExamples: false,
    }
  }

  return {
    profileId: profile.id,
    promptStyle: "comprehensive",
    guidanceText: "Carefully adhere to formatting rules. Do not hallucinate paths. Always read before editing. Verify outputs with tests.",
    includeStepByStepExamples: true,
  }
}
