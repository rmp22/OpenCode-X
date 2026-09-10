import { Effect } from "effect"
import { SemanticRuntime } from "@/ocx/semantic-runtime"
import {
  TaskContext,
  RepositoryFacts,
  StackDetection,
  PlaybookSelection,
  BuildIntent,
  TaskAnalysis,
  VerificationIntent,
  analyzeTask,
} from "@opencode-ai/llm/semantic"
import { CORE_STRATEGIES } from "@/ocx/heuristics"
import { PlaybookCatalog } from "@/ocx/playbook/catalog"
import { type StackName, type StrategyName } from "@/ocx/strategy"
import { type WorkflowId, type WorkflowVariant } from "@/ocx/workflow"

// ── Type Mapping ─────────────────────────────────────────────────────────────

const LANGUAGE_TO_STACK: Record<string, StackName> = {
  typescript: "typescript",
  javascript: "typescript",
  python: "python",
  rust: "rust",
  go: "go",
  golang: "go",
  java: "java",
  kotlin: "kotlin",
  "c++": "cpp",
  cpp: "cpp",
  swift: "swift",
}

const PLATFORM_TO_STACK: Record<string, StackName> = {
  android: "android",
  ios: "swift",
}

const FRAMEWORK_TO_STACK: Record<string, StackName> = {
  compose: "compose",
  "jetpack compose": "compose",
  "compose multiplatform": "compose",
}

function stackDetectionToStackName(detection: StackDetection): StackName | undefined {
  for (const lang of detection.languages) {
    const mapped = LANGUAGE_TO_STACK[lang.toLowerCase()]
    if (mapped) return mapped
  }
  for (const platform of detection.platforms) {
    const mapped = PLATFORM_TO_STACK[platform.toLowerCase()]
    if (mapped) return mapped
  }
  for (const framework of detection.frameworks) {
    const mapped = FRAMEWORK_TO_STACK[framework.toLowerCase()]
    if (mapped) return mapped
  }
  return undefined
}

// ── Workflow Mapping ─────────────────────────────────────────────────────────

const PLAYBOOK_TO_WORKFLOW: Record<string, WorkflowId> = {
  implementation: "coding",
  bug_fix: "debugging",
  debugging: "debugging",
  investigation: "research",
  refactor: "coding",
  code_cleanup: "coding",
  code_review: "review",
  architecture: "design",
  ui_ux: "design",
  testing: "coding",
  build: "environment",
  performance: "performance",
  security: "review",
  documentation: "documentation",
  migration: "migration",
  dependency_update: "environment",
  repository_exploration: "research",
  hybrid: "hybrid",
  freeform: "freeform",
}

function playbookToWorkflow(playbooks: PlaybookSelection): WorkflowId {
  const primary = playbooks.primary?.toLowerCase()
  const secondary = playbooks.secondary.map((name) => name.toLowerCase())
  if (primary === "freeform" || secondary.includes("freeform")) return "freeform"
  if (
    primary === "hybrid" ||
    secondary.includes("hybrid") ||
    (secondary.includes("investigation") && secondary.includes("implementation")) ||
    (primary === "investigation" && secondary.includes("implementation")) ||
    (primary === "implementation" && secondary.includes("investigation")) ||
    (primary === "documentation" && secondary.includes("implementation")) ||
    (secondary.includes("research") && secondary.includes("implementation"))
  ) {
    return "hybrid"
  }
  if (primary) {
    const mapped = PLAYBOOK_TO_WORKFLOW[primary]
    if (mapped) return mapped
  }
  if (secondary.includes("ui_ux")) return "design"
  return "coding"
}

function playbookToVariant(playbooks: PlaybookSelection): WorkflowVariant | undefined {
  const selected = [playbooks.primary, ...playbooks.secondary]
    .filter((name): name is string => typeof name === "string")
    .map((name) => name.toLowerCase())
  if (selected.includes("refactor") || selected.includes("code_cleanup")) return "refactor"
  if (selected.includes("bug_fix") || selected.includes("debugging")) return "fix"
  if (selected.includes("code_review")) return "audit"
  if (selected.includes("documentation")) return "reference"
  if (selected.includes("dependency_update")) return "dependency"
  return undefined
}

// ── Strategy Mapping ─────────────────────────────────────────────────────────

function playbookToStrategies(playbooks: PlaybookSelection): readonly StrategyName[] {
  const strategies: StrategyName[] = []
  const selected = [playbooks.primary, ...playbooks.secondary]
    .filter((name): name is string => typeof name === "string")
    .map((name) => name.toLowerCase())
  if (selected.some((name) => PLAYBOOK_TO_WORKFLOW[name] === "debugging")) strategies.push("reasoning")
  // Structure is optional. The semantic playbook decision may select it for
  // architecture-heavy work; ordinary coding/UI tasks never receive it just
  // because they mutate files.
  if (selected.includes("architecture")) strategies.push("structure")
  return [...new Set(strategies)]
}

// ── Semantic Bridge API ──────────────────────────────────────────────────────

export interface SemanticResult {
  readonly stack: StackName | undefined
  readonly workflow: WorkflowId
  readonly variant?: WorkflowVariant
  readonly strategies: readonly StrategyName[]
  readonly isNonTrivial: boolean
  readonly taskAnalysis: TaskAnalysis | undefined
}

function fallbackResult(prompt: string): SemanticResult {
  const text = prompt.toLocaleLowerCase()
  const stack = stackFromPrompt(text)
  const isVisual = PlaybookCatalog.VISUAL_TRIGGER_PATTERN.test(text)
  const isCoding = PlaybookCatalog.CODING_TRIGGER_PATTERN.test(text)
  const isResearch = /\b(?:research|investigate|look up|find out|compare|evidence|source)\b/.test(text)
  const isFreeform = /\b(?:freeform|adhoc|unconstrained|no workflow)\b/.test(text)
  const isHybrid =
    /\b(?:hybrid|mixed workflow)\b/.test(text) ||
    (isResearch && isCoding) ||
    (isResearch && /\b(?:implement|code|build|create|add|generate)\b/.test(text))
  const workflow: WorkflowId = isFreeform
    ? "freeform"
    : isHybrid
      ? "hybrid"
      : /\b(?:install|uninstall|upgrade|downgrade|configure|setup|set up)\b[\s\S]*\b(?:playwright|runtime|browser|tool|package|environment)\b|\b(?:host|runtime|browser)\s+(?:setup|configuration|installation)\b/.test(
          text,
        )
        ? "environment"
        : isResearch
          ? "research"
        : /\b(?:debug(?:ging)?|failing|broken|regression|error)\b|\bfix\b[\s\S]*\b(?:bug|failure|error)\b/.test(text)
          ? "debugging"
          : isVisual
            ? "design"
            : isCoding
              ? "coding"
              : /\b(?:document|documentation|docs?|readme|changelog)\b/.test(text)
                ? "documentation"
                : /\b(?:performance|benchmark|profile|latency|throughput)\b/.test(text)
                  ? "performance"
                  : /\b(?:review|audit|critique)\b/.test(text)
                    ? "review"
                    : /\b(?:migrate|migration|schema|compatibility)\b/.test(text)
                      ? "migration"
                      : /\b(?:commit|stage|push|rebase|git)\b/.test(text)
                        ? "git"
                        : "coding"
  return {
    stack,
    workflow,
    strategies: [
      ...(isCoding ? CORE_STRATEGIES : []),
      ...(workflow === "debugging" ? (["reasoning"] as const) : []),
    ],
    isNonTrivial: false,
    taskAnalysis: undefined,
  }
}

function stackFromPrompt(text: string): StackName | undefined {
  if (/\b(?:typescript|javascript|react|tsx|jsx|node|npm)\b/.test(text)) return "typescript"
  if (/\bpython\b|\.py\b/.test(text)) return "python"
  if (/\brust\b|\.rs\b/.test(text)) return "rust"
  if (/\b(?:golang|go)\b|\.go\b/.test(text)) return "go"
  if (/\bjava\b|\.java\b/.test(text)) return "java"
  if (/\bkotlin\b|\.kt\b/.test(text)) return "kotlin"
  if (/\b(?:swift|ios)\b|\.swift\b/.test(text)) return "swift"
  if (/\b(?:c\+\+|cpp)\b|\.cpp\b/.test(text)) return "cpp"
  return undefined
}

export function analyzePrompt(
  prompt: string,
  repositoryFacts?: {
    readonly root?: string
    readonly languages?: readonly string[]
    readonly buildFiles?: readonly string[]
    readonly detectedSystems?: readonly string[]
    readonly rootDirectories?: readonly string[]
  },
): Effect.Effect<SemanticResult, never> {
  const context = new TaskContext({
    request: prompt,
    repositoryFacts: repositoryFacts ? new RepositoryFacts(repositoryFacts) : undefined,
  })

  return Effect.flatMap(SemanticRuntime.options(), (options) => analyzeTask(context, options)).pipe(
    Effect.map((analysis) => {
      const variant = playbookToVariant(analysis.playbooks)
      return {
        stack: stackDetectionToStackName(analysis.stack),
        workflow: playbookToWorkflow(analysis.playbooks),
        ...(variant ? { variant } : {}),
        strategies: playbookToStrategies(analysis.playbooks),
        isNonTrivial: analysis.complexity !== "trivial" && analysis.complexity !== "low",
        taskAnalysis: analysis,
      }
    }),
    Effect.catch(() => Effect.succeed(fallbackResult(prompt))),
    Effect.catchDefect(() => Effect.succeed(fallbackResult(prompt))),
  )
}

export * as SemanticBridge from "./semantic-bridge"
