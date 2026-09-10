export type ToolCallPlan = {
  readonly name?: string
  readonly tool?: string
  readonly input?: { readonly filePath?: string; readonly path?: string }
  readonly kind?: "read" | "write" | "edit" | "command" | "barrier"
  readonly path?: string
  readonly dependsOn?: readonly string[]
  readonly sequential?: boolean
  readonly independent?: boolean
  readonly batched?: boolean
}

export type BatchHazard = {
  readonly kind: "duplicate-read" | "dependency" | "dependent-mutation" | "barrier"
  readonly message: string
  readonly calls: readonly string[]
}

export type BatchAnalysis = {
  readonly parallelGroups: readonly (readonly ToolCallPlan[])[]
  readonly sequentialRequired: readonly ToolCallPlan[]
  readonly hazards: readonly BatchHazard[]
  readonly safeToParallelizeAll: boolean
  readonly missedParallelism: boolean
  readonly recommendations: readonly string[]
}

export type InefficiencyReport = {
  readonly repeatedReads: readonly string[]
  readonly missedParallelism: boolean
  readonly unsafeParallelism: boolean
  readonly recommendations: readonly string[]
}

export function analyzeBatch(calls: readonly ToolCallPlan[]): BatchAnalysis {
  const parallelGroups: ToolCallPlan[][] = []
  const sequentialRequired: ToolCallPlan[] = []
  const hazards: BatchHazard[] = []
  const pendingReads: ToolCallPlan[] = []
  const pendingReadKeys = new Set<string>()
  const mutatedKeys = new Set<string>()

  const flushReads = () => {
    if (pendingReads.length === 0) return
    parallelGroups.push([...pendingReads])
    pendingReads.length = 0
    pendingReadKeys.clear()
  }

  for (const call of calls) {
    const kind = operationKind(call)
    const key = operationKey(call)
    const dependencies = call.dependsOn ?? []
    if (kind === "read" && call.independent !== false && !call.sequential && dependencies.length === 0) {
      if (key && pendingReadKeys.has(key)) {
        flushReads()
        sequentialRequired.push(call)
        parallelGroups.push([call])
        hazards.push({ kind: "duplicate-read", message: `duplicate read for ${key} stays ordered`, calls: [operationName(call), key] })
        continue
      }
      if (key) pendingReadKeys.add(key)
      pendingReads.push(call)
      continue
    }

    flushReads()
    sequentialRequired.push(call)
    parallelGroups.push([call])
    if (kind === "barrier" || call.sequential) hazards.push({ kind: "barrier", message: `${operationName(call)} is an explicit sequential barrier`, calls: [operationName(call)] })
    if (dependencies.length > 0) hazards.push({ kind: kind === "write" || kind === "edit" ? "dependent-mutation" : "dependency", message: `${operationName(call)} depends on ${dependencies.join(", ")}`, calls: [operationName(call), ...dependencies] })
    if (kind === "write" || kind === "edit" || kind === "command") {
      if (key && mutatedKeys.has(key)) hazards.push({ kind: "dependent-mutation", message: `mutations for ${key} stay ordered`, calls: [operationName(call), key] })
      if (key) mutatedKeys.add(key)
    }
  }
  flushReads()

  const parallelReadGroups = parallelGroups.filter((group) => group.length > 1 && group.every((call) => operationKind(call) === "read"))
  const unsafeParallelism = hazards.some((hazard) => hazard.kind === "dependent-mutation" || hazard.kind === "dependency")
  const recommendations = [
    ...(parallelReadGroups.length > 0 ? ["Batch only independent read-only groups; keep their original order around barriers."] : []),
    ...(hazards.some((hazard) => hazard.kind === "duplicate-read") ? ["Avoid duplicate reads instead of running them concurrently."] : []),
    ...(unsafeParallelism ? ["Keep dependent mutations and explicitly dependent calls sequential."] : []),
    ...(hazards.some((hazard) => hazard.kind === "barrier") ? ["Treat explicit sequential barriers as ordering constraints."] : []),
  ]
  return {
    parallelGroups,
    sequentialRequired,
    hazards,
    safeToParallelizeAll: calls.length > 0 && calls.every((call) => operationKind(call) === "read" && call.independent !== false && !call.sequential && (call.dependsOn?.length ?? 0) === 0) && hazards.length === 0,
    missedParallelism: parallelReadGroups.length > 0 && parallelReadGroups.some((group) => group.some((call) => call.batched !== true)),
    recommendations,
  }
}

export function detectInefficiencies(calls: readonly ToolCallPlan[]): InefficiencyReport {
  const analysis = analyzeBatch(calls)
  return {
    repeatedReads: analysis.hazards.filter((hazard) => hazard.kind === "duplicate-read").map((hazard) => hazard.calls[1]!).filter((path): path is string => path !== undefined),
    missedParallelism: analysis.missedParallelism,
    unsafeParallelism: analysis.hazards.some((hazard) => hazard.kind === "dependent-mutation" || hazard.kind === "dependency"),
    recommendations: analysis.recommendations,
  }
}

export function formatAdvisory(calls: readonly ToolCallPlan[]): string | undefined {
  const recommendations = analyzeBatch(calls).recommendations
  if (recommendations.length === 0) return undefined
  return `Execution advisory: ${recommendations.join(" ")}`
}

function operationKind(call: ToolCallPlan): NonNullable<ToolCallPlan["kind"]> {
  if (call.kind) return call.kind
  if (call.tool === "read" || call.tool === "glob" || call.tool === "grep" || call.tool === "webfetch") return "read"
  return "command"
}

function operationKey(call: ToolCallPlan): string | undefined {
  const value = call.path ?? call.input?.filePath ?? call.input?.path
  return value?.trim() || undefined
}

function operationName(call: ToolCallPlan): string {
  return call.name ?? call.tool ?? operationKey(call) ?? "operation"
}

export const BatchingAdvisor = { analyzeBatch, detectInefficiencies, formatAdvisory }
