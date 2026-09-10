import type { SessionV1 } from "@opencode-ai/core/v1/session"

export type FailureSignal = {
  readonly hasFailure: boolean
  readonly code?: string
  readonly tool?: string
  readonly summary?: string
  readonly retrySameSemanticAction: boolean
}

const BLOCK_CODES = [
  "SCOPE_BLOCKED",
  "PLAN_SCOPE_BLOCKED",
  "WORKFLOW_BYPASS_BLOCKED",
  "BUILD_PERMISSION_REQUIRED",
  "PERMISSION_DENIED",
] as const

const WAIT_CODES = ["OWNER_BUSY"] as const

export function inspect(messages: ReadonlyArray<SessionV1.WithParts>): FailureSignal {
  for (let mi = messages.length - 1; mi >= 0; mi--) {
    const message = messages[mi]
    if (message?.info.role !== "assistant") continue
    for (let pi = message.parts.length - 1; pi >= 0; pi--) {
      const part = record(message.parts[pi])
      if (!part || part.type !== "tool") continue
      const state = record(part.state)
      if (!state) continue
      if (!failed(state)) return { hasFailure: false, retrySameSemanticAction: true }
      const tool = typeof part.tool === "string" ? part.tool : undefined
      const text = failureText(state)
      const code = failureCode(text)
      const blocked = Boolean(code && BLOCK_CODES.includes(code as (typeof BLOCK_CODES)[number]))
      const waiting = Boolean(code && WAIT_CODES.includes(code as (typeof WAIT_CODES)[number]))
      return {
        hasFailure: true,
        ...(code ? { code } : {}),
        ...(tool ? { tool } : {}),
        ...(text ? { summary: summarize(text) } : {}),
        retrySameSemanticAction: !blocked && !waiting,
      }
    }
  }
  return { hasFailure: false, retrySameSemanticAction: true }
}

export function render(signal: FailureSignal): string | undefined {
  if (!signal.hasFailure) return undefined
  return [
    "=== OCX FAILURE EVIDENCE ===",
    ...(signal.code ? [`class=${signal.code}`] : []),
    ...(signal.tool ? [`tool=${signal.tool}`] : []),
    ...(signal.summary ? [`evidence=${signal.summary}`] : []),
    signal.code === "OWNER_BUSY"
      ? "recovery=The owner is temporarily busy and the task is queued. Do not spawn a duplicate owner or retry immediately; resume after owner availability changes."
      : signal.retrySameSemanticAction
        ? "recovery=Use the failure evidence to correct the next action. Do not repeat an unchanged failed attempt."
        : "recovery=This operation class is blocked. Do not retry it through another tool or execution surface.",
    "=== END OCX FAILURE EVIDENCE ===",
  ].join("\n")
}

function failed(state: Record<string, unknown>): boolean {
  if (state.status === "error" || state.status === "failed") return true
  const metadata = record(state.metadata)
  return Boolean(metadata && typeof metadata.exit === "number" && metadata.exit !== 0)
}

function failureText(state: Record<string, unknown>): string {
  for (const key of ["error", "output", "message", "result"]) {
    const value = state[key]
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  const metadata = record(state.metadata)
  if (metadata) {
    for (const key of ["error", "stderr", "output"]) {
      const value = metadata[key]
      if (typeof value === "string" && value.trim()) return value.trim()
    }
  }
  return "tool action failed"
}

function failureCode(text: string): string | undefined {
  const structured = /^code:\s*([A-Z_]+)/m.exec(text)?.[1]
  if (structured) return structured
  return /\b([A-Z][A-Z_]{3,}_BLOCKED|SCOPE_BLOCKED|PLAN_SCOPE_BLOCKED|INPUT_INVALID|OWNER_BUSY)\b/.exec(text)?.[1]
}

function summarize(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 320)
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

export * as FailureSignal from "./failure-signal"
