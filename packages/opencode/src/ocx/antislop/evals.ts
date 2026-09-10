import { TrajectoryQualityModel } from "./trajectory"
import type { TrajectoryDirection } from "./types"

export type SyntheticTurn = {
  readonly turn: number
  readonly file: string
  readonly score: number
  readonly linesOfCode?: number
  readonly isIntentionalRefactor?: boolean
  readonly debtIntroduced?: boolean
}

export type SessionSimulation = {
  readonly id: string
  readonly description: string
  readonly type: "positive" | "negative" | "edge_case"
  readonly turns: readonly SyntheticTurn[]
  readonly groundTruthTrajectory: TrajectoryDirection
  readonly debtIntroducedAtTurn?: number
}

export type HarnessRunResult = {
  readonly sessionId: string
  readonly sessionType: string
  readonly totalTurns: number
  readonly predictedTrajectory: TrajectoryDirection
  readonly groundTruthTrajectory: TrajectoryDirection
  readonly driftDetected: boolean
  readonly driftDetectionLatencyTurns?: number
  readonly falsePositive: boolean
  readonly alertsCount: number
}

export type HarnessSummaryMetrics = {
  readonly totalSessions: number
  readonly accuracy: number
  readonly precision: number
  readonly recall: number
  readonly f1Score: number
  readonly falsePositiveRate: number
  readonly avgDetectionLatency: number
}

export function createBenchmarkSessions(): readonly SessionSimulation[] {
  const sessions: SessionSimulation[] = [
    {
      id: "pos-3turn-clean-refactor",
      description: "Clean refactoring reducing complexity across 3 turns",
      type: "positive",
      groundTruthTrajectory: "IMPROVING",
      turns: [
        { turn: 1, file: "src/calc.ts", score: 0.7, linesOfCode: 150, isIntentionalRefactor: true },
        { turn: 2, file: "src/calc.ts", score: 0.8, linesOfCode: 120, isIntentionalRefactor: true },
        { turn: 3, file: "src/calc.ts", score: 0.9, linesOfCode: 95, isIntentionalRefactor: true },
      ],
    },
    {
      id: "pos-5turn-feature-build",
      description: "Feature development with tests improving quality across 5 turns",
      type: "positive",
      groundTruthTrajectory: "IMPROVING",
      turns: [
        { turn: 1, file: "src/auth.ts", score: 0.65, linesOfCode: 80 },
        { turn: 2, file: "src/auth.ts", score: 0.72, linesOfCode: 100 },
        { turn: 3, file: "src/auth.ts", score: 0.79, linesOfCode: 120 },
        { turn: 4, file: "src/auth.ts", score: 0.85, linesOfCode: 135 },
        { turn: 5, file: "src/auth.ts", score: 0.91, linesOfCode: 140 },
      ],
    },
    {
      id: "neg-3turn-quick-degrade",
      description: "Fast quality degradation over 3 turns",
      type: "negative",
      groundTruthTrajectory: "DEGRADING",
      debtIntroducedAtTurn: 1,
      turns: [
        { turn: 1, file: "src/sync.ts", score: 0.8, linesOfCode: 50, debtIntroduced: true },
        { turn: 2, file: "src/sync.ts", score: 0.68, linesOfCode: 80, debtIntroduced: true },
        { turn: 3, file: "src/sync.ts", score: 0.52, linesOfCode: 120, debtIntroduced: true },
      ],
    },
    {
      id: "neg-5turn-subtle-drift",
      description: "Subtle debt compounding over 5 turns",
      type: "negative",
      groundTruthTrajectory: "DEGRADING",
      debtIntroducedAtTurn: 2,
      turns: [
        { turn: 1, file: "src/api.ts", score: 0.88, linesOfCode: 100 },
        { turn: 2, file: "src/api.ts", score: 0.82, linesOfCode: 130, debtIntroduced: true },
        { turn: 3, file: "src/api.ts", score: 0.75, linesOfCode: 165, debtIntroduced: true },
        { turn: 4, file: "src/api.ts", score: 0.66, linesOfCode: 200, debtIntroduced: true },
        { turn: 5, file: "src/api.ts", score: 0.55, linesOfCode: 250, debtIntroduced: true },
      ],
    },
    {
      id: "neg-10turn-erosion",
      description: "Long session with progressive architectural erosion",
      type: "negative",
      groundTruthTrajectory: "DEGRADING",
      debtIntroducedAtTurn: 3,
      turns: [
        { turn: 1, file: "src/state.ts", score: 0.9, linesOfCode: 80 },
        { turn: 2, file: "src/state.ts", score: 0.89, linesOfCode: 85 },
        { turn: 3, file: "src/state.ts", score: 0.82, linesOfCode: 110, debtIntroduced: true },
        { turn: 4, file: "src/state.ts", score: 0.77, linesOfCode: 140, debtIntroduced: true },
        { turn: 5, file: "src/state.ts", score: 0.71, linesOfCode: 180, debtIntroduced: true },
        { turn: 6, file: "src/state.ts", score: 0.65, linesOfCode: 220, debtIntroduced: true },
        { turn: 7, file: "src/state.ts", score: 0.58, linesOfCode: 270, debtIntroduced: true },
        { turn: 8, file: "src/state.ts", score: 0.52, linesOfCode: 320, debtIntroduced: true },
        { turn: 9, file: "src/state.ts", score: 0.45, linesOfCode: 380, debtIntroduced: true },
        { turn: 10, file: "src/state.ts", score: 0.38, linesOfCode: 450, debtIntroduced: true },
      ],
    },
    {
      id: "edge-5turn-stable-formatting",
      description: "Pure formatting and cosmetic edits maintaining stable quality",
      type: "edge_case",
      groundTruthTrajectory: "STABLE",
      turns: [
        { turn: 1, file: "src/format.ts", score: 0.85, linesOfCode: 100 },
        { turn: 2, file: "src/format.ts", score: 0.84, linesOfCode: 100 },
        { turn: 3, file: "src/format.ts", score: 0.85, linesOfCode: 102 },
        { turn: 4, file: "src/format.ts", score: 0.86, linesOfCode: 101 },
        { turn: 5, file: "src/format.ts", score: 0.85, linesOfCode: 100 },
      ],
    },
    {
      id: "pos-10turn-sustainable-evolution",
      description: "10-turn sustainable system expansion with tests and modularity",
      type: "positive",
      groundTruthTrajectory: "IMPROVING",
      turns: [
        { turn: 1, file: "src/service.ts", score: 0.7, linesOfCode: 60 },
        { turn: 2, file: "src/service.ts", score: 0.73, linesOfCode: 75 },
        { turn: 3, file: "src/service.ts", score: 0.77, linesOfCode: 90 },
        { turn: 4, file: "src/service.ts", score: 0.8, linesOfCode: 105 },
        { turn: 5, file: "src/service.ts", score: 0.82, linesOfCode: 110 },
        { turn: 6, file: "src/service.ts", score: 0.85, linesOfCode: 115 },
        { turn: 7, file: "src/service.ts", score: 0.88, linesOfCode: 120 },
        { turn: 8, file: "src/service.ts", score: 0.9, linesOfCode: 120 },
        { turn: 9, file: "src/service.ts", score: 0.92, linesOfCode: 125 },
        { turn: 10, file: "src/service.ts", score: 0.94, linesOfCode: 130 },
      ],
    },
  ]
  return sessions
}

export function runSimulation(session: SessionSimulation): HarnessRunResult {
  const model = new TrajectoryQualityModel()
  let driftDetected = false
  let driftDetectionTurn: number | undefined
  let alertsCount = 0

  for (const t of session.turns) {
    const analysis = model.recordTurnScore(t.turn, t.score, {}, t.linesOfCode)
    alertsCount += analysis.alerts.length

    if (
      !driftDetected &&
      (analysis.classification === "DEGRADING" || analysis.compoundingDebtDetected)
    ) {
      driftDetected = true
      driftDetectionTurn = t.turn
    }
  }

  const finalAnalysis = model.analyze()
  const predictedTrajectory = finalAnalysis.classification

  let driftDetectionLatencyTurns: number | undefined
  if (driftDetected && session.debtIntroducedAtTurn !== undefined && driftDetectionTurn !== undefined) {
    driftDetectionLatencyTurns = Math.max(0, driftDetectionTurn - session.debtIntroducedAtTurn)
  }

  const isPositiveOrStable =
    session.groundTruthTrajectory === "IMPROVING" || session.groundTruthTrajectory === "STABLE"
  const falsePositive =
    isPositiveOrStable &&
    (predictedTrajectory === "DEGRADING" || predictedTrajectory === "VOLATILE")

  const result: HarnessRunResult = {
    sessionId: session.id,
    sessionType: session.type,
    totalTurns: session.turns.length,
    predictedTrajectory,
    groundTruthTrajectory: session.groundTruthTrajectory,
    driftDetected,
    driftDetectionLatencyTurns,
    falsePositive,
    alertsCount,
  }
  return result
}

export function runBenchmarkSuite(
  customSessions?: readonly SessionSimulation[],
): HarnessSummaryMetrics {
  const sessions = customSessions ?? createBenchmarkSessions()
  const results = sessions.map(runSimulation)

  let truePositives = 0
  let falsePositives = 0
  let trueNegatives = 0
  let falseNegatives = 0
  let totalLatency = 0
  let latencyCount = 0
  let correctCount = 0

  for (const r of results) {
    const isDegradingTruth = r.groundTruthTrajectory === "DEGRADING"
    const isDegradingPred = r.predictedTrajectory === "DEGRADING"

    if (r.predictedTrajectory === r.groundTruthTrajectory) {
      correctCount++
    }

    if (isDegradingTruth && isDegradingPred) {
      truePositives++
    } else if (!isDegradingTruth && isDegradingPred) {
      falsePositives++
    } else if (!isDegradingTruth && !isDegradingPred) {
      trueNegatives++
    } else if (isDegradingTruth && !isDegradingPred) {
      falseNegatives++
    }

    if (r.driftDetectionLatencyTurns !== undefined) {
      totalLatency += r.driftDetectionLatencyTurns
      latencyCount++
    }
  }

  const accuracy = parseFloat((correctCount / sessions.length).toFixed(3))
  const precision =
    truePositives + falsePositives > 0
      ? parseFloat((truePositives / (truePositives + falsePositives)).toFixed(3))
      : 1.0
  const recall =
    truePositives + falseNegatives > 0
      ? parseFloat((truePositives / (truePositives + falseNegatives)).toFixed(3))
      : 1.0

  const f1Score =
    precision + recall > 0
      ? parseFloat(((2 * precision * recall) / (precision + recall)).toFixed(3))
      : 0.0

  const negativeGroundTruthCount = falsePositives + trueNegatives
  const falsePositiveRate =
    negativeGroundTruthCount > 0
      ? parseFloat((falsePositives / negativeGroundTruthCount).toFixed(3))
      : 0.0

  const avgDetectionLatency =
    latencyCount > 0 ? parseFloat((totalLatency / latencyCount).toFixed(2)) : 0.0

  const summary: HarnessSummaryMetrics = {
    totalSessions: sessions.length,
    accuracy,
    precision,
    recall,
    f1Score,
    falsePositiveRate,
    avgDetectionLatency,
  }
  return summary
}

export * as MultiTurnEvals from "./evals"
