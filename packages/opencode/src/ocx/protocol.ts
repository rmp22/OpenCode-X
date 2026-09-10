export type ExecutionLane =
  | "standard"
  | "fast"
  | "deep"
  | "autonomous"

export type PipelineId =
  | "code-mutation-pipeline"
  | "interactive-exploration-pipeline"
  | "systematic-investigation-pipeline"
  | "production-infrastructure-pipeline"
  | "security-remediation-pipeline"
  | "documentation-pipeline"
  | "release-preparation-pipeline"

/** @deprecated Use PipelineId instead */
export type OcxWorkflow =
  | "coding"
  | "research"
  | "documentation"
  | "maintenance"
  | "security"
  | "release"
  | "infrastructure"
  | "general"

/** @deprecated Use PipelineId instead */
export type LegacyWorkflow = OcxWorkflow

/** @deprecated Use PipelineState instead */
export type ActiveWorkflow = {
  readonly name: string
  readonly variant?: string
  readonly phase: string
  readonly phases?: readonly string[]
  readonly objective?: string
  readonly status?: string
  readonly revision?: number
}

export type PipelineState = {
  readonly pipeline: PipelineId
  readonly lane: ExecutionLane
  readonly phase: string
  readonly phases: readonly string[]
  readonly objective?: string
  readonly status?: string
  readonly revision?: number
  readonly intentRevision?: number
  /** @deprecated */
  readonly workflow?: string
  /** @deprecated */
  readonly activeWorkflow?: ActiveWorkflow
}

export const PIPELINE_IDS: readonly PipelineId[] = [
  "code-mutation-pipeline",
  "interactive-exploration-pipeline",
  "systematic-investigation-pipeline",
  "production-infrastructure-pipeline",
  "security-remediation-pipeline",
  "documentation-pipeline",
  "release-preparation-pipeline",
] as const

export const EXECUTION_LANES: readonly ExecutionLane[] = [
  "standard",
  "fast",
  "deep",
  "autonomous",
] as const

export function isPipelineId(value: unknown): value is PipelineId {
  return typeof value === "string" && (PIPELINE_IDS as readonly string[]).includes(value)
}

export function isExecutionLane(value: unknown): value is ExecutionLane {
  return typeof value === "string" && (EXECUTION_LANES as readonly string[]).includes(value)
}

export function workflowToPipeline(workflow: LegacyWorkflow | string | undefined): PipelineId {
  switch (workflow) {
    case "coding":
    case "maintenance":
    case "general":
      return "code-mutation-pipeline"
    case "research":
      return "interactive-exploration-pipeline"
    case "documentation":
      return "documentation-pipeline"
    case "security":
      return "security-remediation-pipeline"
    case "release":
      return "release-preparation-pipeline"
    case "infrastructure":
      return "production-infrastructure-pipeline"
    default:
      return "code-mutation-pipeline"
  }
}

export function workflowToLane(workflow: LegacyWorkflow | string | undefined): ExecutionLane {
  switch (workflow) {
    case "research":
    case "security":
      return "deep"
    case "coding":
    case "documentation":
    case "maintenance":
    case "release":
    case "infrastructure":
    case "general":
    default:
      return "standard"
  }
}

export function pipelineToWorkflow(pipeline: PipelineId): OcxWorkflow {
  switch (pipeline) {
    case "code-mutation-pipeline":
      return "coding"
    case "interactive-exploration-pipeline":
    case "systematic-investigation-pipeline":
      return "research"
    case "documentation-pipeline":
      return "documentation"
    case "security-remediation-pipeline":
      return "security"
    case "release-preparation-pipeline":
      return "release"
    case "production-infrastructure-pipeline":
      return "infrastructure"
    default:
      return "general"
  }
}

export function resolveLegacyWorkflow(input: unknown): {
  readonly pipeline: PipelineId
  readonly lane: ExecutionLane
} {
  if (typeof input === "string") {
    const pipeline = workflowToPipeline(input)
    const lane = workflowToLane(input)
    return { pipeline, lane }
  }
  if (input && typeof input === "object") {
    const candidate = input as Record<string, unknown>
    if (typeof candidate.pipeline === "string" && isPipelineId(candidate.pipeline)) {
      const pipeline = candidate.pipeline
      const lane = typeof candidate.lane === "string" && isExecutionLane(candidate.lane)
        ? candidate.lane
        : "standard"
      return { pipeline, lane }
    }
    if (typeof candidate.workflow === "string") {
      const pipeline = workflowToPipeline(candidate.workflow)
      const lane = typeof candidate.lane === "string" && isExecutionLane(candidate.lane)
        ? candidate.lane
        : workflowToLane(candidate.workflow)
      return { pipeline, lane }
    }
    if (typeof candidate.name === "string") {
      const pipeline = workflowToPipeline(candidate.name)
      const lane = workflowToLane(candidate.name)
      return { pipeline, lane }
    }
  }
  return { pipeline: "code-mutation-pipeline", lane: "standard" }
}

export * as Protocol from "./protocol"
