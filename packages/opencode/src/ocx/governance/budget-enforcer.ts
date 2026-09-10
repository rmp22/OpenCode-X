export type BudgetStatus = "ok" | "warning" | "exhausted"

export interface BudgetConfig {
  readonly maxSessionTokens: number
  readonly maxStageTokens: number
  readonly warningThresholdRatio: number
  readonly reservedCompletionTokens: number
  readonly maxModelTokens: number
}

export interface BudgetState {
  readonly sessionTokensUsed: number
  readonly stageTokensUsed: Readonly<Record<string, number>>
  readonly status: BudgetStatus
  readonly remainingSessionTokens: number
}

export interface CheckBudgetResult {
  readonly allowed: boolean
  readonly status: BudgetStatus
  readonly remainingTokens: number
  readonly requiresDegradation: boolean
}

export interface PromptValidationResult {
  readonly valid: boolean
  readonly promptTokens: number
  readonly availableTokens: number
  readonly overflowTokens: number
  readonly reason?: string
}

export interface SegmentToTrim {
  readonly id: string
  readonly estimatedTokens: number
  readonly salience?: number
  readonly protected?: boolean
}

export interface TrimResult<T extends SegmentToTrim> {
  readonly retained: readonly T[]
  readonly evicted: readonly T[]
  readonly totalTokens: number
}

export const DEFAULT_BUDGET_CONFIG: BudgetConfig = {
  maxSessionTokens: 100000,
  maxStageTokens: 30000,
  warningThresholdRatio: 0.8,
  reservedCompletionTokens: 4000,
  maxModelTokens: 128000,
}

export class BudgetEnforcer {
  private readonly config: BudgetConfig
  private sessionTokensUsed = 0
  private stageTokensUsed: Record<string, number> = {}

  constructor(config?: Partial<BudgetConfig>) {
    this.config = {
      ...DEFAULT_BUDGET_CONFIG,
      ...config,
    }
  }

  getConfig(): BudgetConfig {
    return this.config
  }

  getState(): BudgetState {
    const remaining = Math.max(0, this.config.maxSessionTokens - this.sessionTokensUsed)
    const ratio = this.config.maxSessionTokens === 0 ? 1 : this.sessionTokensUsed / this.config.maxSessionTokens
    const status: BudgetStatus =
      ratio >= 1 ? "exhausted" : ratio >= this.config.warningThresholdRatio ? "warning" : "ok"
    return {
      sessionTokensUsed: this.sessionTokensUsed,
      stageTokensUsed: { ...this.stageTokensUsed },
      status,
      remainingSessionTokens: remaining,
    }
  }

  recordUsage(tokens: number, stage?: string): BudgetState {
    this.sessionTokensUsed += Math.max(0, tokens)
    if (stage) {
      this.stageTokensUsed[stage] = (this.stageTokensUsed[stage] ?? 0) + Math.max(0, tokens)
    }
    return this.getState()
  }

  checkBudget(proposedTokens: number, stage?: string): CheckBudgetResult {
    const safeProposed = Math.max(0, proposedTokens)
    const newSessionTotal = this.sessionTokensUsed + safeProposed
    const remaining = Math.max(0, this.config.maxSessionTokens - newSessionTotal)
    const sessionRatio = this.config.maxSessionTokens === 0 ? 1 : newSessionTotal / this.config.maxSessionTokens

    const stageUsed = stage ? (this.stageTokensUsed[stage] ?? 0) : 0
    const newStageTotal = stageUsed + safeProposed
    const stageExhausted = Boolean(stage && newStageTotal > this.config.maxStageTokens)

    if (sessionRatio >= 1 || stageExhausted) {
      return {
        allowed: false,
        status: "exhausted",
        remainingTokens: remaining,
        requiresDegradation: true,
      }
    }

    if (sessionRatio >= this.config.warningThresholdRatio) {
      return {
        allowed: true,
        status: "warning",
        remainingTokens: remaining,
        requiresDegradation: true,
      }
    }

    return {
      allowed: true,
      status: "ok",
      remainingTokens: remaining,
      requiresDegradation: false,
    }
  }

  validatePromptAssembly(promptTokens: number, maxTokensOverride?: number): PromptValidationResult {
    const maxTokens = maxTokensOverride ?? this.config.maxModelTokens
    const available = maxTokens - this.config.reservedCompletionTokens
    if (promptTokens > available) {
      return {
        valid: false,
        promptTokens,
        availableTokens: available,
        overflowTokens: promptTokens - available,
        reason: `Prompt tokens (${promptTokens}) exceed available budget (${available})`,
      }
    }
    return {
      valid: true,
      promptTokens,
      availableTokens: available,
      overflowTokens: 0,
    }
  }

  trimSegments<T extends SegmentToTrim>(segments: readonly T[], targetTokens: number): TrimResult<T> {
    const total = segments.reduce((sum, seg) => sum + seg.estimatedTokens, 0)
    if (total <= targetTokens) {
      return {
        retained: [...segments],
        evicted: [],
        totalTokens: total,
      }
    }

    const candidates = segments
      .filter((seg) => !seg.protected)
      .map((seg, originalIndex) => ({ seg, originalIndex }))
      .sort((a, b) => {
        const salienceA = a.seg.salience ?? 0
        const salienceB = b.seg.salience ?? 0
        if (salienceA !== salienceB) return salienceA - salienceB
        return a.originalIndex - b.originalIndex
      })

    let currentTotal = total
    const evictedIds = new Set<string>()

    for (const candidate of candidates) {
      if (currentTotal <= targetTokens) break
      evictedIds.add(candidate.seg.id)
      currentTotal -= candidate.seg.estimatedTokens
    }

    const retained = segments.filter((seg) => !evictedIds.has(seg.id))
    const evicted = segments.filter((seg) => evictedIds.has(seg.id))
    const finalTokens = retained.reduce((sum, seg) => sum + seg.estimatedTokens, 0)

    return {
      retained,
      evicted,
      totalTokens: finalTokens,
    }
  }

  resetStage(stage: string): void {
    delete this.stageTokensUsed[stage]
  }

  resetAll(): void {
    this.sessionTokensUsed = 0
    this.stageTokensUsed = {}
  }
}
