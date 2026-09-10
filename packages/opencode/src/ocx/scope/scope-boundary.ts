import type { ScopeLevel, ScopeBoundary, RequestIntent } from "./types"

export type BoundaryInput = {
  readonly scopeLevel: ScopeLevel
  readonly intent: RequestIntent
  readonly evaluation: {
    readonly depth: number
    readonly width: number
    readonly coupling: number
    readonly risk: number
    readonly requestBreadth: number
  }
  readonly primaryTarget: string
  readonly relatedComponents: readonly string[]
}

export function buildBoundary(input: BoundaryInput): ScopeBoundary {
  const level = input.scopeLevel
  const primary: string[] = [input.primaryTarget]
  const allowedIfRequired: string[] = []
  const protected_: string[] = []

  switch (level) {
    case "local":
      primary.push(input.primaryTarget)
      break
    case "component":
      primary.push(...input.relatedComponents.slice(0, 3))
      if (input.evaluation.coupling >= 2) {
        allowedIfRequired.push(...input.relatedComponents.slice(3, 6))
      }
      break
    case "feature":
      primary.push(...input.relatedComponents.slice(0, 5))
      allowedIfRequired.push(...input.relatedComponents.slice(5, 10))
      break
    case "subsystem":
      primary.push(...input.relatedComponents.slice(0, 8))
      allowedIfRequired.push(...input.relatedComponents.slice(8, 15))
      break
    case "structural":
      primary.push(...input.relatedComponents.slice(0, 10))
      allowedIfRequired.push(...input.relatedComponents.slice(10, 20))
      break
  }

  if (input.intent.preserveUnrelatedWip) {
    protected_.push("unrelated user WIP")
  }

  if (input.intent.taskKind.includes("cleanup") || input.intent.taskKind.includes("ai_slop_removal")) {
    protected_.push("unrelated formatting")
    protected_.push("unrelated style changes")
  }

  if (input.intent.minimalPatchRequested) {
    protected_.push("unrelated user changes")
  }

  if (input.evaluation.risk >= 4) {
    protected_.push("public API surface")
  }

  return {
    primary: [...new Set(primary)],
    allowedIfRequired: [...new Set(allowedIfRequired)],
    protected: [...new Set(protected_)],
  }
}

export * as ScopeBoundaryBuilder from "./scope-boundary"
