import { Ledger, type CheckKind, type LedgerEntry } from "./ledger"
import type { Finding } from "./exit-gate"
import type { PlanStep } from "./header"
import type { ExecutionPlan } from "./plan-workstream-state"

export type Evidence =
  | { readonly kind: "read" | "write" | "edit"; readonly path: string }
  | { readonly kind: "command"; readonly command: string; readonly check?: CheckKind; readonly outcome: "passed" | "failed" | "unknown" }

export type Status = "complete" | "blocked" | "unverified" | "in_progress"

export type Record = {
  readonly status: Status
  readonly summary: string
  readonly changedPaths: readonly string[]
  readonly evidence: readonly Evidence[]
  readonly missingChecks: readonly CheckKind[]
  readonly findings: readonly string[]
  readonly missingPlanChecks?: readonly string[]
}

const MAX_EVIDENCE = 24
const MAX_FINDINGS = 8

export function evidence(entries: readonly LedgerEntry[]): Evidence[] {
  const result: Evidence[] = []
  for (const entry of entries) {
    if (entry.kind === "command") {
      result.push({ kind: entry.kind, command: entry.command, ...(entry.check ? { check: entry.check } : {}), outcome: entry.outcome })
      continue
    }
    result.push({ kind: entry.kind, path: entry.path })
  }
  return result.slice(-MAX_EVIDENCE)
}

export function requiredChecks(plan: readonly PlanStep[] | undefined): CheckKind[] {
  return [...new Set((plan ?? []).flatMap((step) => {
    const check = Ledger.matchExpect(step.expect)
    return check ? [check] : []
  }))]
}

export function evaluate(input: {
  readonly entries: readonly LedgerEntry[]
  readonly findings: readonly Finding[]
  readonly openTodos: readonly string[]
  readonly plan?: readonly PlanStep[]
  readonly executionPlan?: ExecutionPlan
  readonly declaredDone: boolean
}): Record {
  const required = requiredChecks(input.plan)
  const missingChecks = required.filter((check) => Ledger.lastOutcome(input.entries, check) !== "passed")
  const missingPlanChecks = input.executionPlan
    ? input.executionPlan.workstreams.flatMap((workstream) =>
        workstream.steps.flatMap((step) =>
          step.checks
            .filter((check) => check.status !== "passed")
            .map((check) => `${workstream.id}/${step.id}:${check.id}`),
        ),
      )
    : []
  const changedPaths = Ledger.changedPaths(input.entries)
  const findingIDs = [...new Set(input.findings.map((finding) => finding.id))].slice(0, MAX_FINDINGS)
  if (input.findings.length > 0)
    return {
      status: "blocked",
      summary: `${input.findings.length} completion finding(s) require resolution`,
      changedPaths,
      evidence: evidence(input.entries),
      missingChecks,
      findings: findingIDs,
      ...(missingPlanChecks.length > 0 ? { missingPlanChecks } : {}),
    }
  if (input.openTodos.length > 0)
    return {
      status: "in_progress",
      summary: `${input.openTodos.length} planned item(s) remain open`,
      changedPaths,
      evidence: evidence(input.entries),
      missingChecks,
      findings: [],
      ...(missingPlanChecks.length > 0 ? { missingPlanChecks } : {}),
    }
  if (missingChecks.length > 0)
    return {
      status: "unverified",
      summary: `Required checks are missing or not passing: ${missingChecks.join(", ")}`,
      changedPaths,
      evidence: evidence(input.entries),
      missingChecks,
      findings: [],
      ...(missingPlanChecks.length > 0 ? { missingPlanChecks } : {}),
    }
  if (missingPlanChecks.length > 0)
    return {
      status: "unverified",
      summary: `Execution-plan checks are missing or not passing: ${missingPlanChecks.join(", ")}`,
      changedPaths,
      evidence: evidence(input.entries),
      missingChecks,
      findings: [],
      missingPlanChecks,
    }
  if (!input.declaredDone)
    return {
      status: "in_progress",
      summary: "The reply does not declare a completed task",
      changedPaths,
      evidence: evidence(input.entries),
      missingChecks,
      findings: [],
    }
  return {
    status: "complete",
    summary: "The task has no open findings and its required checks have passing evidence",
    changedPaths,
    evidence: evidence(input.entries),
    missingChecks: [],
    findings: [],
  }
}

export * as Outcome from "./outcome"
