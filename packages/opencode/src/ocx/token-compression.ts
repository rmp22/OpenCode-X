import path from "node:path"

export type CompressionOptions = {
  readonly maxOutputLines?: number
  readonly maxOutputChars?: number
  readonly projectRoot?: string
}

const DEFAULT_MAX_LINES = 120
const DEFAULT_MAX_CHARS = 12_000
const HEAD_LINES = 25
const TAIL_LINES = 50

/**
 * Truncates long terminal/tool outputs by preserving the head (command start)
 * and tail (exit status, error trace, and test summary), trimming the middle.
 */
export function compressToolOutput(output: string, options: CompressionOptions = {}): string {
  if (!output || typeof output !== "string") return output
  const maxChars = options.maxOutputChars ?? DEFAULT_MAX_CHARS
  const maxLines = options.maxOutputLines ?? DEFAULT_MAX_LINES

  if (output.length <= maxChars && output.split("\n").length <= maxLines) {
    return output
  }

  const lines = output.split("\n")
  if (lines.length > maxLines) {
    const head = lines.slice(0, HEAD_LINES)
    const tail = lines.slice(-TAIL_LINES)
    const omitted = lines.length - HEAD_LINES - TAIL_LINES
    const compressed = [
      ...head,
      `... [${omitted} lines omitted to conserve tokens] ...`,
      ...tail,
    ].join("\n")

    return compressed.length > maxChars ? compressed.slice(0, maxChars) + "\n... [truncated]" : compressed
  }

  if (output.length > maxChars) {
    return output.slice(0, maxChars) + "\n... [output truncated]"
  }

  return output
}

export function compressPath(targetPath: string, rootDir: string): string {
  if (!targetPath || !rootDir) return targetPath
  const resolvedTarget = path.resolve(rootDir, targetPath)
  const resolvedRoot = path.resolve(rootDir)

  if (resolvedTarget.startsWith(resolvedRoot)) {
    const relative = path.relative(resolvedRoot, resolvedTarget)
    return relative ? `./${relative}` : "."
  }

  return targetPath
}

/**
 * Strips redundant repeated whitespace and blank lines from prompts or outputs.
 */
export function collapseWhitespace(text: string): string {
  return text.replace(/[ \t]{3,}/g, "  ").replace(/\n{4,}/g, "\n\n")
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

export function summarizeToolOutputForHistory(tool: string, inputRaw: unknown, outputRaw: unknown): string {
  const input = record(inputRaw)
  const output = typeof outputRaw === "string" ? outputRaw : ""

  switch (tool.toLowerCase()) {
    case "read": {
      const filePath = input?.filePath ?? input?.file_path ?? input?.path ?? "file"
      const lines = output ? output.split("\n").length : 0
      return `[Read: '${filePath}' (${lines} lines)]`
    }
    case "write": {
      const filePath = input?.filePath ?? input?.file_path ?? input?.path ?? "file"
      const len = output.length || (typeof input?.content === "string" ? input.content.length : 0)
      return `[Wrote: '${filePath}' (${Math.round((len / 1024) * 10) / 10} KB)]`
    }
    case "edit":
    case "apply_patch": {
      const filePath = input?.filePath ?? input?.file_path ?? input?.path ?? "file"
      return `[Edited: '${filePath}']`
    }
    case "bash":
    case "shell": {
      const cmd = typeof input?.command === "string" ? input.command.trim().slice(0, 60) : "command"
      const failed = /error|failed|exit\s*code\s*[1-9]/i.test(output)
      return `[Ran: '${cmd}' -> ${failed ? "failed" : "success"}]`
    }
    case "glob": {
      const pattern = input?.pattern ?? "*"
      const matches = output ? output.trim().split("\n").filter(Boolean).length : 0
      return `[Glob: '${pattern}' -> ${matches} match(es)]`
    }
    case "grep": {
      const pattern = input?.pattern ?? ""
      const matches = output ? output.trim().split("\n").filter(Boolean).length : 0
      return `[Grep: '${pattern}' -> ${matches} match(es)]`
    }
    case "design": {
      const dir = input?.direction ?? "visual direction"
      return `[Design: ${dir}]`
    }
    case "ocx_plan": {
      return `[OCX Plan: accepted]`
    }
    case "ocx_progress": {
      return `[OCX Progress: updated]`
    }
    default:
      return `[Completed ${tool} operation]`
  }
}

export type TerminologySavings = {
  readonly originalChars: number
  readonly compressedChars: number
  readonly savedChars: number
  readonly estimatedTokensSaved: number
  readonly reductionRatio: string
}

export type TerminologyContext = {
  readonly sessionID: string
  readonly cwd: string
  readonly worktree?: string
}

const DEFAULT_KEY_ALIASES: Readonly<Record<string, string>> = {
  reference_path: "rp",
  filePath: "fPth",
  file_path: "fPth",
  command: "cmd",
  plan: "pln",
  wrapper: "wrpr",
  operation: "op",
  evidence: "ev",
  description: "desc",
  workflow: "wf",
  workstream: "ws",
  target: "tgt",
  targets: "tgts",
  content: "cnt",
  status: "st",
  summary: "sum",
  path: "pth",
  pattern: "pat",
  oldString: "oStr",
  newString: "nStr",
  reason: "rsn",
  message: "msg",
  todos: "tds",
}

const REVERSE_KEY_ALIASES: Readonly<Record<string, string>> = {
  rp: "reference_path",
  fPth: "filePath",
  fp: "filePath",
  cmd: "command",
  pln: "plan",
  wrpr: "wrapper",
  op: "operation",
  ev: "evidence",
  desc: "description",
  wf: "workflow",
  ws: "workstream",
  tgt: "target",
  tgts: "targets",
  cnt: "content",
  st: "status",
  sum: "summary",
  pth: "path",
  pat: "pattern",
  oStr: "oldString",
  nStr: "newString",
  rsn: "reason",
  msg: "message",
  tds: "todos",
}

type SessionState = {
  cwd: string
  worktree?: string
  variables: Map<string, string>
  reverseVariables: [string, string][]
  originalChars: number
  compressedChars: number
}

const sessionStates = new Map<string, SessionState>()

export function initSession(context: TerminologyContext): void {
  const vars = new Map<string, string>()
  const cleanCwd = path.resolve(context.cwd)
  vars.set("$" + "WD", cleanCwd)
  vars.set("$PselfPth", cleanCwd)
  if (context.worktree) {
    const cleanWorktree = path.resolve(context.worktree)
    if (cleanWorktree !== cleanCwd) vars.set("$REPO", cleanWorktree)
  }
  vars.set("$TMP", "/tmp/ocx")

  const reverse: [string, string][] = [...vars.entries()]
    .map(([v, val]) => [val, v] as [string, string])
    .sort((a, b) => b[0].length - a[0].length)

  const existing = sessionStates.get(context.sessionID)
  sessionStates.set(context.sessionID, {
    cwd: cleanCwd,
    ...(context.worktree ? { worktree: context.worktree } : {}),
    variables: vars,
    reverseVariables: reverse,
    originalChars: existing?.originalChars ?? 0,
    compressedChars: existing?.compressedChars ?? 0,
  })
}

export function registerVariable(sessionID: string, variable: string, value: string): void {
  let state = sessionStates.get(sessionID)
  if (!state) {
    initSession({ sessionID, cwd: process.cwd() })
    state = sessionStates.get(sessionID)
  }
  if (!state || !variable || !value) return
  const varKey = variable.startsWith("$") ? variable : `$${variable}`
  const cleanVal = (value === "/proc/self/cwd" || value === "/proc/self/cwd/")
    ? (state.variables.get("$" + "WD") ?? path.resolve(value))
    : path.resolve(value)
  state.variables.set(varKey, cleanVal)
  state.reverseVariables = [...state.variables.entries()]
    .map(([v, val]) => [val, v] as [string, string])
    .sort((a, b) => b[0].length - a[0].length)
}

export function recordSavings(sessionID: string, originalLen: number, compressedLen: number): void {
  const state = sessionStates.get(sessionID)
  if (!state || originalLen <= compressedLen) return
  state.originalChars += originalLen
  state.compressedChars += compressedLen
}

export function compressString(sessionID: string, text: string): string {
  if (!text || typeof text !== "string") return text
  let state = sessionStates.get(sessionID)
  if (!state) {
    initSession({ sessionID, cwd: process.cwd() })
    state = sessionStates.get(sessionID)
  }
  if (!state || state.reverseVariables.length === 0) return text
  let result = text
  for (const [val, variable] of state.reverseVariables) {
    if (result.includes(val)) {
      result = result.replaceAll(val, variable)
    }
  }
  if (result.length < text.length) {
    recordSavings(sessionID, text.length, result.length)
  }
  return result
}

export function expandString(sessionID: string, text: string): string {
  if (!text || typeof text !== "string") return text
  let state = sessionStates.get(sessionID)
  if (!state) {
    initSession({ sessionID, cwd: process.cwd() })
    state = sessionStates.get(sessionID)
  }
  if (!state) return text
  let result = text
  const sortedVars = [...state.variables.entries()].sort((a, b) => b[0].length - a[0].length)
  for (const [variable, val] of sortedVars) {
    if (result.includes(variable)) {
      result = result.replaceAll(variable, val)
    }
  }
  return result
}

export function compressJson(sessionID: string, value: unknown): unknown {
  if (value === null || value === undefined) return value
  if (typeof value === "string") return compressString(sessionID, value)
  if (Array.isArray(value)) return value.map((item) => compressJson(sessionID, item))
  if (typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const shortKey = DEFAULT_KEY_ALIASES[k] ?? k
      const compressedVal = compressJson(sessionID, v)
      out[shortKey] = compressedVal
      if (k === "filePath") {
        out["fp"] = compressedVal
        out["fPth"] = compressedVal
      }
    }
    return out
  }
  return value
}

export function expandJson(sessionID: string, value: unknown): unknown {
  if (value === null || value === undefined) return value
  if (typeof value === "string") return expandString(sessionID, value)
  if (Array.isArray(value)) return value.map((item) => expandJson(sessionID, item))
  if (typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const fullKey = REVERSE_KEY_ALIASES[k] ?? k
      out[fullKey] = expandJson(sessionID, v)
    }
    return out
  }
  return value
}

export function getSavings(sessionID: string): TerminologySavings {
  const state = sessionStates.get(sessionID)
  const originalChars = state?.originalChars ?? 0
  const compressedChars = state?.compressedChars ?? 0
  const savedChars = Math.max(0, originalChars - compressedChars)
  const estimatedTokensSaved = Math.ceil(savedChars / 4)
  const ratio = originalChars > 0 ? ((savedChars / originalChars) * 100).toFixed(1) + "%" : "0.0%"
  return {
    originalChars,
    compressedChars,
    savedChars,
    estimatedTokensSaved,
    reductionRatio: ratio,
  }
}

export function renderTerminologyHeader(sessionID: string): string | undefined {
  const state = sessionStates.get(sessionID)
  if (!state) return undefined
  const savings = getSavings(sessionID)
  const varPairs = [...state.variables.entries()].map(([k, v]) => `${k}=${v}`).join(" | ")
  const keyPairs = "fPth=filePath, cmd=command, pln=plan, wrpr=wrapper, ev=evidence, desc=description, rp=reference_path"
  return [
    "=== OCX SESSION TERMINOLOGY (TOKEN COMPRESSION) ===",
    `Variables: ${varPairs}`,
    `Key Aliases: ${keyPairs}`,
    `Token reduction in effect: ${savings.estimatedTokensSaved} tokens saved (${savings.reductionRatio} reduction)`,
    "=== END OCX SESSION TERMINOLOGY ===",
  ].join("\n")
}

export function clearSession(sessionID: string): void {
  sessionStates.delete(sessionID)
}

export * as TokenCompression from "./token-compression"
