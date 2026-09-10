export type WorkItemStatus =
  | "proposed"
  | "ready"
  | "in_progress"
  | "blocked"
  | "completed"
  | "cancelled"
  | "pending"

export type CheckStatus = "pending" | "pass" | "fail" | "waived"

export type CheckItem = {
  readonly id: string
  readonly itemId?: string
  readonly description: string
  readonly status: CheckStatus
  readonly evidenceId?: string
}

export type WorkStep = {
  readonly id: string
  readonly workstreamId?: string
  readonly title: string
  readonly action: string
  readonly targetFiles?: readonly string[]
  readonly status: WorkItemStatus
  readonly dependsOn?: readonly string[]
  readonly checks: readonly CheckItem[]
  readonly evidenceIds?: readonly string[]
  readonly waiverReason?: string
  readonly graphNodeId?: string
}

export type WorkItem = WorkStep

export type WorkstreamUnit = {
  readonly id: string
  readonly goalId?: string
  readonly title: string
  readonly status: WorkItemStatus
  readonly dependsOn?: readonly string[]
  readonly steps: readonly WorkStep[]
}

export type Goal = {
  readonly id: string
  readonly title: string
  readonly description?: string
  readonly status: WorkItemStatus
  readonly workstreamIds: readonly string[]
}

export type WorkModel = {
  readonly id: string
  readonly sessionID: string
  readonly goal: string
  readonly goals?: readonly Goal[]
  readonly workstreams: readonly WorkstreamUnit[]
  readonly currentStepId?: string
  readonly progress: number
}

export function computeProgress(workstreams: readonly WorkstreamUnit[]): number {
  const allSteps = workstreams.flatMap((ws) => ws.steps)
  if (allSteps.length === 0) return 0
  const completed = allSteps.filter((s) => s.status === "completed").length
  const ratio = Math.round((completed / allSteps.length) * 100) / 100
  return ratio
}

export function createWorkModel(options: {
  readonly id: string
  readonly sessionID: string
  readonly goal: string
  readonly goals?: readonly Goal[]
  readonly workstreams: readonly WorkstreamUnit[]
  readonly currentStepId?: string
}): WorkModel {
  const progress = computeProgress(options.workstreams)
  const model: WorkModel = {
    id: options.id,
    sessionID: options.sessionID,
    goal: options.goal,
    goals: options.goals,
    workstreams: options.workstreams,
    currentStepId: options.currentStepId,
    progress,
  }
  return model
}

export function activateStep(model: WorkModel, stepId: string): WorkModel {
  const updatedStreams = model.workstreams.map((ws) => {
    const hasStep = ws.steps.some((s) => s.id === stepId)
    if (!hasStep) return ws
    const updatedSteps = ws.steps.map((s) => {
      if (s.id === stepId) {
        return { ...s, status: "in_progress" as const }
      }
      return s
    })
    return { ...ws, status: "in_progress" as const, steps: updatedSteps }
  })
  const updated = createWorkModel({
    ...model,
    workstreams: updatedStreams,
    currentStepId: stepId,
  })
  return updated
}

export function canCompleteStep(step: WorkStep): { readonly allowed: boolean; readonly reason?: string } {
  if (step.waiverReason && step.waiverReason.trim().length > 0) {
    return { allowed: true }
  }
  if (!step.checks || step.checks.length === 0) {
    return { allowed: true }
  }
  const unpassed = step.checks.filter((c) => c.status !== "pass" && c.status !== "waived")
  if (unpassed.length > 0) {
    const failureResult = {
      allowed: false,
      reason: `Step "${step.title}" has ${unpassed.length} unpassed check(s): ${unpassed.map((c) => c.description).join("; ")}`,
    }
    return failureResult
  }
  return { allowed: true }
}

export function completeStep(
  model: WorkModel,
  stepId: string,
  options: {
    readonly waiverReason?: string
    readonly evidenceIds?: readonly string[]
  } = {},
): WorkModel {
  let targetStepFound = false
  let completionAllowed = true
  let rejectReason = ""

  const updatedStreams = model.workstreams.map((ws) => {
    const hasTarget = ws.steps.some((s) => s.id === stepId)
    if (!hasTarget) return ws
    const updatedSteps = ws.steps.map((s) => {
      if (s.id !== stepId) return s
      targetStepFound = true
      const candidate: WorkStep = {
        ...s,
        waiverReason: options.waiverReason ?? s.waiverReason,
        evidenceIds: options.evidenceIds ? [...(s.evidenceIds ?? []), ...options.evidenceIds] : s.evidenceIds,
      }
      const checkResult = canCompleteStep(candidate)
      if (!checkResult.allowed) {
        completionAllowed = false
        rejectReason = checkResult.reason ?? "Checks not passed"
        return candidate
      }
      return { ...candidate, status: "completed" as const }
    })
    const allCompleted = updatedSteps.every((s) => s.status === "completed" || s.status === "cancelled")
    const wsStatus: WorkItemStatus = allCompleted ? "completed" : ws.status
    return { ...ws, steps: updatedSteps, status: wsStatus }
  })

  if (!targetStepFound) {
    throw new Error(`Step with id "${stepId}" not found in work model`)
  }
  if (!completionAllowed) {
    throw new Error(`Cannot complete step "${stepId}": ${rejectReason}`)
  }

  const updated = createWorkModel({
    ...model,
    workstreams: updatedStreams,
    currentStepId: model.currentStepId === stepId ? undefined : model.currentStepId,
  })
  return updated
}

export function updateCheckStatus(
  model: WorkModel,
  stepId: string,
  checkId: string,
  status: CheckStatus,
  evidenceId?: string,
): WorkModel {
  const updatedStreams = model.workstreams.map((ws) => {
    const step = ws.steps.find((s) => s.id === stepId)
    if (!step) return ws
    const updatedSteps = ws.steps.map((s) => {
      if (s.id !== stepId) return s
      const updatedChecks = s.checks.map((c) => {
        if (c.id !== checkId) return c
        const checkItem: CheckItem = {
          ...c,
          status,
          evidenceId: evidenceId ?? c.evidenceId,
        }
        return checkItem
      })
      return { ...s, checks: updatedChecks }
    })
    return { ...ws, steps: updatedSteps }
  })
  const updatedModel = createWorkModel({
    ...model,
    workstreams: updatedStreams,
  })
  return updatedModel
}

export function detectDependencyCycles(
  items: ReadonlyArray<{ readonly id: string; readonly dependsOn?: readonly string[] }>,
): boolean {
  const adj = new Map<string, string[]>()
  for (const item of items) {
    adj.set(item.id, [...(item.dependsOn ?? [])])
  }
  const visited = new Set<string>()
  const inStack = new Set<string>()

  function hasCycle(node: string): boolean {
    visited.add(node)
    inStack.add(node)
    const neighbors = adj.get(node) ?? []
    for (const n of neighbors) {
      if (!visited.has(n)) {
        if (hasCycle(n)) return true
      } else if (inStack.has(n)) {
        return true
      }
    }
    inStack.delete(node)
    return false
  }

  for (const item of items) {
    if (!visited.has(item.id)) {
      if (hasCycle(item.id)) return true
    }
  }
  return false
}

export function areDependenciesSatisfied(
  item: { readonly dependsOn?: readonly string[] },
  allSteps: readonly WorkStep[],
): boolean {
  if (!item.dependsOn || item.dependsOn.length === 0) return true
  const completedIds = new Set(allSteps.filter((s) => s.status === "completed").map((s) => s.id))
  return item.dependsOn.every((depId) => completedIds.has(depId))
}

export function renderWorkModel(model: WorkModel): string {
  const lines: string[] = []
  lines.push("=== WORK MODEL: " + model.goal + " (Progress: " + Math.round(model.progress * 100) + "%) ===")
  for (const ws of model.workstreams) {
    lines.push("\nWorkstream: " + ws.title + " [" + ws.status + "]")
    for (const step of ws.steps) {
      const isCurrent = step.id === model.currentStepId
      lines.push("  " + (step.status === "completed" ? "[✓]" : isCurrent ? "[►]" : "[ ]") + " " + step.title + ": " + step.action)
    }
  }
  return lines.join("\n")
}

export * as WorkModelTypes from "./model"
