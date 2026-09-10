import { Effect } from "effect"
import { SemanticRuntime } from "../semantic-runtime"
import {
  TaskContext,
  RepositoryFacts,
  StackDetection,
  PlaybookSelection,
  BuildIntent,
  TaskAnalysis,
  VerificationIntent,
  QualityReview,
  SemanticTaskKind,
  StructureNeed,
  detectStack as sdkDetectStack,
  detectPlaybooks as sdkDetectPlaybooks,
  detectBuildIntent as sdkDetectBuildIntent,
  analyzeTask as sdkAnalyzeTask,
  detectTaskKind as sdkDetectTaskKind,
  detectStructureNeed as sdkDetectStructureNeed,
  reviewOutputQuality as sdkReviewOutputQuality,
} from "@opencode-ai/llm/semantic"
import { type StackName } from "../strategy"

// ── Context Building ────────────────────────────────────────────────────────

/**
 * Build a TaskContext from opencode-specific inputs.
 */
export function buildTaskContext(input: {
  readonly request: string
  readonly affectedFiles?: readonly string[]
  readonly workingDirectory?: string
  readonly taskSummary?: string
  readonly repositoryFacts?: {
    readonly root?: string
    readonly languages?: readonly string[]
    readonly buildFiles?: readonly string[]
    readonly detectedSystems?: readonly string[]
    readonly rootDirectories?: readonly string[]
  }
  readonly explicitRestrictions?: readonly string[]
}): TaskContext {
  return new TaskContext({
    request: input.request,
    affectedFiles: input.affectedFiles,
    workingDirectory: input.workingDirectory,
    taskSummary: input.taskSummary,
    repositoryFacts: input.repositoryFacts ? new RepositoryFacts(input.repositoryFacts) : undefined,
    explicitRestrictions: input.explicitRestrictions,
  })
}

// ── Shadow Mode Helpers ─────────────────────────────────────────────────────

export interface ShadowResult<T> {
  readonly legacy: T
  readonly semantic: T | undefined
  readonly disagree: boolean
}

/**
 * Compare legacy heuristic result with semantic SDK result.
 */
export function shadowCompare<T>(legacy: T, semantic: T | undefined, equals?: (a: T, b: T) => boolean): ShadowResult<T> {
  const eq = equals ?? ((a, b) => JSON.stringify(a) === JSON.stringify(b))
  return {
    legacy,
    semantic,
    disagree: semantic !== undefined && !eq(legacy, semantic),
  }
}

// ── Fallback Defaults ───────────────────────────────────────────────────────

const EMPTY_STACK = new StackDetection({
  languages: [],
  frameworks: [],
  platforms: [],
  buildSystems: [],
})

const EMPTY_PLAYBOOKS = new PlaybookSelection({
  primary: null,
  secondary: [],
})

const EMPTY_BUILD = new BuildIntent({
  buildContextRelevant: false,
  validationRequested: false,
  executionRequested: false,
  executionAuthorized: false,
  executionProhibited: false,
  buildSystems: [],
})

const EMPTY_TASK_ANALYSIS = new TaskAnalysis({
  taskTypes: [],
  scope: "unknown",
  complexity: "unknown",
  stack: EMPTY_STACK,
  playbooks: EMPTY_PLAYBOOKS,
  verification: new VerificationIntent({
    requested: false,
    methods: [],
  }),
  build: EMPTY_BUILD,
})

// ── Semantic Flow Detection Rate Pacing ──────────────────────────────────

const FLOW_DETECTION_INTERVAL_MS = 1500
let lastFlowDetectionCallTime = 0

function paceFlowDetection(): Effect.Effect<void> {
  return Effect.sync(() => {
    const now = Date.now()
    const elapsed = now - lastFlowDetectionCallTime
    return elapsed < FLOW_DETECTION_INTERVAL_MS ? FLOW_DETECTION_INTERVAL_MS - elapsed : 0
  }).pipe(
    Effect.flatMap((waitMs) => (waitMs > 0 ? Effect.sleep(waitMs) : Effect.void)),
    Effect.tap(() =>
      Effect.sync(() => {
        lastFlowDetectionCallTime = Date.now()
      }),
    ),
  )
}

// ── Semantic Wrappers ───────────────────────────────────────────────────────

/**
 * Detect stack using the semantic SDK with safe fallback on failure.
 */
export function detectStackSemantic(
  context: TaskContext,
): Effect.Effect<StackDetection, never> {
  return paceFlowDetection().pipe(
    Effect.flatMap(() => SemanticRuntime.options()),
    Effect.flatMap((options) => sdkDetectStack(context, options)),
    Effect.catchCause(() => Effect.succeed(EMPTY_STACK)),
  )
}

/**
 * Detect playbooks using the semantic SDK with safe fallback on failure.
 */
export function detectPlaybooksSemantic(
  context: TaskContext,
): Effect.Effect<PlaybookSelection, never> {
  return paceFlowDetection().pipe(
    Effect.flatMap(() => SemanticRuntime.options()),
    Effect.flatMap((options) => sdkDetectPlaybooks(context, options)),
    Effect.catchCause(() => Effect.succeed(EMPTY_PLAYBOOKS)),
  )
}

/**
 * Detect build intent using the semantic SDK with safe fallback on failure.
 */
export function detectBuildIntentSemantic(
  context: TaskContext,
): Effect.Effect<BuildIntent, never> {
  return paceFlowDetection().pipe(
    Effect.flatMap(() => SemanticRuntime.options()),
    Effect.flatMap((options) => sdkDetectBuildIntent(context, options)),
    Effect.catchCause(() => Effect.succeed(EMPTY_BUILD)),
  )
}

/**
 * Comprehensive task analysis using the semantic SDK with safe fallback on failure.
 */
export function analyzeTaskSemantic(
  context: TaskContext,
): Effect.Effect<TaskAnalysis, never> {
  return paceFlowDetection().pipe(
    Effect.flatMap(() => SemanticRuntime.options()),
    Effect.flatMap((options) => sdkAnalyzeTask(context, options)),
    Effect.catchCause(() => Effect.succeed(EMPTY_TASK_ANALYSIS)),
  )
}

export function detectTaskKindSemantic(context: TaskContext): Effect.Effect<SemanticTaskKind, never> {
  return paceFlowDetection().pipe(
    Effect.flatMap(() => SemanticRuntime.options()),
    Effect.flatMap((options) => sdkDetectTaskKind(context, options)),
    Effect.catchCause(() => Effect.succeed("unknown" as SemanticTaskKind)),
  )
}

export function detectStructureNeedSemantic(context: TaskContext): Effect.Effect<StructureNeed, never> {
  return paceFlowDetection().pipe(
    Effect.flatMap(() => SemanticRuntime.options()),
    Effect.flatMap((options) => sdkDetectStructureNeed(context, options)),
    Effect.catchCause(() => Effect.succeed(new StructureNeed({ needed: false, reasons: ["semantic classifier unavailable"] }))),
  )
}

export function reviewOutputQualitySemantic(context: TaskContext): Effect.Effect<QualityReview | undefined, never> {
  return paceFlowDetection().pipe(
    Effect.flatMap(() => SemanticRuntime.options()),
    Effect.flatMap((options) => sdkReviewOutputQuality(context, options)),
    Effect.catchCause(() => Effect.succeed(undefined)),
  )
}

// ── Legacy Bridge ───────────────────────────────────────────────────────────

/**
 * Map a StackDetection result to opencode's StackName type.
 */
export function toStackName(detection: StackDetection): StackName | undefined {
  const lang = detection.languages[0]?.toLowerCase()
  if (!lang) return undefined
  if (lang === "typescript" || lang === "javascript") return "typescript"
  if (lang === "python") return "python"
  if (lang === "rust") return "rust"
  if (lang === "go" || lang === "golang") return "go"
  if (lang === "java") return "java"
  if (lang === "kotlin") return "kotlin"
  if (lang === "c++" || lang === "cpp") return "cpp"
  if (lang === "swift") return "swift"
  if (detection.platforms.includes("android")) return "android"
  if (detection.frameworks.some((f) => f.toLowerCase().includes("compose"))) return "compose"
  return undefined
}
