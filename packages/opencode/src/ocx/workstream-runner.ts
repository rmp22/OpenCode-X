import path from "node:path"
import { realpathSync } from "node:fs"
import type { OCXDb } from "./ocx-db"
import {
  activateStep as activate,
  allowedTargets as targets,
  blockStep as block,
  completeStep as complete,
  nextReadyStep as next,
  recordEvidence as record,
  recordVerifiedEvidence as recordVerified,
  recordMutation as mutate,
  requireVerification as require,
  type ExecutionEvidenceInput,
  type ExecutionPlan,
  type ExecutionPlanUpdateResult,
  type ExecutionWorkstream,
  type ExecutionStepRef,
  type TrustedEvidenceSource,
  type WorkstreamLock,
} from "./plan-workstream-state"
import { PlanWorkstreamState } from "./plan-workstream-state"
import type { WrapperDocument } from "./tool-input/wrapper"

export type Input = {
  readonly store: Pick<OCXDb.Store, "get" | "set">
  readonly sessionID: string
}

function plan(input: Input): ExecutionPlan | undefined {
  return input.store.get(input.sessionID)?.plan
}

function save(input: Input, nextPlan: ExecutionPlan): ExecutionPlan | undefined {
  const state = input.store.get(input.sessionID)
  if (!state) return undefined
  input.store.set(input.sessionID, { ...state, plan: nextPlan })
  return nextPlan
}

export function setPlan(input: Input, nextPlan: ExecutionPlan): ExecutionPlan | undefined {
  return save(input, nextPlan)
}

export function getPlan(input: Input): ExecutionPlan | undefined {
  return plan(input)
}

export function nextReadyStep(input: Input): ExecutionStepRef | undefined {
  const current = plan(input)
  return current ? next(current) : undefined
}

export function activateStep(input: Input, workstreamID: string, stepID: string): ExecutionPlan | undefined {
  const current = plan(input)
  if (!current) return undefined
  const updated = activate(current, workstreamID, stepID)
  return updated ? save(input, updated) : undefined
}

export function allowedTargets(input: Input): string[] {
  const current = plan(input)
  if (!current) return []
  if (current.activeWorkstreamID) {
    const ws = current.workstreams.find((w) => w.id === current.activeWorkstreamID)
    if (ws) {
      const stepTargets = ws.steps.flatMap((s) => s.targets)
      return Array.from(new Set([...ws.targets, ...stepTargets]))
    }
  }
  return targets(current)
}

export function isAllowedTarget(input: Input, repositoryRoot: string, target: string): boolean {
  const resolved = canonicalPath(path.resolve(repositoryRoot, target))
  if (inside("/tmp", resolved)) return true
  const allowedList = allowedTargets(input)
  if (allowedList.length === 0) {
    const current = plan(input)
    return !current
  }
  return allowedList.some((allowed) => {
    const root = canonicalPath(path.resolve(repositoryRoot, allowed))
    if (root === resolved) return true
    const isDirectoryLike = allowed.endsWith("/") || allowed.endsWith("\\") || !path.extname(allowed)
    if (isDirectoryLike && inside(root, resolved)) return true
    const targetIsDir = target.endsWith("/") || target.endsWith("\\") || !path.extname(target)
    if (targetIsDir && inside(resolved, root)) return true
    return false
  })
}

function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
}

function canonicalPath(value: string): string {
  let current = value
  const suffix: string[] = []
  while (true) {
    try {
      const resolved = realpathSync(current)
      return suffix.length > 0 ? path.resolve(resolved, ...suffix) : resolved
    } catch {
      const parent = path.dirname(current)
      if (parent === current) return value
      suffix.unshift(path.basename(current))
      current = parent
    }
  }
}

export function activeStep(input: Input): ExecutionStepRef | undefined {
  const current = plan(input)
  if (!current?.activeWorkstreamID || !current.activeStepID) return undefined
  const workstream = current.workstreams.find((candidate) => candidate.id === current.activeWorkstreamID)
  const step = workstream?.steps.find((candidate) => candidate.id === current.activeStepID)
  return workstream && step ? { workstreamID: workstream.id, stepID: step.id, step } : undefined
}

export function matchesActiveStep(input: Input, workstreamID?: string, step?: string): boolean {
  const active = activeStep(input)
  if (!active) return false
  const norm = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
  if (workstreamID && norm(workstreamID) !== norm(active.workstreamID)) return false
  if (!step) return true
  const value = norm(step)
  const activeID = norm(active.stepID)
  const action = norm(active.step.action)
  return value === activeID || value === action
}

export function activeWorkstream(input: Input): ExecutionWorkstream | undefined {
  const current = plan(input)
  return current?.workstreams.find((workstream) => workstream.id === current.activeWorkstreamID)
}

export function renderExecutionPacket(input: Input): string | undefined {
  const current = plan(input)
  const step = activeStep(input)
  const workstream = activeWorkstream(input)
  if (!current || !step || !workstream) return undefined
  const workstreamIndex = current.workstreams.findIndex((candidate) => candidate.id === workstream.id)
  const stepIndex = workstream.steps.findIndex((candidate) => candidate.id === step.stepID)
  return [
    "=== OCX ACTIVE WORK ANCHOR (Edit Focus) ===",
    `WORKSTREAM: ${workstream.id} (${workstreamIndex + 1}/${current.workstreams.length})`,
    `ACTIVE STEP: ${step.stepID} (${stepIndex + 1}/${workstream.steps.length})`,
    `ACTION: ${step.step.action}`,
    `TARGET FILES: ${step.step.targets.join(", ") || "(directory targets)"}`,
    "REQUIRED CHECKS:",
    ...step.step.checks.map((check) => `  - [${check.status === "passed" ? "✓" : " "}] ${check.id}: ${check.description}`),
    `HOW TO ADVANCE: Implement the step action and satisfy the check. Progress is verified and advanced automatically by the system.`,
    "FOCUS INVARIANT: Modify ONLY the listed target files for this active step. Verify checks before moving to the next step.",
    "=== END OCX ACTIVE WORK ANCHOR ===",
  ].join("\n")
}

export function recordMutation(input: Input, path: string): ExecutionPlan | undefined {
  const current = plan(input)
  return current ? save(input, mutate(current, path)) : undefined
}

export function requireVerification(input: Input): ExecutionPlan | undefined {
  const current = plan(input)
  return current ? save(input, require(current)) : undefined
}

export function recordEvidence(input: Input, evidence: ExecutionEvidenceInput): ExecutionPlan | undefined {
  const current = plan(input)
  return current ? save(input, record(current, evidence)) : undefined
}

export function recordVerifiedEvidence(
  input: Input,
  evidence: Omit<ExecutionEvidenceInput, "source"> & { readonly source: TrustedEvidenceSource },
): ExecutionPlan | undefined {
  const current = plan(input)
  return current ? save(input, recordVerified(current, evidence)) : undefined
}

export function completeStep(input: Input): ExecutionPlan | undefined {
  const current = plan(input)
  const updated = current ? complete(current) : undefined
  return updated ? save(input, updated) : undefined
}


export function remainingChecks(input: Input): string[] {
  const step = activeStep(input)?.step
  if (!step) return []
  return step.checks
    .filter((check) => check.status !== "passed")
    .map((check) => `${check.id}: ${check.description}`)
}

export function checkRefs(input: Input): string[] {
  const step = activeStep(input)?.step
  if (!step) return []
  return step.checks.map((check) => `${check.id}: ${check.description}`)
}

export function recordPassedEvidence(
  input: Input,
  checks: readonly string[],
  evidence: readonly string[],
): ExecutionPlan | undefined {
  let current = plan(input)
  if (!current) return undefined
  const active = activeStep(input)?.step
  if (!active) return current

  const requested = checks.length > 0 ? checks : active.checks.length === 1 ? [active.checks[0]!.description] : []
  if (requested.length === 0 || evidence.length === 0) return current

  for (let index = 0; index < requested.length; index++) {
    const check = requested[index]!
    const proof = evidence[index] ?? (evidence.length === 1 ? evidence[0] : undefined)
    if (!proof) continue
    current = record(current, { check, status: "passed", evidence: proof })
  }
  return save(input, current)
}

export function completeActiveStep(input: Input): { readonly completed: boolean; readonly missing: readonly string[] } {
  const current = plan(input)
  if (!current) return { completed: false, missing: ["no execution plan"] }
  const missing = remainingChecks(input)
  if (missing.length > 0) return { completed: false, missing }
  const updated = complete(current)
  if (!updated) return { completed: false, missing: remainingChecks(input) }
  save(input, updated)
  return { completed: true, missing: [] }
}

export function blockStep(input: Input, reason: string): ExecutionPlan | undefined {
  const current = plan(input)
  const updated = current ? block(current, reason) : undefined
  return updated ? save(input, updated) : undefined
}

export function updatePlan(input: Input, update: string | WrapperDocument): ExecutionPlanUpdateResult {
  const current = plan(input)
  if (!current) return { errors: [{ key: "plan", message: "no execution plan is recorded" }] }
  const result = PlanWorkstreamState.updatePlan(current, update)
  if (result.plan) save(input, result.plan)
  return result
}

export function hasActiveStep(input: Input): boolean {
  const current = plan(input)
  return current?.activeStepID !== undefined
}

export function isComplete(input: Input): boolean {
  const current = plan(input)
  return current ? current.workstreams.every((workstream) => workstream.steps.every((step) => step.status === "completed")) : false
}

export function completeAll(input: Input): ExecutionPlan | undefined {
  const current = plan(input)
  if (!current) return undefined
  const updated: ExecutionPlan = {
    ...current,
    activeStepID: undefined,
    workstreams: current.workstreams.map((ws) => ({
      ...ws,
      steps: ws.steps.map((step) => ({
        ...step,
        status: "completed" as const,
        checks: step.checks.map((check) => ({ ...check, status: "passed" as const })),
      })),
    })),
  }
  return save(input, updated)
}

export function activeWorkstreamLock(input: Input, workstreamID: string): WorkstreamLock | undefined {
  const current = plan(input)
  const ws = current?.workstreams.find((candidate) => candidate.id === workstreamID)
  if (!ws?.lock) return undefined
  if (Date.now() >= ws.lock.expiresAt) return undefined
  return ws.lock
}

export function isWorkstreamLocked(input: Input, workstreamID: string): boolean {
  return activeWorkstreamLock(input, workstreamID) !== undefined
}

export function acquireWorkstreamLock(
  input: Input,
  workstreamID: string,
  agentID: string,
  worktreePath?: string,
  ttlMs = 60_000,
): { success: boolean; leaseID?: string; expiresAt?: number; ownerAgentID?: string; reason?: string } {
  const current = plan(input)
  if (!current) return { success: false, reason: "no execution plan is recorded" }
  const ws = current.workstreams.find((candidate) => candidate.id === workstreamID)
  if (!ws) return { success: false, reason: `unknown workstream '${workstreamID}'` }

  const now = Date.now()
  if (ws.lock && now < ws.lock.expiresAt && ws.lock.agentID !== agentID) {
    return {
      success: false,
      leaseID: ws.lock.leaseID,
      expiresAt: ws.lock.expiresAt,
      ownerAgentID: ws.lock.agentID,
      reason: `workstream '${workstreamID}' is locked by agent '${ws.lock.agentID}'`,
    }
  }

  const leaseID = `lease-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const expiresAt = now + ttlMs
  const lock: WorkstreamLock = {
    leaseID,
    agentID,
    ...(worktreePath ? { worktreePath } : {}),
    acquiredAt: now,
    expiresAt,
  }

  const nextPlan: ExecutionPlan = {
    ...current,
    workstreams: current.workstreams.map((candidate) =>
      candidate.id === workstreamID ? { ...candidate, lock } : candidate,
    ),
  }
  save(input, nextPlan)
  return { success: true, leaseID, expiresAt, ownerAgentID: agentID }
}

export function releaseWorkstreamLock(input: Input, workstreamID: string, leaseID: string): boolean {
  const current = plan(input)
  if (!current) return false
  const ws = current.workstreams.find((candidate) => candidate.id === workstreamID)
  if (!ws || !ws.lock || ws.lock.leaseID !== leaseID) return false

  const nextPlan: ExecutionPlan = {
    ...current,
    workstreams: current.workstreams.map((candidate) =>
      candidate.id === workstreamID ? { ...candidate, lock: undefined } : candidate,
    ),
  }
  save(input, nextPlan)
  return true
}

export function renewWorkstreamLock(input: Input, workstreamID: string, leaseID: string, ttlMs = 60_000): boolean {
  const current = plan(input)
  if (!current) return false
  const ws = current.workstreams.find((candidate) => candidate.id === workstreamID)
  if (!ws || !ws.lock || ws.lock.leaseID !== leaseID || Date.now() >= ws.lock.expiresAt) return false

  const now = Date.now()
  const expiresAt = now + ttlMs
  const lock: WorkstreamLock = {
    ...ws.lock,
    expiresAt,
  }

  const nextPlan: ExecutionPlan = {
    ...current,
    workstreams: current.workstreams.map((candidate) =>
      candidate.id === workstreamID ? { ...candidate, lock } : candidate,
    ),
  }
  save(input, nextPlan)
  return true
}

export * as WorkstreamRunner from "./workstream-runner"
