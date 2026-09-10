export type ModelBehaviorProfile = {
  readonly modelId: string
  readonly workflowSkipRate: number
  readonly ownerBypassRate: number
  readonly repeatedToolFailureRate: number
  readonly resultIgnoreRate: number
  readonly scopeDriftRate: number
  readonly overExplorationRate: number
  readonly underExplorationRate: number
  readonly prematureCompletionRate: number
  readonly verificationSkipRate: number
  readonly instructionLossRate: number
  readonly contextReuseRate: number
  readonly recoverySuccessRate: number
  readonly searchRouteConfusionRate?: number
  readonly searchScopeRetryRate?: number
}

export type Scaffolding = {
  readonly workflowDepth: "LIGHT" | "NORMAL" | "DEEP"
  readonly recoveryLevel: 1 | 2 | 3 | 4 | 5
  readonly contextSize: number
  readonly toolChoiceNarrowing: boolean
  readonly verificationGuidance: boolean
  readonly ownerRoutingStrength: "NORMAL" | "STRONG"
  readonly reviewFrequency: "NORMAL" | "HIGH"
}

export const FALLBACK_PROFILE: ModelBehaviorProfile = {
  modelId: "fallback",
  workflowSkipRate: 0.2,
  ownerBypassRate: 0.1,
  repeatedToolFailureRate: 0.15,
  resultIgnoreRate: 0.1,
  scopeDriftRate: 0.1,
  overExplorationRate: 0.15,
  underExplorationRate: 0.1,
  prematureCompletionRate: 0.1,
  verificationSkipRate: 0.2,
  instructionLossRate: 0.2,
  contextReuseRate: 0.7,
  recoverySuccessRate: 0.6,
}

const profiles = new Map<string, ModelBehaviorProfile>()

export function registerProfile(profile: ModelBehaviorProfile): void {
  profiles.set(profile.modelId, profile)
}

export function getProfile(modelId: string): ModelBehaviorProfile {
  return profiles.get(modelId) ?? FALLBACK_PROFILE
}

export function clearProfiles(): void {
  profiles.clear()
}

export function adaptScaffolding(profile: ModelBehaviorProfile): Scaffolding {
  const scaffolding: Scaffolding = {
    workflowDepth: profile.workflowSkipRate > 0.3 ? "DEEP" : profile.workflowSkipRate > 0.15 ? "NORMAL" : "LIGHT",
    recoveryLevel: profile.repeatedToolFailureRate > 0.25 ? 3 : profile.repeatedToolFailureRate > 0.15 ? 2 : 1,
    contextSize: profile.instructionLossRate > 0.25 ? 2000 : profile.instructionLossRate > 0.15 ? 4000 : 6000,
    toolChoiceNarrowing: profile.repeatedToolFailureRate > 0.2,
    verificationGuidance: profile.verificationSkipRate > 0.2,
    ownerRoutingStrength: profile.ownerBypassRate > 0.2 ? "STRONG" : "NORMAL",
    reviewFrequency: profile.prematureCompletionRate > 0.2 ? "HIGH" : "NORMAL",
  }
  return scaffolding
}

export function profileFromCalibration(data: {
  workflowSkipRate: number
  ownerBypassRate: number
  repeatedToolFailureRate: number
  searchRouteConfusionRate?: number
}): ModelBehaviorProfile {
  return {
    modelId: `calibrated-${Date.now()}`,
    workflowSkipRate: data.workflowSkipRate,
    ownerBypassRate: data.ownerBypassRate,
    repeatedToolFailureRate: data.repeatedToolFailureRate,
    resultIgnoreRate: 0.1,
    scopeDriftRate: 0.1,
    overExplorationRate: 0.15,
    underExplorationRate: 0.1,
    prematureCompletionRate: 0.1,
    verificationSkipRate: 0.15,
    instructionLossRate: 0.2,
    contextReuseRate: 0.7,
    recoverySuccessRate: 0.6,
    ...(data.searchRouteConfusionRate !== undefined ? { searchRouteConfusionRate: data.searchRouteConfusionRate } : {}),
  }
}

export function needsStrongerScaffolding(profile: ModelBehaviorProfile): boolean {
  return profile.workflowSkipRate > 0.3 || profile.repeatedToolFailureRate > 0.3 || profile.verificationSkipRate > 0.3
}

export * from "./model-profile/types"
export * from "./model-profile/profiles"
export * from "./model-profile/scaffolding"
export * as ModelProfile from "./model-profile"