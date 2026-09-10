export type PlanLevel = "epic" | "milestone" | "workstream" | "task" | "step"

export type PlanStatus = "pending" | "in_progress" | "completed" | "failed" | "substituted"

export interface PlanStep {
  id: string
  title: string
  level: PlanLevel
  dependencies: string[]
  status: PlanStatus
  targetFiles?: string[]
  verificationCommand?: string
  evidenceId?: string
}

export interface ReplanningDecision {
  stepId: string
  action: "retry" | "substitute" | "abort"
  alternativeStep?: PlanStep
  rationale: string
}
