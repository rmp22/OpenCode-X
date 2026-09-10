import { randomUUID } from "node:crypto"
import { Db } from "../db"
import type { ActionEffect } from "../risk"
import { evaluateOperationPolicy } from "./policy"

export * from "./policy"

export type GateDecision = "go" | "kill" | "hold" | "recycle"

export type GateStatus = "pending" | "approved" | "rejected" | "held" | "recycled" | "timed_out"

export type GateRecord = {
  readonly id: string
  readonly laneID: string
  readonly effect: ActionEffect
  readonly payload: Record<string, unknown>
  readonly options: readonly GateDecision[]
  readonly status: GateStatus
  readonly resumeToken: string
  readonly resolution?: GateResolution
  readonly createdAt: number
  readonly resolvedAt?: number
}

export type GateResolution = {
  readonly decision: GateDecision
  readonly rawAnswer: string
  readonly resumeToken: string
  readonly resolvedAt: number
  readonly metadata?: Record<string, unknown>
}

export type MintGateInput = {
  readonly laneID: string
  readonly effect: ActionEffect
  readonly payload: Record<string, unknown>
  readonly options?: readonly GateDecision[]
}

const activeGateWaiters = new Map<string, (res: GateResolution) => void>()

export function registerGateWaiter(gateID: string, waiter: (res: GateResolution) => void) {
  activeGateWaiters.set(gateID, waiter)
}

export function unregisterGateWaiter(gateID: string) {
  activeGateWaiters.delete(gateID)
}

export function parseGateAnswer(answer: string): GateDecision | undefined {
  const norm = answer
    .toLowerCase()
    .replace(/'/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  if (!norm) return undefined

  if (/\b(?:dont|do not|never|no|stop|kill|abort|deny|denied|cancel|reject|rejected|halt|drop|terminate)\b/i.test(norm)) {
    return "kill"
  }

  if (/\b(?:hold|hold on|wait|pause|defer|later|standby|not now)\b/i.test(norm)) {
    return "hold"
  }

  if (/\b(?:recycle|retry|try again|redo|restart|rerun|re-run)\b/i.test(norm)) {
    return "recycle"
  }

  if (/\b(?:go|go ahead|yes|proceed|approve|approved|ok|okay|continue|yep|sure|do it|lgtm|allow|confirm)\b/i.test(norm)) {
    return "go"
  }

  return undefined
}

export function mintGate(input: MintGateInput): GateRecord {
  const id = `gate_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const resumeToken = `tok_${randomUUID().replace(/-/g, "")}`
  const options = input.options ?? ["go", "kill", "hold", "recycle"]
  const record: GateRecord = {
    id,
    laneID: input.laneID,
    effect: input.effect,
    payload: input.payload,
    options,
    status: "pending",
    resumeToken,
    createdAt: Date.now(),
  }
  Db.insertGate({
    id: record.id,
    lane_id: record.laneID,
    effect: record.effect,
    payload: record.payload,
    options: record.options,
    status: record.status,
    created_at: record.createdAt,
  })
  return record
}

export function resolveGate(
  gateID: string,
  rawAnswer: string,
  metadata?: Record<string, unknown>,
): { success: boolean; resolution?: GateResolution; error?: string } {
  const gate = Db.getGate(gateID)
  if (!gate) {
    return { success: false, error: `gate '${gateID}' not found` }
  }
  if (gate.status !== "pending") {
    return { success: false, error: `gate '${gateID}' is already resolved with status '${gate.status}'` }
  }

  const decision = parseGateAnswer(rawAnswer)
  if (!decision) {
    return { success: false, error: `could not determine decision from answer: '${rawAnswer}'` }
  }

  const status: GateStatus =
    decision === "go"
      ? "approved"
      : decision === "kill"
        ? "rejected"
        : decision === "hold"
          ? "held"
          : "recycled"

  const resumeToken = `tok_${randomUUID().replace(/-/g, "")}`
  const resolvedAt = Date.now()
  const resolution: GateResolution = {
    decision,
    rawAnswer,
    resumeToken,
    resolvedAt,
    metadata,
  }

  Db.updateGate(gateID, {
    status,
    resolution,
    resolved_at: resolvedAt,
  })

  const waiter = activeGateWaiters.get(gateID)
  if (waiter) {
    activeGateWaiters.delete(gateID)
    waiter(resolution)
  }

  return { success: true, resolution }
}

export type ToolResolution = {
  readonly inputName: string
  readonly canonicalName: string
  readonly capability: string
  readonly effects?: readonly string[]
}

export type ToolAuthorizationResult = {
  readonly allowed: boolean
  readonly reason?: string
  readonly renderedFailure?: string
  readonly canonicalToolName?: string
  readonly phaseAfter?: string
}

export type GateFailureRecord = {
  readonly kind: "unknown_tool" | "disallowed_tool" | "repeated_tool" | "policy_blocked"
  readonly toolName: string
  readonly reason?: string
  readonly suggestions?: readonly string[]
}

const TOOL_DEFINITIONS: Record<string, { capability: string; effects: readonly string[] }> = {
  read: { capability: "file.read", effects: ["read"] },
  write: { capability: "file.write", effects: ["mutate", "create"] },
  edit: { capability: "file.edit", effects: ["mutate"] },
  patch: { capability: "file.patch", effects: ["mutate"] },
  bash: { capability: "command.run", effects: ["execute"] },
  glob: { capability: "search.files", effects: ["read"] },
  grep: { capability: "search.text", effects: ["read"] },
  task: { capability: "agent.delegate", effects: ["execute", "delegate"] },
  question: { capability: "user.question", effects: ["interact"] },
  todowrite: { capability: "workflow.todo", effects: ["mutate"] },
  websearch: { capability: "network.read", effects: ["network"] },
  webfetch: { capability: "network.read", effects: ["network"] },
}

const TOOL_ALIAS_MAP: Record<string, string> = {
  "file.read": "read",
  view: "read",
  read_file: "read",
  readFile: "read",
  "file.write": "write",
  create_file: "write",
  writeFile: "write",
  "file.edit": "edit",
  modify: "edit",
  replace: "edit",
  "file.patch": "patch",
  run: "bash",
  "command.run": "bash",
  exec: "bash",
  terminal: "bash",
  shell: "bash",
  "file.glob": "glob",
  find_files: "glob",
  find: "glob",
  search: "grep",
  search_code: "grep",
  find_in_files: "grep",
  "search.text": "grep",
  "agent.delegate": "task",
  subagent: "task",
  subagents: "task",
  "user.question": "question",
  ask: "question",
  "workflow.todo": "todowrite",
  todo: "todowrite",
  web_search: "websearch",
  web_fetch: "webfetch",
}

export function resolveToolName(toolName: unknown): ToolResolution | undefined {
  if (typeof toolName !== "string") {
    return undefined
  }
  const clean = toolName.trim()
  const lower = clean.toLowerCase()
  const canonical = TOOL_ALIAS_MAP[lower] ?? (TOOL_DEFINITIONS[lower] ? lower : undefined)
  if (!canonical) {
    return undefined
  }
  const def = TOOL_DEFINITIONS[canonical]
  return {
    inputName: clean,
    canonicalName: canonical,
    capability: def?.capability ?? "unknown",
    effects: def?.effects,
  }
}

export function resolveTool(toolName: string): { canonicalName: string; effects: readonly string[] } | undefined {
  const res = resolveToolName(toolName)
  if (!res) {
    return undefined
  }
  return {
    canonicalName: res.canonicalName,
    effects: res.effects ?? [],
  }
}

export function capabilityForTool(toolName: unknown): string | undefined {
  return resolveToolName(toolName)?.capability
}

export const WorkflowGateFailure = {
  unknownTool(toolName: string): GateFailureRecord {
    return {
      kind: "unknown_tool",
      toolName,
      suggestions: Object.keys(TOOL_DEFINITIONS),
    }
  },
  disallowedTool(toolName: string, reason: string): GateFailureRecord {
    return {
      kind: "disallowed_tool",
      toolName,
      reason,
    }
  },
  repeatedTool(toolName: string): GateFailureRecord {
    return {
      kind: "repeated_tool",
      toolName,
      reason: `Tool '${toolName}' called repeatedly without progress`,
    }
  },
  renderFailure(failure: GateFailureRecord | unknown): string {
    if (typeof failure === "object" && failure !== null && "kind" in failure) {
      const rec = failure as GateFailureRecord
      if (rec.kind === "unknown_tool") {
        return `Tool '${rec.toolName}' is not recognized. Available tools: ${rec.suggestions?.join(", ")}`
      }
      return rec.reason ?? `Operation rejected by workflow gate for '${rec.toolName}'`
    }
    return String(failure)
  },
}

export function repairToolCall(input: {
  readonly toolName: string
  readonly availableTools: readonly string[]
  readonly sessionID?: string
}): { canonicalToolName: string; arguments?: Record<string, unknown> } | undefined {
  if (input.availableTools.includes(input.toolName)) {
    return undefined
  }
  const res = resolveToolName(input.toolName)
  if (res && input.availableTools.includes(res.canonicalName)) {
    return {
      canonicalToolName: res.canonicalName,
    }
  }
  const normalized = input.toolName.toLowerCase().replace(/[-_.]/g, "")
  const match = input.availableTools.find((t) => t.toLowerCase().replace(/[-_.]/g, "") === normalized)
  if (match) {
    return {
      canonicalToolName: match,
    }
  }
  return undefined
}

export function checkTool(options: {
  readonly toolName: string
  readonly sessionID?: string
  readonly lane?: string
  readonly gate?: unknown
  readonly effects?: readonly string[]
  readonly metadata?: { declaredToolName?: string; canonicalToolName?: string }
}): ToolAuthorizationResult {
  const resolution = resolveToolName(options.toolName)
  const canonical = resolution?.canonicalName ?? options.metadata?.canonicalToolName ?? options.toolName

  return {
    allowed: true,
    canonicalToolName: canonical,
  }
}

export function guardTool(options: {
  readonly toolName: string
  readonly sessionID?: string
  readonly lane?: string
}): ToolAuthorizationResult {
  const resolution = resolveToolName(options.toolName)
  const canonical = resolution?.canonicalName ?? options.toolName
  return {
    allowed: true,
    canonicalToolName: canonical,
  }
}

export function guardAction(options: {
  readonly operation: string
  readonly sessionID?: string
  readonly targetPath?: string
  readonly command?: string
}): { readonly allowed: boolean; readonly reason?: string } {
  const decision = evaluateOperationPolicy({
    toolName: options.operation,
    sessionID: options.sessionID,
    targetPath: options.targetPath,
    command: options.command,
  })

  return {
    allowed: decision.verdict === "allow",
    reason: decision.verdict !== "allow" ? decision.reason : undefined,
  }
}

export function guardEffects(options: {
  readonly effects: readonly string[]
  readonly sessionID?: string
}): { readonly allowed: boolean; readonly reason?: string } {
  const dangerous = options.effects.filter((e) => e === "mutation.delete" || e === "git.destructive" || e === "privilege.escalate")
  if (dangerous.length > 0) {
    return {
      allowed: false,
      reason: `Operation effects [${dangerous.join(", ")}] require explicit gate authorization`,
    }
  }
  return {
    allowed: true,
  }
}

export function authorizeTool(options: {
  readonly toolName: string
  readonly lane?: string
  readonly risk?: number
  readonly budget?: number
}): ToolAuthorizationResult {
  return checkTool({ toolName: options.toolName, lane: options.lane })
}

export function authorizeAction(options: {
  readonly operation: string
  readonly lane?: string
  readonly targetPath?: string
  readonly command?: string
  readonly sessionID?: string
}): { readonly allowed: boolean; readonly reason?: string; readonly renderedFailure?: string; readonly phaseAfter?: string } {
  const decision = evaluateOperationPolicy({
    toolName: options.operation,
    laneID: options.lane,
    sessionID: options.sessionID,
    targetPath: options.targetPath,
    command: options.command,
  })

  return {
    allowed: decision.verdict === "allow",
    reason: decision.verdict !== "allow" ? decision.reason : undefined,
    renderedFailure: decision.verdict !== "allow" ? decision.reason : undefined,
  }
}

export function evaluateToolCall(options: {
  readonly toolName: string
  readonly args?: unknown
  readonly sessionID?: string
}): ToolAuthorizationResult {
  return guardTool({ toolName: options.toolName, sessionID: options.sessionID })
}

export function renderPromptContext(state?: unknown): string {
  const parts: string[] = [
    "=== OCX AGENTIC WORKFLOW ===",
    "ARCHITECTURE: dynamic-capability-graph (loop & graph engineering)",
  ]

  if (typeof state === "object" && state !== null) {
    const s = state as Record<string, any>
    const lane = s.lane ?? "standard"
    const risk = s.risk ?? "standard"
    const pipelineId = s.pipelineId ?? "code-mutation-pipeline"
    parts.push(`LANE: ${lane} (risk=${risk})`)
    parts.push(`ACTIVE PIPELINE: ${pipelineId}`)

    if (s.analysis?.archetype) {
      parts.push(`USER INTENT: ${s.analysis.archetype} (velocity=${s.analysis.velocity ?? "standard"})`)
    }
    if (s.analysis?.steerDirective) {
      parts.push(`STEERING DIRECTIVE: ${s.analysis.steerDirective}`)
    }
    if (s.analysis?.explicitTargets?.length) {
      parts.push(`TARGET SCOPE: ${s.analysis.explicitTargets.join(", ")}`)
    }
    if (s.analysis?.forbiddenActions?.length) {
      parts.push(`USER-RESTRICTED ACTIONS: ${s.analysis.forbiddenActions.join(", ")}`)
    }
    if (s.tuning?.activeDirective) {
      parts.push(`AGENT TUNING: ${s.tuning.activeDirective}`)
    }
  } else {
    parts.push("LANE: standard (dynamic capabilities active)")
    parts.push("AGENT TUNING: Autonomous feedback loops, surgical mutations, empirical checks.")
  }

  parts.push("ATTENTION PROTOCOL: Declarative Attention active. Use <global>, <focus segments=\"...\">, or <local> to control attention span.")
  parts.push("=== END OCX AGENTIC WORKFLOW ===")
  return parts.join("\n")
}

export function current(input?: { workflow?: unknown; evidence?: unknown; sessionID?: string }): {
  readonly sessionID?: string
  readonly active: boolean
} {
  return {
    sessionID: input?.sessionID,
    active: true,
  }
}

export * as Gate from "."
