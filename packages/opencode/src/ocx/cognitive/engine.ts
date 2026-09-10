import { Effect } from "effect"
import { CognitiveLedger } from "./ledger"
import { CognitiveController, type ControllerState } from "./controller"
import { Reflexion } from "./reflexion"
import { TaskModel, type TaskKind } from "../task-model"
import { Workflow } from "../workflow"
import { buildTaskContext, reviewOutputQualitySemantic } from "../llm"
import type { Message, LedgerEntry } from "../ledger"

export type FailurePattern =
  | "VIBE_CODING_DRIFT"
  | "UNGROUNDED_API_GUESS"
  | "ATOMIC_CONTEXT_VIOLATION"
  | "DEAD_INTERACTION_SLOP"
  | "UNVERIFIED_TOKEN_MATH"
  | "REPETITIVE_TOOL_FAILURE"
  | "TUNNEL_VISION_MYOPIA"

export type CognitiveDiagnosis = {
  readonly pattern: FailurePattern
  readonly severity: "warning" | "blocker"
  readonly message: string
  readonly remedy: string
}

export type CognitiveEnvelope = {
  readonly taskKind: TaskKind
  readonly stage: string
  readonly diagnoses: readonly CognitiveDiagnosis[]
  readonly directives: readonly string[]
  readonly promptBlock?: string
}

export function detectFailurePatterns(input: {
  readonly entries: readonly LedgerEntry[]
  readonly changedFiles: readonly string[]
  readonly userPrompt: string
  readonly phase?: string
}): CognitiveDiagnosis[] {
  const diagnoses: CognitiveDiagnosis[] = []
  const { entries, changedFiles, userPrompt } = input

  const commands = entries.filter(
    (e): e is Extract<LedgerEntry, { kind: "command" }> => e.kind === "command",
  )
  const edits = entries.filter(
    (e): e is Extract<LedgerEntry, { kind: "edit" | "write" }> => e.kind === "edit" || e.kind === "write",
  )
  const reads = entries.filter(
    (e): e is Extract<LedgerEntry, { kind: "read" }> => e.kind === "read",
  )

  if (edits.length > 0 && reads.length === 0 && !/\bcreate\s+new\b/i.test(userPrompt)) {
    diagnoses.push({
      pattern: "VIBE_CODING_DRIFT",
      severity: "blocker",
      message: "Modifying existing codebase files without reading target definitions, caller contracts, or types.",
      remedy: "Inspect the target file and its neighbor callers with read/grep before generating edits.",
    })
  }

  if (commands.length >= 2) {
    const lastTwo = commands.slice(-2)
    if (lastTwo[0].outcome === "failed" && lastTwo[1].outcome === "failed" && lastTwo[0].command === lastTwo[1].command) {
      diagnoses.push({
        pattern: "REPETITIVE_TOOL_FAILURE",
        severity: "blocker",
        message: `Command failed repeatedly: "${lastTwo[1].command}".`,
        remedy: "Do not repeat the identical failed command. Diagnose the root cause or pivot to an alternate tool/approach.",
      })
    }
  }

  const isSystemsTask = changedFiles.some((f) => /\.(?:c|cc|cpp|h|hpp|rs)$/i.test(f) || /Android\.bp|Kbuild|Makefile/i.test(f))
  if (isSystemsTask) {
    const hasHeaderRead = reads.some((r) => /(?:include\/|sys\/|hardware\/|\.h\b)/i.test(r.path))
    if (!hasHeaderRead && edits.length > 0) {
      diagnoses.push({
        pattern: "UNGROUNDED_API_GUESS",
        severity: "warning",
        message: "C/kernel code modified without inspecting in-tree headers for exact struct definitions.",
        remedy: "Search in-tree headers (include/linux, hardware/interfaces) for exact struct fields and macro signatures.",
      })
    }
  }

  const isBitwiseCode = isSystemsTask && changedFiles.some((f) => /\.(?:c|cc|cpp|h|hpp|rs|s|asm)$/i.test(f))
  const mathHeavy = isBitwiseCode && /\b(?:page_align|dma_alloc|bitmask|pointer arithmetic)\b/i.test(userPrompt)
  if (mathHeavy && !commands.some((c) => /python|bc|expr|awk/.test(c.command))) {
    diagnoses.push({
      pattern: "UNVERIFIED_TOKEN_MATH",
      severity: "warning",
      message: "Complex bitwise, memory alignment, or pointer calculations detected without computational verification.",
      remedy: "Use a small probe command to verify numerical offsets or bitmasks before embedding magic numbers.",
    })
  }

  if (edits.length >= 2 && changedFiles.length === 1 && reads.length <= 1) {
    diagnoses.push({
      pattern: "TUNNEL_VISION_MYOPIA",
      severity: "warning",
      message: "Tunnel vision detected: Repeatedly editing a single local file without surveying caller contracts, imports, or sibling dependents.",
      remedy: "Zoom out to wide-angle attention. Inspect callers using grep/search, verify line 1 imports, and check downstream blast radius before concluding.",
    })
  }

  return diagnoses
}

export function buildDirectives(input: {
  readonly workflow?: string
  readonly phase?: string
  readonly diagnoses: readonly CognitiveDiagnosis[]
}): string[] {
  const directives: string[] = []
  const workflow = input.workflow?.toLowerCase() ?? "general"

  directives.push(
    "Ground Truth Invariant: Inspect existing types, caller contracts, and imports before writing code. Zero speculative assumptions.",
    "Anti-Tunnel Protocol: Survey the blast radius and caller contracts before modifying a method. Connect local edits to line 1 imports and package boundaries.",
    "Dual-Anchor Alignment: Continuously verify that the local edit directly satisfies the top-level user goal. Invert assumptions and check for blindspots before concluding.",
    "Deep Modules: Design clean, simple interfaces that hide internal complexity. Reuse before writing.",
    "Error Completeness: Handle every failure path explicitly; no empty catches, no unhandled promises, no silent null returns.",
    "Surgical Precision: Make the smallest coherent change that solves the root cause without unrelated churn.",
    "Empirical Verification: Prove correctness with real compiler checks, unit tests, or build runs before concluding.",
  )

  if (workflow === "debugging" || workflow === "incident") {
    directives.push(
      "Scientific Hypothesis: Formulate a falsifiable hypothesis for the root cause before editing code.",
      "Surgical Isolation: Repair only the failing causal mechanism; preserve all neighboring working behavior.",
    )
  } else if (workflow === "design") {
    directives.push(
      "Content-Driven Composition: Match layout structure to the product information hierarchy; avoid forced card templates, generic bento grids, and decorative noise.",
      "Zero Dead Links: Every button, card, and action must trigger real interactive behavior (modals, filters, calculations). Never ship href='#' or dummy onclick bypasses.",
      "Purposeful Interactions: Provide clean, accessible visual feedback with keyboard focus states and reduced-motion support.",
    )
  }

  for (const diag of input.diagnoses) {
    directives.push(`[Cognitive Remediation]: ${diag.remedy}`)
  }

  return directives
}

export function renderExecutiveEnvelope(input: {
  readonly sessionID?: string
  readonly workflow?: string
  readonly phase?: string
  readonly entries?: readonly LedgerEntry[]
  readonly changedFiles?: readonly string[]
  readonly userPrompt?: string
}): CognitiveEnvelope {
  const diagnoses = detectFailurePatterns({
    entries: input.entries ?? [],
    changedFiles: input.changedFiles ?? [],
    userPrompt: input.userPrompt ?? "",
    phase: input.phase,
  })

  const directives = buildDirectives({
    workflow: input.workflow,
    phase: input.phase,
    diagnoses,
  })

  const taskKind = TaskModel.taskKind(input.workflow)
  const stage = TaskModel.stageKind(input.phase)

  const reflexions = input.sessionID ? Reflexion.renderReflexions(input.sessionID) : undefined

  const promptLines = [
    "=== OCX GENERAL CODING EXECUTIVE ENGINE ===",
    `TASK ARCHITECTURE: ${taskKind} [stage: ${stage}]`,
    ...directives.map((d) => `- ${d}`),
    ...(diagnoses.length > 0
      ? ["CAUTION - COGNITIVE HAZARDS DETECTED:", ...diagnoses.map((d) => `  ! [${d.pattern}] ${d.message}`)]
      : []),
    ...(reflexions ? ["", reflexions] : []),
    "=== END OCX GENERAL CODING EXECUTIVE ENGINE ===",
  ]

  return {
    taskKind,
    stage,
    diagnoses,
    directives,
    promptBlock: promptLines.join("\n"),
  }
}

export function evaluateSemanticQuality(input: {
  readonly request: string
  readonly changedFiles: readonly string[]
  readonly workingDirectory: string
}) {
  return Effect.gen(function* () {
    const taskContext = buildTaskContext({
      request: input.request,
      affectedFiles: input.changedFiles,
      workingDirectory: input.workingDirectory,
    })
    const review = yield* reviewOutputQualitySemantic(taskContext)
    return review
  })
}

export { Reflexion } from "./reflexion"
export * as CognitiveEngine from "./engine"
