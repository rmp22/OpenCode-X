import type { ReasoningActivity, ReasoningStatusContext } from "./status"
import { SecretRedaction } from "../secret-redaction"

const GENERIC_TITLES = new Set([
  "thinking",
  "working",
  "working on the task",
  "continuing",
  "checking things",
  "analyzing the problem",
  "performing required operations",
])

const GENERIC_PATTERNS = [/^thinking$/i, /^working$/i, /^checking$/i, /^continuing$/i, /^analyzing$/i]

const MAX_TITLE_WORDS = 9
const MAX_TITLE_CHARS = 80
const MIN_TITLE_WORDS = 2

function basename(path: string): string {
  const normalized = path.replaceAll("\\", "/")
  const last = normalized.split("/").pop() ?? normalized
  return last.split("?")[0].split("#")[0].slice(0, 40)
}

function truncateTitle(value: string): string {
  if (value.length <= MAX_TITLE_CHARS) return value
  return value.slice(0, MAX_TITLE_CHARS - 3).trimEnd() + "..."
}

function normalizeActivity(activity: ReasoningActivity): string {
  switch (activity) {
    case "inspecting":
      return "Inspecting"
    case "searching":
      return "Searching"
    case "editing":
      return "Editing"
    case "running":
      return "Running"
    case "delegating":
      return "Delegating"
    case "recovering":
      return "Recovering from"
    case "verifying":
      return "Verifying"
    case "finalizing":
      return "Finalizing"
    case "waiting":
      return "Waiting for"
    case "planning":
      return "Planning"
    case "thinking":
      return "Thinking about"
    default:
      return "Working on"
  }
}

export function synthesizeTitle(ctx: ReasoningStatusContext): string {
  const activity = ctx.activity ?? "thinking"
  const action = ctx.action?.trim()
  const target = ctx.target?.trim()
  const capability = ctx.capability?.trim()
  const recovery = ctx.recoveryClass?.trim()

  if (recovery) return truncateTitle(`Recovering from ${recovery}`)

  if (activity === "recovering" && target) return truncateTitle(`Recovering from ${basename(target)}`)
  if (activity === "recovering") return truncateTitle("Recovering from the previous error")

  if (ctx.toolName) {
    const toolTitle = titleFromTool(ctx.toolName, target, capability)
    if (toolTitle) return truncateTitle(toolTitle)
  }

  if (action && target) {
    const verb = capitalize(action)
    return truncateTitle(`${verb} ${basename(target)}`)
  }
  if (action) return truncateTitle(capitalize(action))
  if (target) return truncateTitle(`${normalizeActivity(activity)} ${basename(target)}`)

  if (ctx.workflowPhase) return truncateTitle(`Working on ${ctx.workflowPhase}`)
  if (ctx.taskObjective) return truncateTitle(`Analyzing ${ctx.taskObjective.slice(0, 40)}`)

  return truncateTitle(defaultForActivity(activity))
}

function titleFromTool(toolName: string, target?: string, capability?: string): string | undefined {
  const t = target ? basename(target) : ""
  switch (toolName) {
    case "read":
      return t ? `Reading ${t}` : "Inspecting the workspace"
    case "write":
      return t ? `Creating ${t}` : "Creating the new file"
    case "edit":
    case "apply_patch":
      return t ? `Editing ${t}` : "Applying the code changes"
    case "grep":
    case "search":
      return target ? `Searching for ${target.slice(0, 30)}` : "Searching the codebase"
    case "glob":
      return "Finding matching files"
    case "websearch":
    case "webfetch":
      return target ? `Researching ${t}` : "Researching the topic"
    case "bash":
      if (capability === "build") return "Running the project build"
      if (capability === "test") return "Running the tests"
      if (target?.includes("typecheck")) return "Running the typecheck"
      return t ? `Running ${t}` : "Inspecting the runtime state"
    case "task":
      return target ? `Delegating to ${t}` : "Delegating the subtask"
    default:
      if (target) return `${capitalize(toolName)} ${t}`
      return undefined
  }
}

function defaultForActivity(activity: ReasoningActivity): string {
  switch (activity) {
    case "inspecting":
      return "Inspecting the workspace"
    case "searching":
      return "Searching the codebase"
    case "editing":
      return "Applying the code changes"
    case "running":
      return "Running the next step"
    case "verifying":
      return "Verifying the changes"
    case "planning":
      return "Planning the next step"
    case "recovering":
      return "Recovering from the previous error"
    case "finalizing":
      return "Finalizing the response"
    case "delegating":
      return "Delegating the work"
    default:
      return "Planning the next step"
  }
}

function capitalize(value: string): string {
  if (!value) return ""
  return value.charAt(0).toUpperCase() + value.slice(1)
}

export function validateCandidate(input: {
  title: string
  ctx: ReasoningStatusContext
  lastTitle?: string
  lastSemanticKey?: string
  currentSemanticKey?: string
}): { valid: boolean; reason?: string; sanitized?: string } {
  const raw = input.title.trim()
  if (!raw) return { valid: false, reason: "empty" }
  if (GENERIC_TITLES.has(raw.toLowerCase())) return { valid: false, reason: "generic" }
  if (GENERIC_PATTERNS.some((re) => re.test(raw))) return { valid: false, reason: "generic-pattern" }
  if (raw.length > MAX_TITLE_CHARS) return { valid: false, reason: "too-long" }
  const words = raw.split(/\s+/).filter(Boolean)
  if (words.length < MIN_TITLE_WORDS && !raw.toLowerCase().startsWith("recovering")) return { valid: false, reason: "too-short" }
  if (words.length > MAX_TITLE_WORDS) return { valid: false, reason: "too-many-words" }
  if (raw.includes("  ")) return { valid: false, reason: "double-space" }
  if (/[<>]/.test(raw) && raw.includes("think")) return { valid: false, reason: "raw-thinking-marker" }
  if (raw === input.lastTitle && input.lastSemanticKey !== input.currentSemanticKey) return { valid: false, reason: "stale-duplicate" }
  if (raw.toLowerCase().includes("api token") || raw.toLowerCase().includes("secret")) return { valid: false, reason: "secret-like" }

  const redacted = SecretRedaction.redact(raw)
  if (redacted.redacted) return { valid: false, reason: "secret-redacted" }
  if (redacted.value !== raw) return { valid: false, reason: "secret-redacted" }

  if (/^(?:I am|I will|Let me|We need)/i.test(raw)) return { valid: false, reason: "self-reference" }
  if (raw.endsWith(".")) return { valid: false, reason: "trailing-period" }
  if (/```/.test(raw)) return { valid: false, reason: "code-fence" }
  if (input.ctx.target && words.length <= 2 && !raw.toLowerCase().includes(basename(input.ctx.target).toLowerCase())) {
    if (GENERIC_TITLES.has(raw.toLowerCase()) || words.length < 3) return { valid: false, reason: "generic-while-concrete-available" }
  }

  return { valid: true, sanitized: raw }
}

export function sanitizeTitle(value: string): string {
  const redacted = SecretRedaction.redact(value)
  const base = redacted.value
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\.$/, "")
    .replace(/^Thinking:\s*/i, "")
    .replace(/^Thought:\s*/i, "")
  return truncateTitle(base)
}

export function inferActivityFromTool(toolName: string): ReasoningActivity {
  switch (toolName) {
    case "read":
    case "glob":
      return "inspecting"
    case "grep":
    case "websearch":
    case "webfetch":
      return "searching"
    case "write":
    case "edit":
    case "apply_patch":
      return "editing"
    case "bash":
      return "running"
    case "task":
      return "delegating"
    default:
      return "thinking"
  }
}

export * as Title from "./title"
