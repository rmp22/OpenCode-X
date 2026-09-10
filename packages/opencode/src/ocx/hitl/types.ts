export type AutonomyLevel = "full_autonomous" | "supervised" | "interactive"

export type ActionRiskClass = "low" | "medium" | "high" | "critical"

export interface QuestionOption {
  label: string
  description: string
}

export interface UserPromptQuestion {
  id: string
  header: string
  question: string
  options: QuestionOption[]
  multiple?: boolean
}

export interface InterventionRequest {
  id: string
  risk: ActionRiskClass
  reason: string
  actionDescription: string
  question?: UserPromptQuestion
}

export interface InterventionResponse {
  approved: boolean
  selectedOptions?: string[]
  feedback?: string
}
