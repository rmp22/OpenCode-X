import { topologicalSort } from "./dag"
import type { PlanStep, ReplanningDecision } from "./types"

export class AdaptivePlanner {
  private steps = new Map<string, PlanStep>()

  addStep(step: PlanStep): void {
    this.steps.set(step.id, { ...step })
  }

  getExecutableSteps(): PlanStep[] {
    const all = Array.from(this.steps.values())
    const sorted = topologicalSort(all)
    return sorted.filter((step) => {
      if (step.status !== "pending") return false
      return step.dependencies.every((depId) => {
        const dep = this.steps.get(depId)
        return dep && dep.status === "completed"
      })
    })
  }

  completeStep(stepId: string, evidenceId: string): void {
    const step = this.steps.get(stepId)
    if (!step) throw new Error(`Step ${stepId} not found`)
    if (!evidenceId) throw new Error(`Cannot complete step ${stepId} without observable evidence`)
    step.status = "completed"
    step.evidenceId = evidenceId
  }

  replanOnFailure(stepId: string, failureReason: string): ReplanningDecision {
    const step = this.steps.get(stepId)
    if (!step) throw new Error(`Step ${stepId} not found`)

    step.status = "failed"
    const isCritical = step.level === "milestone" || step.level === "epic"

    if (isCritical) {
      return {
        stepId,
        action: "abort",
        rationale: `Critical step ${step.title} failed: ${failureReason}`,
      }
    }

    return {
      stepId,
      action: "retry",
      rationale: `Transient failure on ${step.title}: ${failureReason}`,
    }
  }

  getBlastRadius(): string[] {
    const files = new Set<string>()
    for (const step of this.steps.values()) {
      if (step.targetFiles) {
        for (const f of step.targetFiles) {
          files.add(f)
        }
      }
    }
    return Array.from(files)
  }

  getSteps(): PlanStep[] {
    return Array.from(this.steps.values())
  }
}

export const defaultAdaptivePlanner = new AdaptivePlanner()
