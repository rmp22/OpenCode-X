import PROMPT_BUILD from "./ocx-build.txt"
import PROMPT_BROWSER from "./ocx-browser.txt"
import PROMPT_AUDIT from "./ocx-audit.txt"
import PROMPT_COMPLEXITY from "./ocx-complexity.txt"
import PROMPT_ENGINEERING from "./ocx-engineering.txt"
import PROMPT_EXEMPLARS from "./ocx-exemplars.txt"
import PROMPT_FONTS from "./ocx-fonts.txt"
import PROMPT_FRONTIER from "./ocx-frontier.txt"
import PROMPT_STACK_ANDROID from "./ocx-stack-android.txt"
import PROMPT_STACK_CPP from "./ocx-stack-cpp.txt"
import PROMPT_STACK_COMPOSE from "./ocx-stack-compose.txt"
import PROMPT_STACK_FRONTEND from "./ocx-stack-frontend.txt"
import PROMPT_STACK_GO from "./ocx-stack-go.txt"
import PROMPT_STACK_JAVA from "./ocx-stack-java.txt"
import PROMPT_STACK_KOTLIN from "./ocx-stack-kotlin.txt"
import PROMPT_STACK_PYTHON from "./ocx-stack-python.txt"
import PROMPT_STACK_RUST from "./ocx-stack-rust.txt"
import PROMPT_STACK_SWIFT from "./ocx-stack-swift.txt"
import PROMPT_STACK_TYPESCRIPT from "./ocx-stack-typescript.txt"
import PROMPT_MEMORY from "./ocx-memory.txt"
import PROMPT_REASONING from "./ocx-reasoning.txt"
import PROMPT_QUALITY from "./ocx-quality.txt"
import PROMPT_REVIEW_CHECKLIST from "./ocx-review-checklist.txt"
import PROMPT_STACK from "./ocx-stack.txt"
import PROMPT_UI_CORE from "./ocx-ui-core.txt"
import PROMPT_UI_UX from "./ocx-ui-ux.txt"
import PROMPT_WEB from "./ocx-web.txt"
import PROMPT_WEB_DESIGN from "./ocx-web-design.txt"
import PROMPT_WRITE from "./ocx-write.txt"

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
  "quality",
  "exemplars",
  "review",
  "stack",
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

export * as Strategy from "./strategy"
