import type {
  RefactorPlanStep,
  RefactorTriggerAction,
  RefactorTriggerResult,
  StructuralErosionHotspot,
  TrajectoryAnalysis,
  TurnAttribution,
  VerbositySignal,
} from "./types"

export class SimpleDependencyGraph {
  private inEdges = new Map<string, Set<string>>()
  private outEdges = new Map<string, Set<string>>()
  private allNodes = new Set<string>()

  addNode(id: string): void {
    this.allNodes.add(id)
    if (!this.inEdges.has(id)) this.inEdges.set(id, new Set())
    if (!this.outEdges.has(id)) this.outEdges.set(id, new Set())
  }

  addEdge(from: string, to: string): void {
    this.addNode(from)
    this.addNode(to)
    this.outEdges.get(from)!.add(to)
    this.inEdges.get(to)!.add(from)
  }

  getInDegree(id: string): number {
    return this.inEdges.get(id)?.size ?? 0
  }

  getOutDegree(id: string): number {
    return this.outEdges.get(id)?.size ?? 0
  }

  getNodes(): readonly string[] {
    return Array.from(this.allNodes)
  }

  topologicalSort(nodes?: readonly string[]): readonly string[] {
    const subset = new Set(nodes ?? this.allNodes)
    const inDegrees = new Map<string, number>()

    for (const node of subset) {
      let deg = 0
      const inSet = this.inEdges.get(node)
      if (inSet) {
        for (const parent of inSet) {
          if (subset.has(parent)) deg++
        }
      }
      inDegrees.set(node, deg)
    }

    const queue: string[] = []
    for (const [node, deg] of inDegrees) {
      if (deg === 0) queue.push(node)
    }

    const sorted: string[] = []
    while (queue.length > 0) {
      const current = queue.shift()!
      sorted.push(current)

      const outSet = this.outEdges.get(current)
      if (outSet) {
        for (const child of outSet) {
          if (subset.has(child)) {
            const newDeg = (inDegrees.get(child) ?? 1) - 1
            inDegrees.set(child, newDeg)
            if (newDeg === 0) queue.push(child)
          }
        }
      }
    }

    for (const node of subset) {
      if (!sorted.includes(node)) sorted.push(node)
    }

    return sorted
  }
}

export type RefactorTriggerInput = {
  readonly hotspots?: readonly StructuralErosionHotspot[]
  readonly duplicationSignals?: readonly VerbositySignal[]
  readonly trajectory?: TrajectoryAnalysis
  readonly attribution?: TurnAttribution
  readonly graph?: SimpleDependencyGraph
}

export function evaluateRefactorTriggers(input: RefactorTriggerInput): RefactorTriggerResult {
  const triggers: string[] = []
  const targetModules = new Set<string>()

  if (input.hotspots) {
    for (const h of input.hotspots) {
      if (h.compositeErosionScore > 0.6 || (h.isCritical && h.compositeErosionScore > 0.5)) {
        triggers.push(
          `Structural erosion on ${h.file} (${h.compositeErosionScore}) crosses critical threshold 0.6`,
        )
        targetModules.add(h.file)
      }
    }
  }

  if (input.duplicationSignals) {
    const dupSignals = input.duplicationSignals.filter(
      (s) => s.rule === "anti-slop/duplicate-code" && s.metricValue >= 0.8,
    )
    if (dupSignals.length >= 1) {
      triggers.push(
        `High duplicate code similarity (>= 0.8) detected across multiple locations`,
      )
      for (const sig of dupSignals) {
        const parts = sig.target.split(" <=> ")
        for (const p of parts) targetModules.add(p.trim())
      }
    }
  }

  if (input.trajectory) {
    if (input.trajectory.consecutiveDegradingTurns >= 2) {
      triggers.push(
        `Quality trajectory is DEGRADING for ${input.trajectory.consecutiveDegradingTurns} consecutive turns`,
      )
    }
  }

  if (input.attribution) {
    if (input.attribution.blastRadius > 3.0) {
      triggers.push(
        `Diff blast radius (${input.attribution.blastRadius}) exceeds collateral threshold 3.0`,
      )
      for (const chunk of input.attribution.chunks) {
        if (chunk.category === "INCIDENTAL_EROSION") {
          targetModules.add(chunk.file)
        }
      }
    }
  }

  const triggered = triggers.length > 0
  const targetsArray = Array.from(targetModules)

  let highestCentralityTarget: string | undefined
  if (input.graph && targetsArray.length > 0) {
    let maxInDegree = -1
    for (const mod of targetsArray) {
      const inDeg = input.graph.getInDegree(mod)
      if (inDeg > maxInDegree) {
        maxInDegree = inDeg
        highestCentralityTarget = mod
      }
    }
  } else if (targetsArray.length > 0) {
    highestCentralityTarget = targetsArray[0]
  }

  const sortedTargets = input.graph
    ? input.graph.topologicalSort(targetsArray)
    : targetsArray

  const plan: RefactorPlanStep[] = []
  let stepOrder = 1

  for (const target of sortedTargets) {
    const hotspot = input.hotspots?.find((h) => h.file === target)

    if (hotspot && hotspot.godModuleScore >= 0.6) {
      plan.push({
        order: stepOrder++,
        target,
        action: "EXTRACT_MODULE",
        description: `Extract cohesive submodules from ${target} to decompose god module.`,
        estimatedRisk: "medium",
      })
    }

    if (hotspot && hotspot.nestingDepthIncrease >= 2) {
      plan.push({
        order: stepOrder++,
        target,
        action: "FLATTEN_NESTING",
        description: `Apply guard clauses and early returns to flatten nesting in ${target}.`,
        estimatedRisk: "low",
      })
    }

    if (hotspot && hotspot.fanOutIncreasePercentage >= 50) {
      plan.push({
        order: stepOrder++,
        target,
        action: "REDUCE_FANOUT",
        description: `Introduce facade or intermediary service to reduce fan-out in ${target}.`,
        estimatedRisk: "medium",
      })
    }

    const hasDup = input.duplicationSignals?.some(
      (s) => s.target.includes(target) && s.rule === "anti-slop/duplicate-code",
    )
    if (hasDup) {
      plan.push({
        order: stepOrder++,
        target,
        action: "CONSOLIDATE_DUPLICATES",
        description: `Consolidate duplicated near-clone logic from ${target} into shared utility.`,
        estimatedRisk: "low",
      })
    }

    const hasWrapper = input.duplicationSignals?.some(
      (s) => s.target.includes(target) && s.rule === "anti-slop/wrapper-bloat",
    )
    if (hasWrapper) {
      plan.push({
        order: stepOrder++,
        target,
        action: "INLINE_WRAPPER",
        description: `Inline single-use pass-through wrapper functions in ${target}.`,
        estimatedRisk: "low",
      })
    }
  }

  const result: RefactorTriggerResult = {
    triggered,
    triggers,
    targetModules: targetsArray,
    highestCentralityTarget,
    plan,
  }
  return result
}

export * as RefactorTrigger from "./refactor-trigger"
