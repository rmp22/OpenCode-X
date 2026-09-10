import { DebugLoop } from "./debug-loop"
import type { Message } from "./ledger"
import type { Header } from "./header"
import { Header as HeaderModule } from "./header"
import { Intent } from "./reasoning/intent"

export type MutationViolation = {
  readonly rule: "mutation-debugging" | "mutation-plan" | "mutation-intent"
  readonly message: string
}

export type Context = {
  headerRecorded: boolean
  executionPlanRequired?: boolean
  planSteps?: number
  workstreams?: number
  planAccepted?: boolean
  workflow?: string
}

type ToolPart = {
  readonly type?: unknown
  readonly tool?: unknown
  readonly state?: {
    readonly status?: unknown
    readonly input?: unknown
    readonly metadata?: unknown
  }
}

const CODE_PATH = /\.(?:c|cc|cpp|css|go|h|hpp|html?|java|js|jsx|json|jsonc|kt|kts|mjs|py|rs|scss|sh|sql|swift|toml|ts|tsx|xml|ya?ml)$/i

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

function toolParts(messages: ReadonlyArray<Message>): ToolPart[] {
  return messages.flatMap((message) =>
    message.parts.flatMap((part) => {
      const item = record(part)
      return item?.type === "tool" ? [item as ToolPart] : []
    }),
  )
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : []
}

function headerRecorded(parts: readonly ToolPart[]): boolean {
  return parts.some((part) => {
    if (part.tool !== "ocx_header" || part.state?.status !== "completed") return false
    const metadata = record(part.state.metadata)
    return metadata?.valid !== false
  })
}

function headerPlanState(parts: readonly ToolPart[]): Pick<Context, "executionPlanRequired" | "planSteps" | "workstreams"> {
  const part = parts.findLast((item) => {
    if (item.tool !== "ocx_header" || item.state?.status !== "completed") return false
    return record(item.state.metadata)?.valid !== false
  })
  if (!part) return {}
  const metadata = record(part.state?.metadata)
  const input = record(part.state?.input)
  const parsed = HeaderModule.parseHeader(input)
  const planSteps = typeof metadata?.planSteps === "number" ? metadata.planSteps : parsed.plan.length
  const workstreams = typeof metadata?.workstreams === "number" ? metadata.workstreams : parsed.workstreams.length
  return {
    executionPlanRequired: metadata?.codingContract === true,
    planSteps,
    workstreams,
  }
}

function workflow(parts: readonly ToolPart[]): string | undefined {
  const header = parts.findLast((part) => part.tool === "ocx_header" && part.state?.status === "completed")
  if (!header) return undefined
  const metadata = record(header.state?.metadata)
  const input = record(header.state?.input)
  const value = metadata?.workflow ?? input?.workflow
  return typeof value === "string" && value.length > 0 ? value : undefined
}

export function fromMessages(messages: ReadonlyArray<Message>): Context {
  const parts = toolParts(messages)
  const planState = headerPlanState(parts)
  return {
    headerRecorded: headerRecorded(parts),
    ...planState,
    workflow: workflow(parts),
  }
}

export function recordHeader(context: Context, header?: Header): void {
  context.headerRecorded = true
  if (!header) return
  context.executionPlanRequired = HeaderModule.requiresExecutionPlan(header)
  context.planSteps = header.plan.length
  context.workstreams = header.workstreams.length
}

export function recordPlan(context: Context | undefined, accepted = true): void {
  if (context) context.planAccepted = accepted
}

export function recordWorkflow(context: Context | undefined, value: string | undefined): void {
  if (context && value) {
    context.workflow = value
    if (HeaderModule.requiresExecutionPlan({ workflowName: value })) context.executionPlanRequired = true
  }
}

export function recordStructure(_value: unknown, _paths: readonly string[]): void {}

export function requiresAbstraction(context: Context | undefined): boolean {
  return context?.workflow === "greenfield"
}

export function check(
  messages: ReadonlyArray<Message>,
  worktree: string,
  paths: readonly string[],
  context?: Context,
): MutationViolation | undefined {
  const codePaths = paths.filter((value) => CODE_PATH.test(value))
  if (codePaths.length === 0) return undefined
  const state = context ?? fromMessages(messages)
  if (!state.headerRecorded && !state.planAccepted) {
    if (state.executionPlanRequired) {
      return {
        rule: "mutation-plan",
        message: "record intake via ocx_header and an accepted OCX execution plan before changing code",
      }
    }
    return undefined
  }
  const intentViolation = Intent.check(messages, codePaths)
  if (intentViolation) return { rule: "mutation-intent", message: intentViolation }
  if (
    state.executionPlanRequired &&
    state.planAccepted !== true &&
    ((state.planSteps ?? 0) < 2 || (state.workstreams ?? 0) < 1)
  )
    return {
      rule: "mutation-plan",
      message: "record an accepted OCX execution plan before changing code",
    }
  if (state.workflow === "debugging") {
    const reason = DebugLoop.lockReason(messages)
    if (reason)
      return {
        rule: "mutation-debugging",
        message: reason,
      }
  }
  // Structure is optional guidance. File authorization belongs to the active
  // execution plan/workstream guard, which has the current concrete targets.
  // Duplicating that boundary here created impossible states when a valid plan
  // existed but no structure record did.
  void worktree
  return undefined
}

export * as MutationGuard from "./mutation-guard"
