import type { RequestIntent } from "./types"

export type ExplorationInput = {
  readonly request: string
  readonly intent: RequestIntent
  readonly codebaseSize: number
  readonly moduleGraph: readonly string[]
  readonly entryPoints: readonly string[]
  readonly wipFiles: readonly string[]
}

export type ExplorationFinding = {
  readonly type: "root_cause" | "affected_component" | "related_implementation" | "state_path" | "test" | "uncertainty"
  readonly description: string
  readonly location: string
  readonly confidence: number
}

export type ProblemExploration = {
  readonly suspectedRootCause: string | undefined
  readonly affectedComponents: readonly string[]
  readonly relatedImplementations: readonly string[]
  readonly stateDataPaths: readonly string[]
  readonly tests: readonly string[]
  readonly uncertainty: readonly string[]
  readonly findings: readonly ExplorationFinding[]
}

function classifyFinding(
  description: string,
  location: string,
  confidence: number,
): ExplorationFinding {
  if (description.includes("root cause") || description.includes("caused by")) {
    return { type: "root_cause", description, location, confidence }
  }
  if (description.includes("implementation") || description.includes("also exists in")) {
    return { type: "related_implementation", description, location, confidence }
  }
  if (description.includes("state") || description.includes("data flow") || description.includes("path")) {
    return { type: "state_path", description, location, confidence }
  }
  if (description.includes("test") || description.includes("spec")) {
    return { type: "test", description, location, confidence }
  }
  if (description.includes("uncertain") || description.includes("unknown") || description.includes("needs investigation")) {
    return { type: "uncertainty", description, location, confidence }
  }
  return { type: "affected_component", description, location, confidence }
}

export function exploreProblem(input: ExplorationInput): ProblemExploration {
  const findings: ExplorationFinding[] = []
  const affectedComponents: string[] = []
  const relatedImplementations: string[] = []
  const stateDataPaths: string[] = []
  const tests: string[] = []
  const uncertainty: string[] = []

  const request = input.request.toLowerCase()

  if (input.intent.taskKind.includes("bug_fix")) {
    findings.push(
      classifyFinding("Root cause investigation needed for bug fix", "execution path", 0.7),
    )
    findings.push(
      classifyFinding("Trace data flow from entry point to failure site", "data flow", 0.6),
    )
  }

  if (input.intent.taskKind.includes("cleanup") || input.intent.taskKind.includes("ai_slop_removal")) {
    findings.push(
      classifyFinding("Inspect full relevant scope for material findings", "component boundary", 0.8),
    )
  }

  if (input.intent.taskKind.includes("hardening") || input.intent.taskKind.includes("production_readiness")) {
    findings.push(
      classifyFinding("Review edge cases and boundary conditions", "edge handling", 0.7),
    )
  }

  if (input.intent.taskKind.includes("architecture")) {
    findings.push(
      classifyFinding("Architecture itself may be the root cause", "module boundaries", 0.5),
    )
  }

  if (input.wipFiles.length > 0) {
    findings.push(
      classifyFinding(`User WIP detected in: ${input.wipFiles.join(", ")}`, "git status", 0.9),
    )
  }

  if (input.moduleGraph.length > 10) {
    findings.push(
      classifyFinding("Large codebase: use indexed lookup for targeted exploration", "codebase mapper", 0.8),
    )
    uncertainty.push("Repository size may hide related implementations")
  }

  if (input.intent.taskKind.includes("bug_fix") && !input.intent.explicitScope) {
    uncertainty.push("No explicit scope provided; root cause may be deeper than visible")
  }

  if (input.intent.taskKind.includes("cleanup") && input.codebaseSize > 1000) {
    uncertainty.push("Large codebase may contain duplicated patterns not visible in initial scan")
  }

  return {
    suspectedRootCause: findings.find((f) => f.type === "root_cause")?.description,
    affectedComponents,
    relatedImplementations,
    stateDataPaths,
    tests,
    uncertainty,
    findings,
  }
}

export * as ProblemExplorer from "./problem-explorer"
