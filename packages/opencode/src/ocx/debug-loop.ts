import { Ledger, type LedgerEntry, type Message } from "./ledger"

export const LOCKED_TOOLS = ["edit", "write", "multiedit", "notebookedit", "apply_patch", "task"] as const

export type DebugState = {
  readonly hasFailingRun: boolean
  readonly consecutiveRedRuns: number
  readonly needsExplanation: boolean
  readonly changedPath?: string
}

const RUBBER_DUCK = /\b(?:RUBBER[- ]DUCK|CAUSE CHAIN)\s*:/i
const EXPLANATION_DETAIL = /\b(?:changed|hunk|line|file|failure|cause|because)\b/i

export function inspect(messages: ReadonlyArray<Message>): DebugState {
  const entries = Ledger.ledger(messages)
  const commands = entries.filter(
    (entry): entry is Extract<LedgerEntry, { kind: "command" }> => entry.kind === "command",
  )
  const changed = Ledger.changedPaths(entries)
  const consecutiveRedRuns = countTrailingFailures(commands)
  return {
    hasFailingRun: commands.some((entry) => entry.outcome === "failed"),
    consecutiveRedRuns,
    needsExplanation: consecutiveRedRuns >= 2 && !hasExplanationAfterLastFailure(messages),
    ...(changed.at(-1) ? { changedPath: changed.at(-1) } : {}),
  }
}

export function lockReason(messages: ReadonlyArray<Message>): string | undefined {
  const state = inspect(messages)
  if (!state.hasFailingRun)
    return "run one deterministic failing command before changing code; read and search remain available"
  if (state.needsExplanation)
    return "write a RUBBER-DUCK line naming the changed file or hunk, observed failure, and causal chain before another fix"
  return undefined
}

export function lockedTools(messages: ReadonlyArray<Message>): readonly string[] {
  return lockReason(messages) ? LOCKED_TOOLS : []
}

export function directive(messages: ReadonlyArray<Message>): string | undefined {
  const state = inspect(messages)
  const reason = lockReason(messages)
  if (!reason) return undefined
  const detail = state.needsExplanation
    ? `A second consecutive command failure is recorded${state.changedPath ? ` after changing ${state.changedPath}` : ""}.`
    : "No failing command is recorded for this debugging turn."
  return [
    "=== OCX DEBUGGING LOCK ===",
    detail,
    `Do not use ${LOCKED_TOOLS.join(", ")} until the lock condition is satisfied.`,
    `Required next action: ${reason}.`,
    "=== END OCX DEBUGGING LOCK ===",
  ].join("\n")
}

function countTrailingFailures(commands: readonly Extract<LedgerEntry, { kind: "command" }>[]): number {
  let count = 0
  for (let index = commands.length - 1; index >= 0; index--) {
    if (commands[index]?.outcome !== "failed") break
    count++
  }
  return count
}

function hasExplanationAfterLastFailure(messages: ReadonlyArray<Message>): boolean {
  let failed = false
  let explained = false
  for (const message of messages) {
    if (message.info.role !== "assistant") continue
    for (const raw of message.parts) {
      const part = record(raw)
      if (!part) continue
      if (part.type === "tool") {
        if (commandFailed(part)) {
          failed = true
          explained = false
        }
        continue
      }
      if (!failed || part.type !== "text" || typeof part.text !== "string") continue
      if (RUBBER_DUCK.test(part.text) && EXPLANATION_DETAIL.test(part.text)) explained = true
    }
  }
  return explained
}

function commandFailed(part: Record<string, unknown>): boolean {
  if (typeof part.tool !== "string" || !["bash", "shell"].includes(part.tool.toLowerCase())) return false
  const state = record(part.state)
  if (!state) return false
  if (state.status === "error") return true
  const metadata = record(state.metadata)
  return Boolean(metadata && "exit" in metadata && metadata.exit !== 0)
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

export * as DebugLoop from "./debug-loop"
