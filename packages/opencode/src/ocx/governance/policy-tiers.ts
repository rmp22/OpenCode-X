export type PolicyTier = "minimal" | "standard" | "comprehensive" | "strict"
export type ToolCategory = "read" | "mutate" | "execute" | "external" | "administrative"
export type VerificationLevel = "none" | "basic" | "full" | "ablation"

export interface TierConfig {
  readonly tier: PolicyTier
  readonly maxPromptTokens: number
  readonly maxContextTokens: number
  readonly maxTurns: number
  readonly stageBudgets: Readonly<Record<string, number>>
  readonly allowedCategories: readonly ToolCategory[]
  readonly blockedTools: readonly string[]
  readonly requireStrictEvidence: boolean
  readonly verificationLevel: VerificationLevel
  readonly allowDynamicDowngrade: boolean
}

export const TIER_CONFIGS: Readonly<Record<PolicyTier, TierConfig>> = {
  minimal: {
    tier: "minimal",
    maxPromptTokens: 16000,
    maxContextTokens: 8000,
    maxTurns: 5,
    stageBudgets: { analyze: 4000, mutate: 4000, verify: 4000, default: 4000 },
    allowedCategories: ["read", "mutate"],
    blockedTools: ["websearch", "webfetch", "bash"],
    requireStrictEvidence: false,
    verificationLevel: "basic",
    allowDynamicDowngrade: false,
  },
  standard: {
    tier: "standard",
    maxPromptTokens: 64000,
    maxContextTokens: 32000,
    maxTurns: 20,
    stageBudgets: { analyze: 12000, mutate: 24000, verify: 16000, default: 12000 },
    allowedCategories: ["read", "mutate", "execute", "external"],
    blockedTools: [],
    requireStrictEvidence: false,
    verificationLevel: "basic",
    allowDynamicDowngrade: true,
  },
  comprehensive: {
    tier: "comprehensive",
    maxPromptTokens: 128000,
    maxContextTokens: 64000,
    maxTurns: 50,
    stageBudgets: { analyze: 24000, mutate: 48000, verify: 32000, default: 24000 },
    allowedCategories: ["read", "mutate", "execute", "external", "administrative"],
    blockedTools: [],
    requireStrictEvidence: true,
    verificationLevel: "full",
    allowDynamicDowngrade: true,
  },
  strict: {
    tier: "strict",
    maxPromptTokens: 48000,
    maxContextTokens: 24000,
    maxTurns: 15,
    stageBudgets: { analyze: 10000, mutate: 16000, verify: 16000, default: 8000 },
    allowedCategories: ["read", "mutate", "execute"],
    blockedTools: ["websearch", "webfetch"],
    requireStrictEvidence: true,
    verificationLevel: "ablation",
    allowDynamicDowngrade: false,
  },
}

export function getTierConfig(tier: PolicyTier): TierConfig {
  return TIER_CONFIGS[tier]
}

export function categorizeTool(toolName: string): ToolCategory {
  if (toolName === "read" || toolName === "glob" || toolName === "grep") return "read"
  if (toolName === "edit" || toolName === "write") return "mutate"
  if (toolName === "bash") return "execute"
  if (toolName === "websearch" || toolName === "webfetch" || toolName === "youtube-transcript") return "external"
  return "administrative"
}

export function isToolAllowedInTier(tier: PolicyTier, toolName: string, category?: ToolCategory): boolean {
  const config = getTierConfig(tier)
  if (config.blockedTools.includes(toolName)) return false
  const targetCategory = category ?? categorizeTool(toolName)
  return config.allowedCategories.includes(targetCategory)
}

export function resolveTierForTask(input: {
  readonly complexity?: "low" | "medium" | "high"
  readonly risk?: "low" | "standard" | "high"
  readonly requestedTier?: PolicyTier
}): PolicyTier {
  if (input.requestedTier) return input.requestedTier
  if (input.risk === "high") return "strict"
  if (input.complexity === "high") return "comprehensive"
  if (input.complexity === "low" && input.risk === "low") return "minimal"
  return "standard"
}

export class PolicyTierManager {
  private tier: PolicyTier

  constructor(initialTier: PolicyTier = "standard") {
    this.tier = initialTier
  }

  get currentTier(): PolicyTier {
    return this.tier
  }

  getConfig(): TierConfig {
    return getTierConfig(this.tier)
  }

  setTier(tier: PolicyTier): void {
    this.tier = tier
  }

  downgrade(): PolicyTier | undefined {
    const current = this.getConfig()
    if (!current.allowDynamicDowngrade) return undefined
    const nextTier: PolicyTier | undefined =
      this.tier === "comprehensive" ? "standard" : this.tier === "standard" ? "minimal" : undefined
    if (nextTier) this.tier = nextTier
    return nextTier
  }

  isToolAllowed(toolName: string, category?: ToolCategory): boolean {
    return isToolAllowedInTier(this.tier, toolName, category)
  }

  getStageBudget(stage: string): number {
    const config = this.getConfig()
    return config.stageBudgets[stage] ?? config.stageBudgets.default ?? config.maxPromptTokens
  }
}
