import type { StructuralErosionHotspot } from "./types"

export type FileState = {
  readonly exportCount?: number
  readonly methodCount?: number
  readonly lineCount?: number
  readonly maxNestingDepth?: number
  readonly outgoingDependencies?: readonly string[] | number
  readonly centrality?: number
}

export type FileObservation = {
  readonly turn: number
  readonly file: string
  readonly state: FileState
  readonly modified: boolean
}

export type ErosionOptions = {
  readonly churnThreshold?: number
  readonly fanOutGrowthThreshold?: number
  readonly nestingCreepThreshold?: number
  readonly godModuleLineThreshold?: number
  readonly godModuleExportThreshold?: number
}

const DEFAULT_CHURN_THRESHOLD = 0.5
const DEFAULT_FANOUT_GROWTH_THRESHOLD = 50
const DEFAULT_NESTING_CREEP_THRESHOLD = 2
const DEFAULT_GOD_LINE_THRESHOLD = 500
const DEFAULT_GOD_EXPORT_THRESHOLD = 15

export function computeGodModuleScore(state: FileState, options: ErosionOptions = {}): number {
  const lineThreshold = options.godModuleLineThreshold ?? DEFAULT_GOD_LINE_THRESHOLD
  const exportThreshold = options.godModuleExportThreshold ?? DEFAULT_GOD_EXPORT_THRESHOLD

  const lineScore = Math.min(1.0, (state.lineCount ?? 0) / lineThreshold)
  const exportScore = Math.min(1.0, (state.exportCount ?? 0) / exportThreshold)
  const methodScore = Math.min(1.0, (state.methodCount ?? 0) / 25)

  const score = parseFloat(((lineScore * 0.4 + exportScore * 0.35 + methodScore * 0.25)).toFixed(2))
  return score
}

export function analyzeFileErosion(
  file: string,
  observations: readonly FileObservation[],
  totalTurns: number,
  options: ErosionOptions = {},
): StructuralErosionHotspot {
  const churnThreshold = options.churnThreshold ?? DEFAULT_CHURN_THRESHOLD
  const fanOutGrowthThreshold = options.fanOutGrowthThreshold ?? DEFAULT_FANOUT_GROWTH_THRESHOLD
  const nestingCreepThreshold = options.nestingCreepThreshold ?? DEFAULT_NESTING_CREEP_THRESHOLD

  const modifiedTurns = observations.filter((o) => o.modified).length
  const effectiveTotalTurns = Math.max(1, totalTurns)
  const churnPercentage = parseFloat(((modifiedTurns / effectiveTotalTurns) * 100).toFixed(1))

  const sorted = [...observations].sort((a, b) => a.turn - b.turn)
  const initial = sorted[0]?.state ?? {}
  const latest = sorted[sorted.length - 1]?.state ?? {}

  const initialFanOut =
    typeof initial.outgoingDependencies === "number"
      ? initial.outgoingDependencies
      : (initial.outgoingDependencies?.length ?? 0)

  const latestFanOut =
    typeof latest.outgoingDependencies === "number"
      ? latest.outgoingDependencies
      : (latest.outgoingDependencies?.length ?? 0)

  let fanOutIncreasePercentage = 0
  if (initialFanOut > 0) {
    fanOutIncreasePercentage = parseFloat(
      (((latestFanOut - initialFanOut) / initialFanOut) * 100).toFixed(1),
    )
  } else if (latestFanOut > 0) {
    fanOutIncreasePercentage = 100.0
  }

  const initialNesting = initial.maxNestingDepth ?? 1
  const latestNesting = latest.maxNestingDepth ?? 1
  const nestingDepthIncrease = Math.max(0, latestNesting - initialNesting)

  const godModuleScore = computeGodModuleScore(latest, options)
  const centrality = latest.centrality ?? initial.centrality ?? 0.1

  const churnFactor = Math.min(1.0, churnPercentage / 100)
  const fanOutFactor = Math.min(1.0, Math.max(0, fanOutIncreasePercentage) / 100)
  const nestingFactor = Math.min(1.0, nestingDepthIncrease / 5)

  const baseScore = churnFactor * 0.35 + fanOutFactor * 0.25 + nestingFactor * 0.2 + godModuleScore * 0.2
  const centralityMultiplier = 0.6 + 0.4 * Math.min(1.0, centrality)
  const compositeErosionScore = parseFloat(Math.min(1.0, baseScore * centralityMultiplier).toFixed(2))

  const recommendations: string[] = []
  const cooldownRequired = churnPercentage > churnThreshold * 100

  if (cooldownRequired) {
    recommendations.push(
      `File modified in ${churnPercentage}% of turns. Cooldown required: refactor into smaller modules before editing further.`,
    )
  }

  if (fanOutIncreasePercentage >= fanOutGrowthThreshold) {
    recommendations.push(
      `Outgoing dependencies grew by ${fanOutIncreasePercentage}%. Decompose dependencies or introduce an intermediary facade.`,
    )
  }

  if (nestingDepthIncrease >= nestingCreepThreshold) {
    recommendations.push(
      `Maximum nesting depth increased by ${nestingDepthIncrease}. Apply early-return guard clauses to flatten control flow.`,
    )
  }

  if (godModuleScore >= 0.7) {
    recommendations.push(
      `File exhibits god module characteristics (score: ${godModuleScore}). Consider splitting into cohesive submodules.`,
    )
  }

  const isCritical = centrality >= 0.5 || compositeErosionScore >= 0.6

  const hotspot: StructuralErosionHotspot = {
    file,
    churnPercentage,
    fanOutIncreasePercentage,
    nestingDepthIncrease,
    godModuleScore,
    compositeErosionScore,
    centrality,
    isCritical,
    cooldownRequired,
    recommendations,
  }
  return hotspot
}

export class StructuralErosionTracker {
  private observations: FileObservation[] = []
  private currentTurn = 0
  private readonly options: ErosionOptions

  constructor(options: ErosionOptions = {}) {
    this.options = options
  }

  recordObservation(observation: FileObservation): void {
    if (observation.turn > this.currentTurn) {
      this.currentTurn = observation.turn
    }
    this.observations.push(observation)
  }

  recordTurn(
    turn: number,
    modifiedFiles: readonly string[],
    fileStates: Record<string, FileState> = {},
  ): readonly StructuralErosionHotspot[] {
    this.currentTurn = Math.max(this.currentTurn, turn)
    const modifiedSet = new Set(modifiedFiles)

    const allTrackedFiles = new Set([
      ...modifiedFiles,
      ...Object.keys(fileStates),
      ...this.observations.map((o) => o.file),
    ])

    for (const file of allTrackedFiles) {
      const isMod = modifiedSet.has(file)
      const state = fileStates[file] ?? this.getLatestState(file) ?? {}
      this.recordObservation({
        turn,
        file,
        state,
        modified: isMod,
      })
    }

    return this.analyzeHotspots()
  }

  private getLatestState(file: string): FileState | undefined {
    const fileObs = this.observations.filter((o) => o.file === file)
    return fileObs[fileObs.length - 1]?.state
  }

  analyzeHotspots(): readonly StructuralErosionHotspot[] {
    const files = Array.from(new Set(this.observations.map((o) => o.file)))
    const hotspots = files.map((f) => {
      const fileObs = this.observations.filter((o) => o.file === f)
      return analyzeFileErosion(f, fileObs, this.currentTurn, this.options)
    })
    return hotspots.sort((a, b) => b.compositeErosionScore - a.compositeErosionScore)
  }

  reset(): void {
    this.observations = []
    this.currentTurn = 0
  }
}

export * as StructuralErosion from "./erosion"
