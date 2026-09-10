export type OperationCategory =
  | "read"
  | "mutate"
  | "execute"
  | "external"
  | "administrative"

export type PolicyDecision = {
  readonly allowed: boolean
  readonly reason?: string
  readonly category: OperationCategory
}

export type PhasePolicyRule = {
  readonly phase: string
  readonly allowedCategories: readonly OperationCategory[]
}

export * as PolicyTypes from "./types"
