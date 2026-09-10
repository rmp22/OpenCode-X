import type { DimensionScore, ScopeEvaluation, ScopeDimension } from "./types"

const DIMENSION_MIN = 0
const DIMENSION_MAX = 5

export type EvaluationInput = {
  readonly depth: number
  readonly width: number
  readonly coupling: number
  readonly risk: number
  readonly requestBreadth: number
}

export type EvaluationResult = {
  readonly evaluation: ScopeEvaluation
  readonly scopeLevel: string
}

function clamp(value: number): number {
  return Math.max(DIMENSION_MIN, Math.min(DIMENSION_MAX, value))
}

function confidenceFromConsistency(scores: readonly number[]): number {
  if (scores.length === 0) return 0.5
  const mean = scores.reduce((sum, s) => sum + s, 0) / scores.length
  const variance = scores.reduce((sum, s) => sum + (s - mean) ** 2, 0) / scores.length
  const maxVariance = 4.0
  const normalizedVariance = Math.min(variance / maxVariance, 1)
  return Math.round((1 - normalizedVariance) * 100) / 100
}

function dimensionScore(
  dimension: ScopeDimension,
  value: number,
  rationale: string,
): DimensionScore {
  return { dimension, value: clamp(value), min: DIMENSION_MIN, max: DIMENSION_MAX, rationale }
}

export function evaluateScope(input: EvaluationInput): ScopeEvaluation {
  const dimensions: readonly DimensionScore[] = [
    dimensionScore("depth", input.depth, "How deep into the code does the change need to go"),
    dimensionScore("width", input.width, "How many locations or components are affected"),
    dimensionScore("coupling", input.coupling, "How coupled the affected code is to other systems"),
    dimensionScore("risk", input.risk, "Risk level of the affected behavior"),
    dimensionScore("request_breadth", input.requestBreadth, "Breadth of the user's request"),
  ]

  const values = dimensions.map((d) => d.value)
  const confidence = confidenceFromConsistency(values)

  return {
    depth: clamp(input.depth),
    width: clamp(input.width),
    coupling: clamp(input.coupling),
    risk: clamp(input.risk),
    requestBreadth: clamp(input.requestBreadth),
    confidence,
    dimensions,
  }
}

export function evaluateFromExploration(
  explorationFindings: readonly { type: string; confidence: number }[],
  intent: { taskKind: string[]; qualityBar: string },
): ScopeEvaluation {
  let depth = 1
  let width = 1
  let coupling = 1
  let risk = 1
  let requestBreadth = 1

  for (const finding of explorationFindings) {
    const c = finding.confidence
    switch (finding.type) {
      case "root_cause":
        depth = Math.max(depth, Math.round(c * 4))
        break
      case "related_implementation":
        width = Math.max(width, Math.round(c * 3))
        coupling = Math.max(coupling, Math.round(c * 3))
        break
      case "state_path":
        coupling = Math.max(coupling, Math.round(c * 4))
        risk = Math.max(risk, Math.round(c * 3))
        break
      case "test":
        width = Math.max(width, 1)
        break
      case "uncertainty":
        depth = Math.max(depth, 2)
        coupling = Math.max(coupling, 2)
        break
    }
  }

  if (intent.taskKind.includes("architecture")) depth = Math.max(depth, 4)
  if (intent.taskKind.includes("cleanup")) requestBreadth = Math.max(requestBreadth, 3)
  if (intent.taskKind.includes("hardening")) requestBreadth = Math.max(requestBreadth, 3)
  if (intent.taskKind.includes("productionReadiness")) requestBreadth = Math.max(requestBreadth, 4)
  if (intent.qualityBar === "production") requestBreadth = Math.max(requestBreadth, 4)
  if (intent.qualityBar === "comprehensive") requestBreadth = Math.max(requestBreadth, 3)

  return evaluateScope({ depth, width, coupling, risk, requestBreadth })
}

export * as ScopeEvaluator from "./scope-evaluator"
