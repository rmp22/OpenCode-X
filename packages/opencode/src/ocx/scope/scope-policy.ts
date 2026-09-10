import type { ScopeEvaluation, ScopeLevel } from "./types"

export type PolicyInput = {
  readonly evaluation: ScopeEvaluation
  readonly intent: {
    readonly taskKind: string[]
    readonly minimalPatchRequested: boolean
    readonly qualityBar: string
  }
}

export type PolicyResult = {
  readonly scopeLevel: ScopeLevel
  readonly justification: string
  readonly requiresDeeperInvestigation: boolean
}

const LEVEL_NAMES: readonly ScopeLevel[] = [
  "local",
  "component",
  "feature",
  "subsystem",
  "structural",
]

function levelIndex(level: ScopeLevel): number {
  return LEVEL_NAMES.indexOf(level)
}

function getDimensionValue(
  dimensions: readonly { dimension: string; value: number }[],
  dimension: string,
): number {
  const found = dimensions.find((d) => d.dimension === dimension)
  return found?.value ?? 0
}

export function chooseScopeLevel(input: PolicyInput): PolicyResult {
  const { evaluation, intent } = input
  const { depth, width, coupling, risk, requestBreadth } = evaluation

  const criticalDimensions: string[] = []

  if (getDimensionValue(evaluation.dimensions, "coupling") >= 4) {
    criticalDimensions.push("coupling >= 4")
  }
  if (getDimensionValue(evaluation.dimensions, "risk") >= 4) {
    criticalDimensions.push("risk >= 4")
  }
  if (getDimensionValue(evaluation.dimensions, "request_breadth") >= 4) {
    criticalDimensions.push("request_breadth >= 4")
  }
  if (getDimensionValue(evaluation.dimensions, "depth") >= 4) {
    criticalDimensions.push("depth >= 4")
  }
  if (getDimensionValue(evaluation.dimensions, "width") >= 3) {
    criticalDimensions.push("width >= 3")
  }

  if (intent.taskKind.includes("architecture")) {
    return {
      scopeLevel: "structural",
      justification: "Architecture change requested; structural scope is required",
      requiresDeeperInvestigation: true,
    }
  }

  if (criticalDimensions.length > 0) {
    const hasCouplingOrRisk = criticalDimensions.some(
      (d) => d.startsWith("coupling") || d.startsWith("risk"),
    )
    if (hasCouplingOrRisk && coupling >= 4) {
      return {
        scopeLevel: width >= 3 ? "feature" : "component",
        justification: `Critical coupling (${coupling}) or risk (${risk}) requires at least component scope; width=${width} suggests feature scope`,
        requiresDeeperInvestigation: true,
      }
    }
    if (requestBreadth >= 4) {
      return {
        scopeLevel: "feature",
        justification: `Request breadth ${requestBreadth} requires feature-level scope`,
        requiresDeeperInvestigation: true,
      }
    }
    if (depth >= 4) {
      return {
        scopeLevel: "feature",
        justification: `Depth ${depth} indicates feature-level change`,
        requiresDeeperInvestigation: true,
      }
    }
  }

  if (intent.minimalPatchRequested && coupling <= 2 && risk <= 2) {
    return {
      scopeLevel: "local",
      justification: "Minimal patch explicitly requested and coupling/risk are low",
      requiresDeeperInvestigation: false,
    }
  }

  if (coupling <= 1 && risk <= 1 && depth <= 1 && width <= 1) {
    return {
      scopeLevel: "local",
      justification: "All dimensions are low; root cause appears isolated",
      requiresDeeperInvestigation: false,
    }
  }

  if (coupling <= 2 && risk <= 2) {
    return {
      scopeLevel: "component",
      justification: "Moderate coupling and risk; component scope is appropriate",
      requiresDeeperInvestigation: false,
    }
  }

  if (width >= 3 || coupling >= 3) {
    return {
      scopeLevel: "feature",
      justification: `Width ${width} or coupling ${coupling} indicates feature-level scope`,
      requiresDeeperInvestigation: true,
    }
  }

  if (risk >= 4) {
    return {
      scopeLevel: "subsystem",
      justification: `Risk ${risk} requires subsystem-level verification even if other dimensions are low`,
      requiresDeeperInvestigation: true,
    }
  }

  return {
    scopeLevel: "component",
    justification: "Default to component scope for moderate complexity tasks",
    requiresDeeperInvestigation: false,
  }
}

export * as ScopePolicy from "./scope-policy"
