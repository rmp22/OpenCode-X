export interface StepProgress {
  readonly id: string
  readonly action: string
  readonly target: string
  readonly status: "pending" | "in_progress" | "completed" | "failed"
  readonly check?: string
  readonly completedAt?: number
}

export interface ProgressState {
  readonly currentStepIndex: number
  readonly totalSteps: number
  readonly completedCount: number
  readonly monotonic: boolean
  readonly regressed: boolean
  readonly regressionReason?: string
}

export class ExecutionProgressTracker {
  private steps: StepProgress[] = []
  private highestCompletedIndex = -1

  constructor(initialSteps: readonly StepProgress[] = []) {
    this.steps = [...initialSteps]
  }

  setSteps(steps: readonly StepProgress[]): void {
    this.steps = [...steps]
    this.highestCompletedIndex = -1
  }

  completeStep(stepIndex: number): ProgressState {
    if (stepIndex < 0 || stepIndex >= this.steps.length) {
      throw new Error(`Invalid step index: ${stepIndex}`)
    }

    const isMonotonic = stepIndex >= this.highestCompletedIndex
    const isRegression = stepIndex < this.highestCompletedIndex

    this.steps[stepIndex] = {
      ...this.steps[stepIndex],
      status: "completed",
      completedAt: Date.now(),
    }

    if (stepIndex > this.highestCompletedIndex) {
      this.highestCompletedIndex = stepIndex
    }

    const completedCount = this.steps.filter((s) => s.status === "completed").length

    const state: ProgressState = {
      currentStepIndex: stepIndex,
      totalSteps: this.steps.length,
      completedCount,
      monotonic: isMonotonic,
      regressed: isRegression,
      regressionReason: isRegression
        ? `Step ${stepIndex} completed after step ${this.highestCompletedIndex} was already completed`
        : undefined,
    }
    return state
  }

  failStep(stepIndex: number, reason?: string): ProgressState {
    if (stepIndex < 0 || stepIndex >= this.steps.length) {
      throw new Error(`Invalid step index: ${stepIndex}`)
    }

    const wasCompleted = this.steps[stepIndex].status === "completed"

    this.steps[stepIndex] = {
      ...this.steps[stepIndex],
      status: "failed",
    }

    const completedCount = this.steps.filter((s) => s.status === "completed").length

    const state: ProgressState = {
      currentStepIndex: stepIndex,
      totalSteps: this.steps.length,
      completedCount,
      monotonic: !wasCompleted,
      regressed: wasCompleted,
      regressionReason: wasCompleted
        ? `Previously completed step ${stepIndex} marked failed: ${reason ?? "unknown error"}`
        : undefined,
    }
    return state
  }

  getState(): ProgressState {
    const completedCount = this.steps.filter((s) => s.status === "completed").length
    const state: ProgressState = {
      currentStepIndex: Math.max(0, this.highestCompletedIndex),
      totalSteps: this.steps.length,
      completedCount,
      monotonic: true,
      regressed: false,
    }
    return state
  }

  getSteps(): readonly StepProgress[] {
    return this.steps
  }
}

export * as ExecutionProgress from "./execution-progress"
