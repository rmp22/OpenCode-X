export type TrajectoryDirection =
  | "IMPROVING"
  | "STABLE"
  | "DEGRADING"
  | "VOLATILE"
  | "COMPRESSION"
  | "EXPANSION"

export type QualityDimensions = {
  readonly cyclomaticComplexity: number
  readonly nestingDepth: number
  readonly commentDensity: number
  readonly identifierQuality: number
  readonly fanOut: number
  readonly abstractionRatio: number
}

export type TurnQualityRecord = {
  readonly turn: number
  readonly score: number
  readonly dimensions: QualityDimensions
  readonly timestamp?: number
  readonly linesOfCode?: number
  readonly testAssertionCount?: number
}

export type TrajectoryAlert = {
  readonly level: "info" | "warning" | "error" | "critical"
  readonly message: string
  readonly turnOfOrigin?: number
  readonly recommendation?: string
}

export type TrajectoryAnalysis = {
  readonly classification: TrajectoryDirection
  readonly deltaQ: number
  readonly acceleratingDegradation: boolean
  readonly variance: number
  readonly secondDerivative: number
  readonly circuitBreakerTriggered: boolean
  readonly alerts: readonly TrajectoryAlert[]
  readonly compoundingDebtDetected: boolean
  readonly debtHalfLifeTurns?: number
  readonly consecutiveDegradingTurns: number
}

export type AttributionCategory =
  | "INTENTIONAL_REFACTOR"
  | "INCIDENTAL_EROSION"
  | "PURE_ADDITION"
  | "ABANDONED_BRANCH"

export type DiffChunkAttribution = {
  readonly file: string
  readonly startLine: number
  readonly endLine: number
  readonly category: AttributionCategory
  readonly qualityDelta: number
  readonly blastRadius: number
  readonly explanation: string
}

export type TurnAttribution = {
  readonly turn: number
  readonly chunks: readonly DiffChunkAttribution[]
  readonly blastRadius: number
  readonly blameScore: number
  readonly intentionalRefactorRatio: number
  readonly incidentalErosionCount: number
}

export type StructuralErosionHotspot = {
  readonly file: string
  readonly churnPercentage: number
  readonly fanOutIncreasePercentage: number
  readonly nestingDepthIncrease: number
  readonly godModuleScore: number
  readonly compositeErosionScore: number
  readonly centrality: number
  readonly isCritical: boolean
  readonly cooldownRequired: boolean
  readonly recommendations: readonly string[]
}

export type VerbositySignal = {
  readonly rule: string
  readonly severity: "info" | "warning" | "blocker"
  readonly target: string
  readonly metricValue: number
  readonly threshold: number
  readonly evidence: string
  readonly fix: string
}

export type RefactorTriggerAction =
  | "EXTRACT_MODULE"
  | "INLINE_WRAPPER"
  | "CONSOLIDATE_DUPLICATES"
  | "FLATTEN_NESTING"
  | "REDUCE_FANOUT"

export type RefactorPlanStep = {
  readonly order: number
  readonly target: string
  readonly action: RefactorTriggerAction
  readonly description: string
  readonly estimatedRisk: "low" | "medium" | "high"
}

export type RefactorTriggerResult = {
  readonly triggered: boolean
  readonly triggers: readonly string[]
  readonly targetModules: readonly string[]
  readonly highestCentralityTarget?: string
  readonly plan: readonly RefactorPlanStep[]
}

export type SlopFinding = {
  readonly id: string
  readonly rule: string
  readonly severity: "info" | "warning" | "blocker"
  readonly file: string
  readonly line?: number
  readonly evidence: string
  readonly fix: string
  readonly hash?: string
}

export type CalibrationConfig = {
  readonly maturityLevel: "alpha" | "beta" | "production"
  readonly language: string
  readonly strictness: number
}

export type GoodhartWarning = {
  readonly gamingPattern: string
  readonly evidence: string
  readonly counterMetric: string
  readonly penalty: number
}

export type AblationProfile = {
  readonly name: string
  readonly enabledMechanisms: readonly string[]
  readonly weights: Record<string, number>
}

export type SlopGateResult = {
  readonly passed: boolean
  readonly score: number
  readonly threshold: number
  readonly blockers: readonly SlopFinding[]
  readonly warnings: readonly SlopFinding[]
  readonly trajectoryStatus?: TrajectoryDirection
  readonly goodhartWarnings: readonly GoodhartWarning[]
  readonly executionTimeMs: number
}
