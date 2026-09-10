import type { TodoItem } from "./agent"
import { changedPaths, lastOutcome, matchExpect } from "@/ocx/ledger"
import type { LedgerEntry } from "@/ocx/ledger"
import type { ExecutionPlan, ExecutionStep } from "../plan-workstream-state"

export const MAX_TODOS = 32
const MIN_PLAN_STEPS = 2

function normalize(text: string): string {
  return text.toLowerCase().replaceAll(/[^a-z0-9]+/g, " ").trim()
}

export function mergePlan(existing: readonly TodoItem[], plan: readonly { do: string }[]): TodoItem[] {
  if (plan.length < MIN_PLAN_STEPS) return [...existing]
  const known = new Set(existing.map((item) => normalize(item.content)))
  const added: TodoItem[] = []
  for (const step of plan) {
    if (existing.length + added.length >= MAX_TODOS) break
    const key = normalize(step.do)
    if (!key || known.has(key)) continue
    known.add(key)
    added.push({ content: step.do, status: "pending", priority: "p1" })
  }
  return [...existing, ...added]
}

export function reconcilePlan(
  existing: readonly TodoItem[],
  plan: readonly { do: string; expect: string }[],
  entries: readonly LedgerEntry[],
): TodoItem[] {
  const planByContent = new Map(plan.map((step) => [normalize(step.do), step]))
  const paths = changedPaths(entries).map((path) => path.toLowerCase())
  return existing.map((item) => {
    if (item.status === "completed") return item
    const step = planByContent.get(normalize(item.content))
    if (!step || !hasEvidence(step, entries, paths)) return item
    return { ...item, status: "completed" }
  })
}

export function reconcileExecutionPlan(existing: readonly TodoItem[], plan: ExecutionPlan): TodoItem[] {
  const steps = plan.workstreams.flatMap((workstream) =>
    workstream.steps.map((step) => ({ step, workstreamID: workstream.id })),
  )
  const matchedStepIndices = new Set<number>()

  const updatedExisting = existing.map((item) => {
    const matchIndex = steps.findIndex(
      ({ step, workstreamID }) =>
        normalize(item.content) === normalize(formatStepContent(workstreamID, step)) ||
        normalize(item.content) === normalize(step.action) ||
        normalize(item.content).startsWith(normalize(`[${workstreamID}] ${step.action}`)),
    )

    if (matchIndex !== -1) {
      matchedStepIndices.add(matchIndex)
      const { step, workstreamID } = steps[matchIndex]!
      const reconciledStatus =
        item.status === "completed" || step.status === "completed"
          ? ("completed" as const)
          : statusForStep(step)
      return {
        ...item,
        content: formatStepContent(workstreamID, step),
        status: reconciledStatus,
      }
    }

    return item
  })

  const projected: TodoItem[] = []
  for (let i = 0; i < steps.length; i++) {
    if (matchedStepIndices.has(i)) continue
    const { step, workstreamID } = steps[i]!
    projected.push({
      content: formatStepContent(workstreamID, step),
      status: statusForStep(step),
      priority: "p1",
    })
  }

  const deduped: TodoItem[] = []
  const seen = new Set<string>()
  for (const item of [...updatedExisting, ...projected]) {
    const key = normalize(item.content)
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(item)
  }

  return deduped.slice(0, MAX_TODOS)
}

function formatStepContent(workstreamID: string, step: ExecutionStep): string {
  const targets = step.targets.length > 0 ? ` [${step.targets.join(", ")}]` : ""
  return `[${workstreamID}] ${step.action}${targets}`
}

function statusForStep(step: ExecutionStep): string {
  if (step.status === "completed") return "completed"
  if (step.status === "active" || step.status === "verify_required") return "in_progress"
  return "pending"
}

export type DelegatedStatus = "in_progress" | "completed" | "pending"

export function reconcileDelegation(
  existing: readonly TodoItem[],
  description: string,
  status: DelegatedStatus,
): TodoItem[] {
  const key = normalize(description)
  if (!key) return [...existing]
  return existing.map((item) => (normalize(item.content) === key ? { ...item, status } : item))
}

function hasEvidence(step: { do: string; expect: string }, entries: readonly LedgerEntry[], paths: readonly string[]): boolean {
  const check = matchExpect(step.expect)
  if (check && lastOutcome(entries, check) === "passed") return true
  const tokens = normalize(step.do)
    .split(" ")
    .filter((token) => token.length >= 4 && !STOP_WORDS.has(token))
  return tokens.some((token) => paths.some((path) => path.includes(token)))
}

const STOP_WORDS = new Set(["build", "write", "create", "add", "make", "with", "from", "into", "plus", "layer"])

export function reconcileTerminalState(existing: readonly TodoItem[], terminalState: "done" | "blocked" | "cancelled" | "needs_input"): TodoItem[] {
  if (terminalState === "done") {
    if (existing.every((item) => item.status === "completed" || item.status === "cancelled")) return []
    return [...existing]
  }
  if (terminalState === "cancelled") {
    return existing.map((item) =>
      item.status === "in_progress" || item.status === "pending"
        ? { ...item, status: "cancelled" as const }
        : item,
    )
  }
  return [...existing]
}

export function ensureSingleActiveState(existing: readonly TodoItem[]): TodoItem[] {
  let hasActive = false
  return existing.map((item) => {
    if (item.status === "in_progress") {
      if (!hasActive) {
        hasActive = true
        return item
      }
      return { ...item, status: "pending" as const }
    }
    return item
  })
}

export * as TodoSync from "./sync"
