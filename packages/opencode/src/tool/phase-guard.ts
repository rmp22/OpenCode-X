import PROMPT_CLEAN_CODE from "../session/prompt/ocx-clean-code.txt"
import PROMPT_ENGINEERING from "../session/prompt/ocx-engineering.txt"
import PROMPT_QUALITY from "../session/prompt/ocx-quality.txt"
import PROMPT_NOTICES from "../session/prompt/ocx-notices.txt"
import PROMPT_STACK from "../session/prompt/ocx-stack.txt"
import PROMPT_THINKING from "../session/prompt/ocx-thinking.txt"
import PROMPT_UI_CORE from "../session/prompt/ocx-ui-core.txt"
import PROMPT_WRITE from "../session/prompt/ocx-write.txt"
import { Strategy } from "@/session/prompt/strategy"

type State = {
  lastCall?: string
  repeatCount: number
  readFiles: Set<string>
  changedSinceRead: Set<string>
  reminders: string[]
  mutated: boolean
  callTally: number
  totalCalls: number
  pendingVerification: boolean
  lastMutationPath?: string
  lastVerification?: "pass" | "fail"
  loadedStrategies: Set<Strategy.StrategyName>
  structureRecorded: boolean
  designRecorded: boolean
  auditRecorded: boolean
}

type ToolResultMetadata = Record<string, unknown>

const states = new Map<string, State>()
const mutationTools = new Set(["apply_patch", "edit", "write"])

const MUTATION_REVIEW_PROMPT = [
  "=== MUTATION REVIEW ===",
  "- Check changed files, imports, signatures, references, module links, dead code, stubs, and placeholders.",
  "- Keep behavior, errors, security, compatibility, and tests unless the requirements bar allows a change.",
  "- Verify changed inputs, outputs, settings, and APIs against source or documentation.",
  "- Test relevant empty, failed, denied, cancelled, timed-out, and partial states.",
  "- Record the structure and, for a screen, the design direction before changing files. Record the audit before verification.",
  "- For screens, reject purple gradients, CSS product art, generic centered heroes, ticker strips, stat rows, equal feature cards, and category templates unless the user or source requires them.",
  "- If the page could describe any product in the category, change the structure, type roles, media argument, and section pacing before delivery.",
  "- For a screen, load the selected ui, browser, and audit strategies before delivery and inspect rendered evidence.",
  "- No hallucinated imports or guessed setup.",
  "=== END MUTATION REVIEW ===",
].join("\n")

const SIMPLE_ENGLISH_REMINDER =
  "Use simple English: short active sentences, common words, no filler, jargon, metaphors, hype, or repeated points."

const VERIFICATION_COMMAND =
  /\b(?:audit|build|check|compile|coverage|format|lint|playwright|pytest|test|typecheck|verify|validate)\b/i

const SHELL_MUTATION_COMMAND =
  /(?:^|[;&|]\s*)(?:cp|git\s+(?:add|mv|rm)|install|mkdir|mktemp|mv|rm|rmdir|tee|touch|truncate)\b|(?:>>?|\b(?:write_text|write_bytes|writeFile)\s*\()/i

const CODEGEN_STRATEGIES = new Set<Strategy.StrategyName>([
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
])
const REQUIRED_STRATEGIES = ["quality", "write", "engineering", "stack"] as const

export const CODEGEN_PROMPTS = [
  PROMPT_WRITE,
  PROMPT_ENGINEERING,
  PROMPT_STACK,
  PROMPT_QUALITY,
  PROMPT_CLEAN_CODE,
  MUTATION_REVIEW_PROMPT,
  SIMPLE_ENGLISH_REMINDER,
].join("\n\n")

const section = (text: string, name: string) => {
  const marker = `=== ${name} ===`
  const start = text.indexOf(marker)
  if (start === -1) return ""
  const end = text.indexOf("\n=== ", start + marker.length)
  return text.slice(start + marker.length, end === -1 ? undefined : end).trim()
}

const state = (sessionID: string) => {
  let result = states.get(sessionID)
  if (result) return result
  result = {
    repeatCount: 0,
    readFiles: new Set(),
    changedSinceRead: new Set(),
    reminders: [],
    mutated: false,
    callTally: 0,
    totalCalls: 0,
    pendingVerification: false,
    loadedStrategies: new Set(),
    structureRecorded: false,
    designRecorded: false,
    auditRecorded: false,
  }
  states.set(sessionID, result)
  return result
}

const filePath = (args: Record<string, unknown>) => (typeof args.filePath === "string" ? args.filePath : undefined)

const addReminder = (state: State, reminder: string) => {
  if (reminder && !state.reminders.includes(reminder)) state.reminders.push(reminder)
}

const codegenPrompts = (current: State) => {
  const ui = requiresDesign(current) ? [PROMPT_UI_CORE] : []
  const selected = current.loadedStrategies
    .values()
    .filter((name) => CODEGEN_STRATEGIES.has(name))
    .toArray()
    .toSorted()
    .map((name) => [`=== SELECTED CODEGEN STRATEGY: ${name} ===`, Strategy.load(name)].join("\n"))
  return [CODEGEN_PROMPTS, ...ui, ...selected].join("\n\n")
}

const command = (args: Record<string, unknown>) => (typeof args.command === "string" ? args.command : "")

const patchPaths = (args: Record<string, unknown>) => {
  const patch = typeof args.patchText === "string" ? args.patchText : ""
  return [...patch.matchAll(/^\*\*\* (?:Add|Delete|Update) File: (.+)$/gm)].map((match) => match[1].trim())
}

const mutationPaths = (tool: string, args: Record<string, unknown>) => {
  if (tool === "apply_patch") return patchPaths(args)
  if (mutationTools.has(tool)) {
    const path = filePath(args)
    return path ? [path] : []
  }
  if (tool === "bash" && SHELL_MUTATION_COMMAND.test(command(args))) return [command(args)]
  return []
}

const isMutation = (tool: string, args: Record<string, unknown>) =>
  mutationTools.has(tool) || (tool === "bash" && SHELL_MUTATION_COMMAND.test(command(args)))

const strategyNames = (value: unknown) => {
  if (!Array.isArray(value)) return []
  return value.filter(
    (name): name is Strategy.StrategyName =>
      typeof name === "string" && Strategy.STRATEGY_NAMES.includes(name as Strategy.StrategyName),
  )
}

const missingStrategies = (current: State) => REQUIRED_STRATEGIES.filter((name) => !current.loadedStrategies.has(name))

const requiresDesign = (current: State) =>
  current.loadedStrategies.has("ui") || current.loadedStrategies.has("web-design")

const isVerificationTool = (tool: string, args: Record<string, unknown>) =>
  tool === "bash" && VERIFICATION_COMMAND.test(command(args))

function verificationStatus(tool: string, args: Record<string, unknown>, metadata: ToolResultMetadata) {
  if (tool !== "bash" || !VERIFICATION_COMMAND.test(command(args))) return
  return metadata.exit === 0 ? ("pass" as const) : ("fail" as const)
}

export function prompts(): string[] {
  return [
    PROMPT_THINKING,
    [
      "OCX STRATEGY CATALOG — load a strategy with the strategy tool when its trigger applies.",
      "Skipping a required load is a violation.",
      "",
      Strategy.catalog(),
    ].join("\n"),
  ]
}

export function recordToolCall(sessionID: string, tool: string, args: Record<string, unknown>): void {
  const current = state(sessionID)
  current.totalCalls += 1
  if (current.totalCalls === 1 && tool !== "strategy") {
    addReminder(current, section(PROMPT_NOTICES, "STRATEGY GATE NOTICE"))
  }
  if (current.totalCalls === 12 || current.totalCalls === 24) {
    addReminder(current, section(PROMPT_NOTICES, "TASK BUDGET NOTICE").replace("{count}", String(current.totalCalls)))
  }
  const call = `${tool}\u0000${JSON.stringify(args)}`
  current.repeatCount = current.lastCall === call ? current.repeatCount + 1 : 0
  current.lastCall = call

  if (current.repeatCount === 2) addReminder(current, section(PROMPT_NOTICES, "REPLAY NOTICE"))
  if (current.repeatCount >= 3) addReminder(current, section(PROMPT_NOTICES, "CRITICAL REPLAY NOTICE"))

  if (current.pendingVerification && !isVerificationTool(tool, args)) {
    addReminder(
      current,
      section(PROMPT_NOTICES, "POST-MUTATION NOTICE").replace(
        "{path}",
        current.lastMutationPath ?? "the changed files",
      ),
    )
  }

  const path = filePath(args)
  if (tool === "read" && path) {
    if (current.readFiles.has(path) && !current.changedSinceRead.has(path)) {
      addReminder(current, section(PROMPT_NOTICES, "READ AGAIN NOTICE").replace("{path}", path))
    }
    current.readFiles.add(path)
    current.changedSinceRead.delete(path)
  }

  if (isMutation(tool, args)) {
    const paths = mutationPaths(tool, args)
    for (const changedPath of paths) current.changedSinceRead.add(changedPath)
    current.callTally = 0
    current.pendingVerification = true
    current.lastMutationPath = paths.join(", ") || path
    current.lastVerification = undefined
    current.auditRecorded = false
    addReminder(
      current,
      section(PROMPT_NOTICES, "POST-MUTATION NOTICE").replace(
        "{path}",
        current.lastMutationPath ?? "the changed files",
      ),
    )
    if (!current.mutated) {
      current.mutated = true
      addReminder(current, codegenPrompts(current))
    }
    for (const changedPath of paths.filter((value) => !value.includes("\n"))) {
      if (!current.readFiles.has(changedPath)) {
        addReminder(current, `Read ${changedPath} and its nearby code before editing it.`)
      }
    }
    if (missingStrategies(current).length > 0 || !current.structureRecorded) {
      addReminder(current, section(PROMPT_NOTICES, "STRATEGY GATE NOTICE"))
    }
    return
  }

  current.callTally += 1
  if (current.callTally % 8 === 0) {
    addReminder(current, section(PROMPT_NOTICES, "TOOL METER NOTICE").replace("{count}", String(current.callTally)))
  }
}

export function mutationGate(sessionID: string, tool: string, args: Record<string, unknown>): string | undefined {
  if (!isMutation(tool, args)) return
  const current = state(sessionID)
  const missing = missingStrategies(current)
  const messages = []
  if (missing.length > 0) messages.push(`Load these strategies before changing files: ${missing.join(", ")}.`)
  if (!current.structureRecorded) messages.push("Call the structure tool before changing files.")
  if (requiresDesign(current) && !current.designRecorded)
    messages.push("Call the design tool before building a screen.")
  if (requiresDesign(current) && !current.loadedStrategies.has("fonts"))
    messages.push("Load the fonts strategy before building a screen.")
  return messages.length > 0 ? messages.join(" ") : undefined
}

export function toolGate(sessionID: string, tool: string, args: Record<string, unknown>): string | undefined {
  const mutation = mutationGate(sessionID, tool, args)
  if (mutation) return mutation
  const current = state(sessionID)
  if (tool === "audit" && !current.loadedStrategies.has("audit")) {
    return "Load the audit strategy before calling the audit tool."
  }
  if (current.pendingVerification && isVerificationTool(tool, args) && !current.auditRecorded) {
    return "Call the audit tool before running verification."
  }
  return
}

export function recordToolResult(
  sessionID: string,
  tool: string,
  args: Record<string, unknown>,
  metadata: ToolResultMetadata,
): void {
  const current = state(sessionID)
  if (tool === "structure") {
    current.structureRecorded = true
    return
  }
  if (tool === "design") {
    current.designRecorded = true
    return
  }
  if (tool === "audit") {
    current.auditRecorded = true
    return
  }
  if (tool === "strategy") {
    for (const name of strategyNames(metadata.strategies)) current.loadedStrategies.add(name)
    return
  }
  const status = verificationStatus(tool, args, metadata)
  if (!status) return

  current.lastVerification = status
  current.pendingVerification = status !== "pass"
  if (status === "fail") addReminder(current, section(PROMPT_NOTICES, "VERIFICATION FAILURE NOTICE"))
}

export function takeReminders(sessionID: string): string[] {
  const current = state(sessionID)
  const reminders = current.reminders
  current.reminders = []
  return reminders
}

export function requireCompletion(sessionID: string): boolean {
  const current = state(sessionID)
  if (!current.mutated) return false
  if (!current.auditRecorded) {
    addReminder(current, "Call the audit tool before the final response.")
    return true
  }
  if (current.pendingVerification) {
    addReminder(current, "Run a passing verification command before the final response.")
    return true
  }
  return false
}

export * as PhaseGuard from "./phase-guard"
