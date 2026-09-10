import type {
  QualityDimensions,
  TrajectoryAlert,
  TrajectoryAnalysis,
  TrajectoryDirection,
  TurnQualityRecord,
} from "./types"

export type TrajectoryModelOptions = {
  readonly windowSize?: number
  readonly toleranceEpsilon?: number
  readonly varianceThreshold?: number
  readonly circuitBreakerLimit?: number
}

const DEFAULT_WINDOW_SIZE = 5
const DEFAULT_TOLERANCE_EPSILON = 0.05
const DEFAULT_VARIANCE_THRESHOLD = 0.03
const DEFAULT_CIRCUIT_BREAKER_LIMIT = 3

export function calculateVariance(values: readonly number[]): number {
  if (values.length <= 1) return 0
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length
  const squaredDiffs = values.map((v) => Math.pow(v - mean, 2))
  return squaredDiffs.reduce((sum, v) => sum + v, 0) / values.length
}

export function calculateDimensionsDelta(
  current: QualityDimensions,
  previous: QualityDimensions,
): Partial<QualityDimensions> {
  const delta: Partial<QualityDimensions> = {
    cyclomaticComplexity: current.cyclomaticComplexity - previous.cyclomaticComplexity,
    nestingDepth: current.nestingDepth - previous.nestingDepth,
    commentDensity: current.commentDensity - previous.commentDensity,
    identifierQuality: current.identifierQuality - previous.identifierQuality,
    fanOut: current.fanOut - previous.fanOut,
    abstractionRatio: current.abstractionRatio - previous.abstractionRatio,
  }
  return delta
}

export function analyzeTrajectory(
  history: readonly TurnQualityRecord[],
  options: TrajectoryModelOptions = {},
): TrajectoryAnalysis {
  const windowSize = options.windowSize ?? DEFAULT_WINDOW_SIZE
  const epsilon = options.toleranceEpsilon ?? DEFAULT_TOLERANCE_EPSILON
  const varianceThreshold = options.varianceThreshold ?? DEFAULT_VARIANCE_THRESHOLD
  const circuitBreakerLimit = options.circuitBreakerLimit ?? DEFAULT_CIRCUIT_BREAKER_LIMIT

  const window = history.slice(-windowSize)
  if (window.length < 2) {
    const emptyResult: TrajectoryAnalysis = {
      classification: "STABLE",
      deltaQ: 0,
      acceleratingDegradation: false,
      variance: 0,
      secondDerivative: 0,
      circuitBreakerTriggered: false,
      alerts: [],
      compoundingDebtDetected: false,
      consecutiveDegradingTurns: 0,
    }
    return emptyResult
  }

  const scores = window.map((r) => r.score)
  const current = window[window.length - 1]
  const previous = window[window.length - 2]
  const deltaQ = current.score - previous.score

  const deltas: number[] = []
  for (let i = 1; i < window.length; i++) {
    deltas.push(window[i].score - window[i - 1].score)
  }

  let consecutiveDegradingTurns = 0
  for (let i = deltas.length - 1; i >= 0; i--) {
    if (deltas[i] < -epsilon / 2) {
      consecutiveDegradingTurns++
    } else {
      break
    }
  }

  let consecutiveImprovingTurns = 0
  for (let i = deltas.length - 1; i >= 0; i--) {
    if (deltas[i] > epsilon / 2) {
      consecutiveImprovingTurns++
    } else {
      break
    }
  }

  const variance = calculateVariance(scores)

  let secondDerivative = 0
  if (window.length >= 3) {
    const prevDelta = window[window.length - 2].score - window[window.length - 3].score
    secondDerivative = deltaQ - prevDelta
  }

  const acceleratingDegradation = secondDerivative < -0.01 && deltaQ < 0

  let classification: TrajectoryDirection = "STABLE"
  const currentLoc = current.linesOfCode
  const prevLoc = previous.linesOfCode

  const hasAlternatingSigns =
    deltas.some((d) => d > epsilon / 2) && deltas.some((d) => d < -epsilon / 2)

  if (hasAlternatingSigns && variance > varianceThreshold) {
    classification = "VOLATILE"
  } else if (consecutiveDegradingTurns >= 2 || (deltas.length === 1 && deltaQ < -epsilon)) {
    classification = "DEGRADING"
  } else if (consecutiveImprovingTurns >= 2 || (deltas.length === 1 && deltaQ > epsilon)) {
    classification = "IMPROVING"
  } else if (
    currentLoc !== undefined &&
    prevLoc !== undefined &&
    currentLoc < prevLoc &&
    Math.abs(deltaQ) <= epsilon
  ) {
    classification = "COMPRESSION"
  } else if (
    currentLoc !== undefined &&
    prevLoc !== undefined &&
    currentLoc > prevLoc * 1.2 &&
    Math.abs(deltaQ) <= epsilon
  ) {
    classification = "EXPANSION"
  } else {
    const maxDelta = Math.max(...deltas.map(Math.abs))
    if (maxDelta <= epsilon) {
      classification = "STABLE"
    } else if (deltaQ < -epsilon) {
      classification = "DEGRADING"
    } else if (deltaQ > epsilon) {
      classification = "IMPROVING"
    }
  }

  const alerts: TrajectoryAlert[] = []
  const circuitBreakerTriggered = consecutiveDegradingTurns >= circuitBreakerLimit

  let turnOfOrigin: number | undefined
  if (consecutiveDegradingTurns > 0) {
    const originIdx = window.length - 1 - consecutiveDegradingTurns
    turnOfOrigin = window[Math.max(0, originIdx)].turn
  }

  if (circuitBreakerTriggered) {
    alerts.push({
      level: "critical",
      message: `Circuit breaker triggered: ${consecutiveDegradingTurns} consecutive degrading turns reached threshold of ${circuitBreakerLimit}`,
      turnOfOrigin,
      recommendation: "Halt modifications and remediate accumulated regressions.",
    })
  } else if (classification === "DEGRADING") {
    alerts.push({
      level: "warning",
      message: `Negative quality momentum detected (ΔQ = ${deltaQ.toFixed(3)}) across ${consecutiveDegradingTurns} turns`,
      turnOfOrigin,
      recommendation: "Review recent changes for unintended complexity or coupling before proceeding.",
    })
  }

  if (acceleratingDegradation) {
    alerts.push({
      level: "error",
      message: `Compounding degradation detected: degradation rate is accelerating (d²Q/dt² = ${secondDerivative.toFixed(3)})`,
      turnOfOrigin,
      recommendation: "Address the root cause of declining quality immediately to avoid exponential technical debt.",
    })
  }

  const dimDelta = calculateDimensionsDelta(current.dimensions, previous.dimensions)
  if (dimDelta.fanOut !== undefined && dimDelta.fanOut > 0 && previous.dimensions.fanOut > 0) {
    const pct = (dimDelta.fanOut / previous.dimensions.fanOut) * 100
    if (pct >= 30) {
      alerts.push({
        level: "warning",
        message: `Turn ${current.turn} increased module fan-out by ${pct.toFixed(0)}%`,
        turnOfOrigin: current.turn,
        recommendation: `Turn ${current.turn} introduced coupling that increased fan-out by ${pct.toFixed(0)}%. Consider reverting or refactoring before proceeding.`,
      })
    }
  }

  if (dimDelta.nestingDepth !== undefined && dimDelta.nestingDepth >= 2) {
    alerts.push({
      level: "warning",
      message: `Turn ${current.turn} introduced deep nesting (+${dimDelta.nestingDepth})`,
      turnOfOrigin: current.turn,
      recommendation: "Extract helper functions or use early guard clauses to flatten nesting.",
    })
  }

  let debtHalfLifeTurns: number | undefined
  if (deltaQ < 0) {
    const initialScore = window[0].score
    const totalLoss = Math.max(0, initialScore - current.score)
    const decayRate = Math.abs(deltaQ)
    if (decayRate > 0.001 && totalLoss > 0) {
      debtHalfLifeTurns = Math.max(1, Math.round(totalLoss / decayRate))
    }
  }

  const result: TrajectoryAnalysis = {
    classification,
    deltaQ,
    acceleratingDegradation,
    variance,
    secondDerivative,
    circuitBreakerTriggered,
    alerts,
    compoundingDebtDetected: acceleratingDegradation || consecutiveDegradingTurns >= 2,
    debtHalfLifeTurns,
    consecutiveDegradingTurns,
  }
  return result
}

export class TrajectoryQualityModel {
  private history: TurnQualityRecord[] = []
  private readonly options: TrajectoryModelOptions

  constructor(options: TrajectoryModelOptions = {}) {
    this.options = options
  }

  recordTurn(record: TurnQualityRecord): TrajectoryAnalysis {
    this.history.push(record)
    return this.analyze()
  }

  recordTurnScore(
    turn: number,
    score: number,
    dimensions: Partial<QualityDimensions> = {},
    linesOfCode?: number,
    testAssertionCount?: number,
  ): TrajectoryAnalysis {
    const fullDimensions: QualityDimensions = {
      cyclomaticComplexity: dimensions.cyclomaticComplexity ?? 1,
      nestingDepth: dimensions.nestingDepth ?? 1,
      commentDensity: dimensions.commentDensity ?? 0.1,
      identifierQuality: dimensions.identifierQuality ?? 1.0,
      fanOut: dimensions.fanOut ?? 1,
      abstractionRatio: dimensions.abstractionRatio ?? 0.5,
    }
    const record: TurnQualityRecord = {
      turn,
      score,
      dimensions: fullDimensions,
      linesOfCode,
      testAssertionCount,
    }
    return this.recordTurn(record)
  }

  analyze(): TrajectoryAnalysis {
    return analyzeTrajectory(this.history, this.options)
  }

  getHistory(): readonly TurnQualityRecord[] {
    return [...this.history]
  }

  reset(): void {
    this.history = []
  }
}

export * as Trajectory from "./trajectory"
