import PROMPT_BUILD from "./prompt/ocx-build.txt"
import PROMPT_BROWSER from "./prompt/ocx-browser.txt"
import PROMPT_AUDIT from "./prompt/ocx-audit.txt"
import PROMPT_COMPLEXITY from "./prompt/ocx-complexity.txt"
import PROMPT_ENGINEERING from "./prompt/ocx-engineering.txt"
import PROMPT_EXEMPLARS from "./prompt/ocx-exemplars.txt"
import PROMPT_FONTS from "./prompt/ocx-fonts.txt"
import PROMPT_FRONTIER from "./prompt/ocx-frontier.txt"
import PROMPT_STACK_ANDROID from "./prompt/ocx-stack-android.txt"
import PROMPT_STACK_CPP from "./prompt/ocx-stack-cpp.txt"
import PROMPT_STACK_COMPOSE from "./prompt/ocx-stack-compose.txt"
import PROMPT_STACK_FRONTEND from "./prompt/ocx-stack-frontend.txt"
import PROMPT_STACK_GO from "./prompt/ocx-stack-go.txt"
import PROMPT_STACK_JAVA from "./prompt/ocx-stack-java.txt"
import PROMPT_STACK_KOTLIN from "./prompt/ocx-stack-kotlin.txt"
import PROMPT_STACK_PYTHON from "./prompt/ocx-stack-python.txt"
import PROMPT_STACK_RUST from "./prompt/ocx-stack-rust.txt"
import PROMPT_STACK_SWIFT from "./prompt/ocx-stack-swift.txt"
import PROMPT_STACK_TYPESCRIPT from "./prompt/ocx-stack-typescript.txt"
import PROMPT_MEMORY from "./prompt/ocx-memory.txt"
import PROMPT_REASONING from "./prompt/ocx-reasoning.txt"
import PROMPT_THINK from "./prompt/ocx-think.txt"
import PROMPT_QUALITY from "./prompt/ocx-quality.txt"
import PROMPT_REVIEW_CHECKLIST from "./prompt/ocx-review-checklist.txt"
import PROMPT_STACK from "./prompt/ocx-stack.txt"
import PROMPT_STRUCTURE from "./prompt/ocx-structure.txt"
import PROMPT_UI_CORE from "./prompt/ocx-ui-core.txt"
import PROMPT_UI_UX from "./prompt/ocx-ui-ux.txt"
import PROMPT_WEB from "./prompt/ocx-web.txt"
import PROMPT_WEB_DESIGN from "./prompt/ocx-web-design.txt"
import PROMPT_WRITE from "./prompt/ocx-write.txt"
import type { Operation } from "./workflow"

const PROMPT_UI = [PROMPT_UI_CORE, PROMPT_UI_UX].join("\n\n")

export const STRATEGY_NAMES = [
  "frontier",
  "browser",
  "audit",
  "web-design",
  "frontend",
  "typescript",
  "python",
  "rust",
  "go",
  "java",
  "kotlin",
  "cpp",
  "swift",
  "android",
  "compose",
  "reasoning",
  "think",
  "quality",
  "exemplars",
  "review",
  "stack",
  "structure",
  "engineering",
  "fonts",
  "write",
  "complexity",
  "build",
  "memory",
  "ui",
  "web",
] as const

export type StrategyName = (typeof STRATEGY_NAMES)[number]

type StrategyEntry = {
  readonly purpose: string
  readonly trigger: string
  readonly content: string
}

const STRATEGIES: Record<StrategyName, StrategyEntry> = {
  frontier: {
    purpose: "tool round steps",
    trigger: "start of any multi-step task",
    content: PROMPT_FRONTIER,
  },
  browser: {
    purpose: "browser runtime, task oracles, traces, and rendered UI checks",
    trigger: "verifying a web or browser interface",
    content: PROMPT_BROWSER,
  },
  audit: {
    purpose: "evidence-based review criteria selected for the artifact",
    trigger: "auditing generated code, content, UI, behavior, or verification",
    content: PROMPT_AUDIT,
  },
  "web-design": {
    purpose: "web design, browser behavior, and generated UI quality",
    trigger: "building or reviewing a web interface",
    content: PROMPT_WEB_DESIGN,
  },
  frontend: {
    purpose: "framework-agnostic frontend structure and runtime behavior",
    trigger: "writing frontend code or a browser interface",
    content: PROMPT_STACK_FRONTEND,
  },
  typescript: {
    purpose: "TypeScript, JavaScript, and frontend type safety",
    trigger: "writing TypeScript, JavaScript, React, Vue, or Svelte code",
    content: PROMPT_STACK_TYPESCRIPT,
  },
  python: {
    purpose: "Python application, data, and test conventions",
    trigger: "writing Python code",
    content: PROMPT_STACK_PYTHON,
  },
  rust: {
    purpose: "Rust ownership, error, and test conventions",
    trigger: "writing Rust code",
    content: PROMPT_STACK_RUST,
  },
  go: {
    purpose: "Go package, error, and concurrency conventions",
    trigger: "writing Go code",
    content: PROMPT_STACK_GO,
  },
  java: {
    purpose: "Java API, error, and test conventions",
    trigger: "writing Java code",
    content: PROMPT_STACK_JAVA,
  },
  kotlin: {
    purpose: "Kotlin null safety, coroutine, and Android conventions",
    trigger: "writing Kotlin code",
    content: PROMPT_STACK_KOTLIN,
  },
  cpp: {
    purpose: "C++ ownership, interface, and build conventions",
    trigger: "writing C or C++ code",
    content: PROMPT_STACK_CPP,
  },
  swift: {
    purpose: "Swift concurrency, platform, and UI conventions",
    trigger: "writing Swift or iOS code",
    content: PROMPT_STACK_SWIFT,
  },
  android: {
    purpose: "Android UI, lifecycle, and accessibility conventions",
    trigger: "building an Android screen or Android feature",
    content: PROMPT_STACK_ANDROID,
  },
  compose: {
    purpose: "Jetpack Compose and Compose Multiplatform UI structure",
    trigger: "building Compose UI for Android or multiple Kotlin targets",
    content: PROMPT_STACK_COMPOSE,
  },
  reasoning: {
    purpose: "debugging and root-cause work",
    trigger: "debugging, tracing, or root-cause work",
    content: PROMPT_REASONING,
  },
  think: {
    purpose: "step-by-step thinking, math hygiene, and judgment guards",
    trigger: "multi-step reasoning, math, planning, or hard judgment calls",
    content: PROMPT_THINK,
  },
  quality: {
    purpose: "universal output quality, evidence, diversity, and anti-slop checks",
    trigger: "writing, reviewing, or evaluating generated output",
    content: PROMPT_QUALITY,
  },
  exemplars: {
    purpose: "workflow patterns for tasks",
    trigger: "start of a task that matches a named shape",
    content: PROMPT_EXEMPLARS,
  },
  review: {
    purpose: "review checklist",
    trigger: "REVIEW gate before delivery",
    content: PROMPT_REVIEW_CHECKLIST,
  },
  stack: {
    purpose: "language and platform conventions",
    trigger: "writing code in a specific language",
    content: PROMPT_STACK,
  },
  structure: {
    purpose: "code structure patterns beyond mvvm: hexagonal, vertical slices, functional core",
    trigger: "coding work: writing or restructuring modules",
    content: PROMPT_STRUCTURE,
  },
  engineering: {
    purpose: "engineering and cleanup rules",
    trigger: "implementation or refactoring work",
    content: PROMPT_ENGINEERING,
  },
  fonts: {
    purpose: "typography research, typeface selection, and script or RTL/LTR coverage",
    trigger: "choosing fonts, building any screen, or checking type suitability",
    content: PROMPT_FONTS,
  },
  write: {
    purpose: "code writing rules",
    trigger: "the CODE gate: writing or generating any code",
    content: PROMPT_WRITE,
  },
  complexity: {
    purpose: "preserve behavior and guardrails",
    trigger: "simplifying, refactoring, or judging an approach",
    content: PROMPT_COMPLEXITY,
  },
  build: {
    purpose: "build system and static checks",
    trigger: "final REVIEW/VERIFY phase",
    content: PROMPT_BUILD,
  },
  memory: {
    purpose: "repository map rules",
    trigger: "start of a task in a repository with a map",
    content: PROMPT_MEMORY,
  },
  ui: {
    purpose: "UI, UX, states, and accessibility",
    trigger: "building any screen: app, web, dashboard, mobile",
    content: PROMPT_UI,
  },
  web: {
    purpose: "web security: injection, session, CORS, hardening for client and server",
    trigger: "working on a web app: frontend, backend, or Spring Boot",
    content: PROMPT_WEB,
  },
}

export function load(name: string): string | undefined {
  return STRATEGIES[name as StrategyName]?.content
}

export function catalog(): string {
  return STRATEGY_NAMES.map((name) => {
    const strategy = STRATEGIES[name]
    return `- ${name}: ${strategy.purpose}. Load when: ${strategy.trigger}.`
  }).join("\n")
}

export const STACK_NAMES = [
  "typescript",
  "python",
  "rust",
  "go",
  "java",
  "kotlin",
  "cpp",
  "swift",
  "android",
  "compose",
] as const

export type StackName = (typeof STACK_NAMES)[number]

const STACK_STRATEGIES: Record<StackName, readonly StrategyName[]> = {
  typescript: ["typescript"],
  python: ["python"],
  rust: ["rust"],
  go: ["go"],
  java: ["java"],
  kotlin: ["kotlin"],
  cpp: ["cpp"],
  swift: ["swift"],
  android: ["android", "kotlin"],
  compose: ["compose", "kotlin"],
}

export function isStackName(value: unknown): value is StackName {
  return typeof value === "string" && (STACK_NAMES as readonly string[]).includes(value)
}

export function stackStrategies(stack: unknown): StrategyName[] {
  return isStackName(stack) ? [...STACK_STRATEGIES[stack]] : []
}

export function workflowStrategies(
  workflow: string | undefined | null,
  input: { readonly variant?: string; readonly operation?: Operation } = {},
): StrategyName[] {
  const strategies: StrategyName[] = []
  if (workflow === "debugging") strategies.push("reasoning")
  if (input.operation?.surface === "code" && ["create", "edit", "refactor", "delete", "move", "generate"].includes(input.operation.action)) strategies.push("write")
  if (input.operation?.surface === "test" && ["create", "edit"].includes(input.operation.action)) strategies.push("write")
  if (input.operation?.action === "review") strategies.push("review")
  if (input.operation?.surface === "ui" || input.operation?.surface === "design" || workflow === "design") {
    strategies.push("ui")
    strategies.push("web-design")
  }
  if (input.variant === "architecture") strategies.push("structure")
  return [...new Set(strategies)]
}

export function resolveStrategies(input: {
  readonly workflow?: string | null
  readonly variant?: string
  readonly operation?: Operation
  readonly stack?: unknown
  readonly baseStrategies?: readonly StrategyName[]
}): StrategyName[] {
  const codeGuidance = input.workflow === "coding" || input.workflow === "debugging"
  const stack = codeGuidance && isStackName(input.stack) ? (["stack", ...stackStrategies(input.stack)] as StrategyName[]) : []
  const workflow = workflowStrategies(input.workflow, {
    ...(input.variant ? { variant: input.variant } : {}),
    ...(input.operation ? { operation: input.operation } : {}),
  })
  return [...new Set([...(input.baseStrategies ?? []), ...stack, ...workflow])]
}

export * as Strategy from "./strategy"
