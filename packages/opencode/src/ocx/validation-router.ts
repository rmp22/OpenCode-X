import { OperationClassifier } from "./operation-classifier"
import type { Operation, WorkSurface } from "./workflow"

export type ValidationOutcome = "pass" | "fail" | "unknown" | "not-applicable"

export type ValidationCheck = {
  readonly id: string
  readonly surface: WorkSurface
  readonly kind: string
  readonly required: boolean
  readonly reason: string
}

export type ValidationPlan = {
  readonly surfaces: readonly WorkSurface[]
  readonly checks: readonly ValidationCheck[]
}

export type ValidationInput = {
  readonly workflow?: string
  readonly operation?: Operation
  readonly changedPaths: readonly string[]
  readonly risk?: string
  readonly userIntent?: string
}

export function plan(input: ValidationInput): ValidationPlan {
  const surfaces = [...new Set(input.changedPaths.map(OperationClassifier.classifyArtifactSurface))]
  const operationSurface = input.operation?.surface
  if (operationSurface && !surfaces.includes(operationSurface)) surfaces.push(operationSurface)
  if (surfaces.length === 0) surfaces.push(operationSurface ?? workflowSurface(input.workflow) ?? "documentation")
  const checks = surfaces.flatMap((surface) => checksForSurface(surface, input))
  return { surfaces, checks }
}

function checksForSurface(surface: WorkSurface, input: ValidationInput): ValidationCheck[] {
  if (surface === "code" || surface === "test")
    return [
      { id: "source-parse", surface, kind: "parse", required: true, reason: "changed source must remain parseable" },
      { id: "typecheck", surface, kind: "typecheck", required: input.risk === "high", reason: "type correctness is relevant to source changes" },
      { id: "targeted-test", surface: "test", kind: "test", required: surface === "test", reason: "changed behavior needs targeted test evidence" },
    ]
  if (surface === "documentation")
    return [
      { id: "source-fidelity", surface, kind: "source_fidelity", required: true, reason: "documentation claims must match the source of truth" },
      { id: "links", surface, kind: "links", required: false, reason: "changed internal links should resolve when checkable" },
      { id: "examples", surface, kind: "examples", required: false, reason: "commands and identifiers in examples should remain usable" },
    ]
  if (surface === "research")
    return [{ id: "source-quality", surface, kind: "source_quality", required: true, reason: "research claims need source and freshness evidence" }]
  if (surface === "git")
    return [{ id: "intended-diff", surface, kind: "intended_diff", required: true, reason: "delivery must match the requested change set" }]
  if (surface === "ui" || surface === "design")
    return [
      { id: "artifact", surface, kind: "artifact", required: true, reason: "the UI artifact must exist and be structurally usable" },
      { id: "accessibility", surface, kind: "accessibility", required: input.risk === "high", reason: "accessibility evidence is required for high-risk UI work" },
    ]
  if (surface === "build" || surface === "config" || surface === "dependency")
    return [{ id: "configuration", surface, kind: "configuration", required: true, reason: "configuration and dependency changes need compatibility evidence" }]
  return [{ id: "claims", surface, kind: "claims", required: true, reason: "the requested result needs grounded evidence" }]
}

function workflowSurface(workflow: string | undefined): WorkSurface | undefined {
  if (workflow === "documentation") return "documentation"
  if (workflow === "research") return "research"
  if (workflow === "review") return "code"
  if (workflow === "git") return "git"
  if (workflow === "design") return "design"
  if (workflow === "performance") return "code"
  return workflow === "coding" || workflow === "debugging" ? "code" : undefined
}

export * as ValidationRouter from "./validation-router"
