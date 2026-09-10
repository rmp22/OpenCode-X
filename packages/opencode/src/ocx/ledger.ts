export type CheckKind = "typecheck" | "test" | "build" | "lint"

export type Message = {
  readonly info: { readonly role: string }
  readonly parts: readonly unknown[]
}

export type LedgerEntry =
  | { kind: "read"; path: string }
  | { kind: "write"; path: string }
  | { kind: "edit"; path: string }
  | { kind: "command"; command: string; outcome: "passed" | "failed" | "unknown"; check?: CheckKind }

export type RerunFinding = {
  readonly id: "C32-rerun-greenwashing"
  readonly message: string
  readonly span: string
}

const CHECK_COMMANDS: Record<CheckKind, readonly string[]> = {
  typecheck: [
    "bun run typecheck",
    "tsgo --noemit",
    "tsc --noemit",
    "bunx tsc",
    "mypy",
    "pyright",
    "cargo check",
    "go vet",
  ],
  test: [
    "bun test",
    "bun run test",
    "npm test",
    "npm run test",
    "pnpm test",
    "yarn test",
    "vitest",
    "jest",
    "pytest",
    "cargo test",
    "go test",
    "bazel test",
    "bazelisk test",
  ],
  build: [
    "bun run build",
    "npm run build",
    "pnpm build",
    "cargo build",
    "go build",
    "bazel build",
    "bazelisk build",
  ],
  lint: ["eslint", "biome check", "oxlint", "ruff check", "clippy"],
}

const EXPECT_WORDS: [CheckKind, RegExp][] = [
  ["typecheck", /\b(typecheck|type-check|tsc|tsgo|types)\b/i],
  ["test", /\b(tests?|pytest|vitest|jest)\b/i],
  ["build", /\bbuilds?\b/i],
  ["lint", /\blint\b/i],
]

export function matchExpect(expect: string): CheckKind | undefined {
  for (const [kind, pattern] of EXPECT_WORDS) if (pattern.test(expect)) return kind
  return undefined
}

export function matchCheck(command: string): CheckKind | undefined {
  const normalized = command.trim().toLowerCase().replace(/\s+/g, " ")
  for (const [kind, prefixes] of Object.entries(CHECK_COMMANDS) as [CheckKind, readonly string[]][])
    if (prefixes.some((prefix) => normalized.startsWith(prefix))) return kind
  return undefined
}

type ToolPartView = {
  type: string
  tool: string
  state: { status: string; input?: Record<string, unknown>; output?: string; metadata?: Record<string, unknown> }
}

const READ_TOOLS = new Set(["read", "glob", "grep", "ls", "list"])
const WRITE_TOOLS = new Set(["write"])
const EDIT_TOOLS = new Set(["edit", "multiedit", "patch", "apply_patch"])
const SOURCE_TOOLS = new Set(["webfetch", "websearch", "youtube-transcript"])
const HTTP_URL = /https?:\/\/[^\s<>"'`\])}]+/gi
const DOI = /10\.\d{4,9}\/[^\s<>"'`\])}]+/gi

function pathFrom(input: Record<string, unknown> | undefined): string | undefined {
  const value = input?.filePath ?? input?.file_path ?? input?.path ?? input?.notebook_path
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function commandFrom(input: Record<string, unknown> | undefined): string | undefined {
  const value = input?.command ?? input?.script
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined
}

function patchPaths(state: ToolPartView["state"]): string[] {
  const files = state.metadata?.files
  if (!Array.isArray(files)) return []
  return files.flatMap((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return []
    const file = value as Record<string, unknown>
    return [file.filePath, file.movePath].filter(
      (path): path is string => typeof path === "string" && path.length > 0,
    )
  })
}

function outcomeOf(state: ToolPartView["state"]): "passed" | "failed" | "unknown" {
  if (state.status === "error") return "failed"
  if (state.metadata && "exit" in state.metadata) return state.metadata.exit === 0 ? "passed" : "failed"
  return "unknown"
}

function sourceEvidence(part: ToolPartView): string[] {
  if (part.state?.status !== "completed") return []
  const name = part.tool.toLowerCase()
  if (!SOURCE_TOOLS.has(name)) return []
  const input = part.state.input
  const sources = new Set<string>()
  const url = input?.url
  if ((name === "webfetch" || name === "youtube-transcript") && typeof url === "string") sources.add(url)
  if (name === "websearch" && typeof part.state.output === "string")
    for (const match of part.state.output.matchAll(HTTP_URL)) sources.add(match[0])
  if (typeof part.state.output === "string")
    for (const match of part.state.output.matchAll(DOI)) sources.add(`doi:${match[0].replace(/[.)]+$/, "")}`)
  return [...sources]
}

export function ledger(messages: ReadonlyArray<Message>): LedgerEntry[] {
  const entries: LedgerEntry[] = []
  for (const message of messages) {
    if (message.info.role !== "assistant") continue
    for (const part of message.parts as unknown as ToolPartView[]) {
      if (part.type !== "tool") continue
      const name = part.tool.toLowerCase()
      const input = part.state?.input
      const sources = sourceEvidence(part)
      if (sources.length > 0) {
        for (const path of sources) entries.push({ kind: "read", path })
      } else if (READ_TOOLS.has(name)) {
        const path = pathFrom(input)
        if (path) entries.push({ kind: "read", path })
      } else if (WRITE_TOOLS.has(name)) {
        const path = pathFrom(input)
        if (path) entries.push({ kind: "write", path })
      } else if (EDIT_TOOLS.has(name)) {
        const paths = name === "apply_patch" ? patchPaths(part.state) : [pathFrom(input)]
        for (const path of paths) if (path) entries.push({ kind: "edit", path })
      } else if (name === "bash" || name === "shell") {
        const command = commandFrom(input)
        if (!command) continue
         entries.push({ kind: "command", command, outcome: outcomeOf(part.state ?? { status: "unknown" }), check: matchCheck(command) })
      }
    }
  }
  return entries
}

export function changedPaths(entries: readonly LedgerEntry[]): string[] {
  const paths = new Set<string>()
  for (const entry of entries) if (entry.kind === "write" || entry.kind === "edit") paths.add(entry.path)
  return [...paths]
}

export function sourcePaths(entries: readonly LedgerEntry[]): string[] {
  return entries
    .filter((entry): entry is Extract<LedgerEntry, { kind: "read" }> => entry.kind === "read")
    .map((entry) => entry.path)
    .filter((path) => /^(?:https?:\/\/|doi:)/i.test(path))
}

export function rerunFindings(entries: readonly LedgerEntry[]): RerunFinding[] {
  let previous: { command: string; outcome: "passed" | "failed" | "unknown" } | undefined
  for (const entry of entries) {
    if (entry.kind === "write" || entry.kind === "edit") {
      previous = undefined
      continue
    }
    if (entry.kind !== "command") continue
    const command = entry.command.trim().toLowerCase().replace(/\s+/g, " ")
    if (!command) {
      previous = undefined
      continue
    }
    if (previous?.command === command && previous.outcome === "failed" && entry.outcome === "passed")
      return [
        {
          id: "C32-rerun-greenwashing",
          message: `command "${command}" passed after failing with no intervening file mutation; verify the original cause changed before claiming success`,
          span: command,
        },
      ]
    previous = { command, outcome: entry.outcome }
  }
  return []
}

export function lastOutcome(entries: readonly LedgerEntry[], check: CheckKind): "passed" | "failed" | "none" {
  let result: "passed" | "failed" | "none" = "none"
  for (const entry of entries) {
    if (entry.kind !== "command" || entry.check !== check) continue
    result = entry.outcome === "unknown" ? "none" : entry.outcome
  }
  return result
}

export * as Ledger from "./ledger"
