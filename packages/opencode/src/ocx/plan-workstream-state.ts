import { Wrapper, type WrapperDocument, type WrapperEntity, type WrapperError } from "./tool-input/wrapper"
import { Workflow, type WorkflowId } from "./workflow"

export type PlanStepStatus = "PENDING" | "READY" | "ACTIVE" | "SATISFIED" | "BLOCKED" | "STALE" | "SUPERSEDED" | "CANCELLED"

export type PlanStep = {
  readonly id: string
  readonly objective: string
  readonly expectedEvidence: string
  readonly dependencies: readonly string[]
  readonly status: PlanStepStatus
  readonly intentRevision: string
}

export type WorkstreamStatus = "PENDING" | "READY" | "RUNNING" | "WAITING_INPUT" | "BLOCKED" | "SUCCEEDED" | "FAILED" | "CANCELLED" | "SUPERSEDED" | "STALE"

export type Workstream = {
  readonly id: string
  readonly scope: string
  readonly owner: string
  readonly dependencies: readonly string[]
  readonly workflowState: string
  readonly writeSet: readonly string[]
  readonly status: WorkstreamStatus
  readonly intentRevision: string
}

export function createPlanStep(input: Omit<PlanStep, "id" | "status"> & { id?: string; status?: PlanStepStatus }): PlanStep {
  return {
    id: input.id ?? `step-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    objective: input.objective,
    expectedEvidence: input.expectedEvidence,
    dependencies: input.dependencies,
    status: input.status ?? "PENDING",
    intentRevision: input.intentRevision,
  }
}

export function createWorkstream(input: Omit<Workstream, "id" | "status"> & { id?: string; status?: WorkstreamStatus }): Workstream {
  return {
    id: input.id ?? `ws-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    scope: input.scope,
    owner: input.owner,
    dependencies: input.dependencies,
    workflowState: input.workflowState,
    writeSet: input.writeSet,
    status: input.status ?? "PENDING",
    intentRevision: input.intentRevision,
  }
}

export function satisfyPlanStep(steps: readonly PlanStep[], id: string): readonly PlanStep[] {
  return steps.map((s) => (s.id === id ? { ...s, status: "SATISFIED" as const } : s))
}

export function blockPlanStep(steps: readonly PlanStep[], id: string): readonly PlanStep[] {
  return steps.map((s) => (s.id === id ? { ...s, status: "BLOCKED" as const } : s))
}

export function stalePlanStep(steps: readonly PlanStep[], intentRevision: string): readonly PlanStep[] {
  return steps.map((s) => (s.intentRevision !== intentRevision ? { ...s, status: "STALE" as const } : s))
}

export function canStartStep(step: PlanStep, allSteps: readonly PlanStep[]): boolean {
  if (step.status !== "PENDING" && step.status !== "READY") return false
  for (const dep of step.dependencies) {
    const depStep = allSteps.find((s) => s.id === dep)
    if (!depStep || depStep.status !== "SATISFIED") return false
  }
  return true
}

export function readySteps(steps: readonly PlanStep[]): readonly PlanStep[] {
  return steps.filter((s) => s.status === "PENDING" && canStartStep({ ...s, status: "PENDING" }, steps))
}

export function primaryCannotIgnoreOwnerWorkstream(workstreams: readonly Workstream[]): boolean {
  return workstreams.some((ws) => ws.owner !== "primary" && ws.status === "PENDING")
}

export function busyOwnerDoesNotStallIndependentWork(
  workstreams: readonly Workstream[],
  independentScope: string,
): boolean {
  const busy = workstreams.filter((ws) => ws.status === "RUNNING" || ws.status === "WAITING_INPUT")
  const independent = workstreams.find((ws) => ws.scope === independentScope)
  if (!independent) return true
  if (independent.status === "BLOCKED") {
    const blockingOwner = busy.find((b) => independent.dependencies.includes(b.id))
    return !blockingOwner
  }
  return true
}

export function propagateCancellation(
  workstreams: readonly Workstream[],
  cancelledId: string,
): readonly Workstream[] {
  const cancelled = workstreams.find((ws) => ws.id === cancelledId)
  if (!cancelled) return workstreams
  return workstreams.map((ws) => {
    if (ws.dependencies.includes(cancelledId) && ws.status === "PENDING") {
      return { ...ws, status: "CANCELLED" as const }
    }
    return ws
  })
}

export function needsInputToWaiting(workstreams: readonly Workstream[]): readonly Workstream[] {
  return workstreams.map((ws) => {
    const legacy = ws as unknown as { readonly needs_input?: boolean; readonly status?: string }
    if (legacy.status !== "NEEDS_INPUT" && legacy.needs_input !== true) return ws
    return { ...ws, status: "WAITING_INPUT" as const } as Workstream
  })
}

export type ExecutionStepStatus = "pending" | "ready" | "active" | "verify_required" | "completed" | "blocked" | "failed"
export type ExecutionWorkstreamStatus = "pending" | "ready" | "active" | "verifying" | "completed" | "blocked" | "failed"
export type ExecutionCheckStatus = "pending" | "passed" | "failed" | "unknown"
export type ExecutionEvidenceSource = "model_report" | "tool_output" | "artifact" | "browser" | "verification"
export type TrustedEvidenceSource = Exclude<ExecutionEvidenceSource, "model_report">

export type ExecutionCheck = {
  readonly id: string
  readonly description: string
  readonly status: ExecutionCheckStatus
  readonly evidence?: string
  readonly evidenceSource?: ExecutionEvidenceSource
}

export type ExecutionStep = {
  readonly id: string
  readonly action: string
  readonly targets: readonly string[]
  readonly checks: readonly ExecutionCheck[]
  readonly dependencies: readonly string[]
  readonly status: ExecutionStepStatus
  readonly evidence: readonly string[]
  readonly mutations: readonly string[]
  readonly workflowHint?: WorkflowId
  readonly artifactKinds?: readonly string[]
}

export type WorkstreamLock = {
  readonly leaseID: string
  readonly agentID: string
  readonly worktreePath?: string
  readonly acquiredAt: number
  readonly expiresAt: number
}

export type ExecutionWorkstream = {
  readonly id: string
  readonly goal: string
  readonly dependencies: readonly string[]
  readonly targets: readonly string[]
  readonly steps: readonly ExecutionStep[]
  readonly status: ExecutionWorkstreamStatus
  readonly workflowHint?: WorkflowId
  readonly artifactKinds?: readonly string[]
  readonly lock?: WorkstreamLock
}

export type ExecutionEvidence = {
  readonly check: string
  readonly status: Exclude<ExecutionCheckStatus, "pending">
  readonly evidence: string
  readonly source?: ExecutionEvidenceSource
}

export type ExecutionPlan = {
  readonly revision: number
  readonly goal: string
  readonly scope?: string
  readonly contextReady: boolean
  readonly workstreams: readonly ExecutionWorkstream[]
  readonly activeWorkstreamID?: string
  readonly activeStepID?: string
  readonly mutations: readonly string[]
  readonly evidence: readonly ExecutionEvidence[]
  readonly intentRevision?: string
}

export type ExecutionStepRef = {
  readonly workstreamID: string
  readonly stepID: string
  readonly step: ExecutionStep
}

export type ExecutionPlanParseResult = {
  readonly plan?: ExecutionPlan
  readonly errors: readonly WrapperError[]
}

export type ExecutionEvidenceInput = {
  readonly check: string
  readonly status: Exclude<ExecutionCheckStatus, "pending">
  readonly evidence: string
  readonly source?: ExecutionEvidenceSource
}

export type ExecutionPlanUpdateResult = {
  readonly plan?: ExecutionPlan
  readonly errors: readonly WrapperError[]
}

const EXECUTION_STEP_STATUSES = new Set<ExecutionStepStatus>([
  "pending",
  "ready",
  "active",
  "verify_required",
  "completed",
  "blocked",
  "failed",
])
const EXECUTION_WORKSTREAM_STATUSES = new Set<ExecutionWorkstreamStatus>([
  "pending",
  "ready",
  "active",
  "verifying",
  "completed",
  "blocked",
  "failed",
])
const EXECUTION_CHECK_STATUSES = new Set<ExecutionCheckStatus>(["pending", "passed", "failed", "unknown"])
const EXECUTION_EVIDENCE_SOURCES = new Set<ExecutionEvidenceSource>([
  "model_report",
  "tool_output",
  "artifact",
  "browser",
  "verification",
])
const TRUSTED_EVIDENCE_SOURCES = new Set<ExecutionEvidenceSource>(["tool_output", "artifact", "browser", "verification"])
const GENERIC_STEP = /^(?:add|build|create|make|write|implement)\s+(?:css|html|page|animations?(?:\s+and\s+polish)?|polish|features?)$/i
const CONTROL_PLANE_TARGETS = new Set([
  "strategy", "strategies", "playbook", "playbooks", "workflow", "phase",
  "ocx_progress", "ocx_session", "ocx_header", "reasoning", "runtime playbooks",
])
const CONTROL_PLANE_ACTION = /^(?:load|select|call|run|record|advance|inject|mark)\b.*\b(?:strateg(?:y|ies)|playbooks?|workflow(?:\s+phase)?|ocx_(?:progress|session|header)|reasoning pass|structure contract)\b/i

function controlPlaneTarget(value: string): boolean {
  const target = value.trim().toLowerCase()
  return CONTROL_PLANE_TARGETS.has(target)
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))]
}

function normalizeTarget(value: string): string {
  const clean = value.trim().replace(/^(["'`])|(["'`])$/g, "").replaceAll("\\", "/")
  if (!clean || clean === ".") return clean
  const directory = clean.endsWith("/")
  const normalized = clean.replace(/^\.\//, "").replaceAll(/\/\.\//g, "/").replaceAll(/\/+/g, "/")
  if (directory && !normalized.endsWith("/")) return `${normalized}/`
  return normalized
}

function targetValues(values: readonly string[]): string[] {
  return unique(values.flatMap((value) => value.split(",").map(normalizeTarget)))
}

function hasStatusField(document: WrapperDocument): boolean {
  if (Wrapper.values(document, "status").length > 0) return true
  const visit = (entity: WrapperEntity): boolean =>
    Wrapper.values(entity, "status").length > 0 || entity.children.some(visit)
  return document.entities.some(visit)
}

function normalizeID(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

function cleanStepID(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ""
  const withoutParens = trimmed.replace(/\s*\([^)]*\)/g, "").trim()
  const withoutStatus = withoutParens.replace(/\s+(?:completed|pending|in_progress|done|active)\b.*$/i, "").trim()
  return normalizeID(withoutStatus || trimmed)
}

function fieldValues(entity: WrapperEntity, key: string): string[] {
  return unique([
    ...Wrapper.values(entity, key),
    ...Wrapper.entities(entity, key).map((child) => child.value),
  ])
}

function attachOrphanSteps(document: WrapperDocument): WrapperDocument {
  const orphans = document.entities.filter((entity) => entity.key === "step" && entity.value.length > 0)
  if (orphans.length === 0) return document
  const workstreams = Wrapper.entities(document, "workstream")
  const orphanSet = new Set(orphans)
  if (workstreams.length === 0) {
    const defaultWorkstream: WrapperEntity = {
      key: "workstream",
      value: "main",
      indent: 0,
      fields: [],
      children: [...orphans],
    }
    return {
      ...document,
      entities: [...document.entities.filter((entity) => !orphanSet.has(entity)), defaultWorkstream],
    }
  }
  if (workstreams.length === 1) {
    return {
      ...document,
      entities: document.entities
        .filter((entity) => !orphanSet.has(entity))
        .map((entity) => {
          if (entity.key !== "workstream") return entity
          return { ...entity, children: [...entity.children, ...orphans] }
        }),
    }
  }
  let firstFound = false
  return {
    ...document,
    entities: document.entities
      .filter((entity) => !orphanSet.has(entity))
      .map((entity) => {
        if (entity.key !== "workstream" || firstFound) return entity
        firstFound = true
        return { ...entity, children: [...entity.children, ...orphans] }
      }),
  }
}

function requiredError(key: string, message: string): WrapperError {
  return { key, message }
}

function checkID(description: string, index: number): string {
  return normalizeID(description) || `check-${index + 1}`
}

function stepFromEntity(
  workstream: WrapperEntity,
  entity: WrapperEntity,
  index: number,
  workstreamTargets: readonly string[],
  fallbackChecks: readonly string[] = [],
): { step?: ExecutionStep; errors: WrapperError[] } {
  const action = Wrapper.value(entity, "action") ?? Wrapper.value(entity, "goal") ?? entity.value
  const errors: WrapperError[] = []
  if (!action || action.trim().length < 8 || GENERIC_STEP.test(action.trim())) {
    errors.push(requiredError(`step:${entity.value || index + 1}`, "step action must name a concrete operation"))
  } else if (CONTROL_PLANE_ACTION.test(action.trim())) {
    errors.push(requiredError(`step:${entity.value || index + 1}`, "execution plans contain user/project work only; OCX manages playbooks, reasoning, and workflow transitions"))
  }
  const checkDescriptions = fieldValues(entity, "check")
  const rawChecks = checkDescriptions.length > 0 ? checkDescriptions : fallbackChecks
  if (rawChecks.length === 0) {
    errors.push(requiredError(`step:${entity.value || index + 1}.check`, "step needs an observable check"))
    return { errors }
  }
  const resolvedChecks = rawChecks.map((description, checkIndex) => ({
    id: checkID(description, checkIndex),
    description,
    status: "pending" as const,
  }))
  const checks = resolvedChecks
  if (errors.length > 0) return { errors }
  const targets = targetValues([...fieldValues(entity, "target"), ...workstreamTargets])
  if (targets.length === 0) {
    errors.push(requiredError(`step:${entity.value || index + 1}.target`, "step needs at least one concrete target"))
    return { errors }
  }
  const controlTargets = targets.filter(controlPlaneTarget)
  if (controlTargets.length > 0) {
    errors.push(requiredError(`step:${entity.value || index + 1}.target`, `targets must be user/project resources, not OCX control-plane labels: ${controlTargets.join(", ")}`))
    return { errors }
  }
  const id = Wrapper.value(entity, "id") ? normalizeID(Wrapper.value(entity, "id")!) : cleanStepID(entity.value) || `step-${index + 1}`
  const workflowValue = Wrapper.value(entity, "workflow")
  const workflowHint = workflowValue ? Workflow.canonicalID(workflowValue) : undefined
  if (workflowValue && !workflowHint) {
    errors.push(requiredError(`step:${id}.workflow`, "workflow hints must use a canonical workflow id"))
    return { errors }
  }
  const artifactKinds = unique([...fieldValues(entity, "artifact"), ...fieldValues(entity, "artifactKind")])
  return {
    errors,
    step: {
      id,
      action: action.trim(),
      targets,
      checks,
      dependencies: fieldValues(entity, "dependency").map(normalizeID).filter(Boolean),
      status: "pending",
      evidence: [],
      mutations: [],
      ...(workflowHint ? { workflowHint } : {}),
      ...(artifactKinds.length > 0 ? { artifactKinds } : {}),
    },
  }
}

function refreshStatuses(plan: ExecutionPlan): ExecutionPlan {
  const completedWorkstreams = new Set(
    plan.workstreams.filter((workstream) => workstream.status === "completed").map((workstream) => workstream.id),
  )
  const hasIncompletePrerequisites = (targetIndex: number) => {
    for (let i = 0; i < targetIndex; i++) {
      const prior = plan.workstreams[i]
      if (prior && prior.status !== "completed" && /^(?:assets?|setup|prep|prereq|scaffold)\b/i.test(prior.id)) {
        return true
      }
    }
    return false
  }

  const workstreams = plan.workstreams.map((workstream, workstreamIndex) => {
    if (["completed", "blocked", "failed", "active", "verifying"].includes(workstream.status)) return workstream
    const dependenciesReady = workstream.dependencies.every((dependency) => completedWorkstreams.has(dependency))
    const blockedByPrereq = /^(?:implementation|impl|code|build)\b/i.test(workstream.id) && hasIncompletePrerequisites(workstreamIndex)
    const status: ExecutionWorkstreamStatus = dependenciesReady && !blockedByPrereq ? "ready" : "pending"
    const steps = workstream.steps.map((step) => {
      if (step.status !== "pending" && step.status !== "ready") return step
      const ready = status === "ready" && step.dependencies.every((dependency) =>
        workstream.steps.some((candidate) => candidate.id === dependency && candidate.status === "completed"),
      )
      return { ...step, status: ready ? ("ready" as const) : ("pending" as const) }
    })
    return { ...workstream, status, steps }
  })
  return { ...plan, workstreams }
}

export function parseExecutionPlan(
  input: string | WrapperDocument,
  options: { readonly contextReady?: boolean } = {},
): ExecutionPlanParseResult {
  const raw = typeof input === "string" ? Wrapper.parseWrapper(input) : input
  const document = attachOrphanSteps(raw)
  const workstreamEntities = Wrapper.entities(document, "workstream")
  const goal =
    Wrapper.value(document, "goal") ||
    Wrapper.value(document, "topic") ||
    Wrapper.value(document, "scope") ||
    (workstreamEntities[0] ? Wrapper.value(workstreamEntities[0], "goal") || workstreamEntities[0].value : undefined) ||
    "Execute plan"
  const errors: WrapperError[] = []
  if (hasStatusField(document))
    errors.push(requiredError("status", "plan creation cannot mark execution steps complete; execution progress is verified automatically at runtime"))
  const scope = Wrapper.value(document, "scope")
  const soleWorkstream = workstreamEntities.length === 1
  const docTargets = soleWorkstream
    ? targetValues([
        ...document.records.filter((record) => record.key === "target").map((record) => record.value),
        ...document.entities.filter((entity) => entity.key === "target").map((entity) => entity.value),
      ])
    : []
  const docChecks = soleWorkstream
    ? unique([
        ...document.records.filter((record) => record.key === "check").map((record) => record.value),
        ...document.entities.filter((entity) => entity.key === "check").map((entity) => entity.value),
      ])
    : []
  if (!goal) errors.push(requiredError("goal", "plan goal is required"))
  if (workstreamEntities.length === 0) errors.push(requiredError("workstream", "at least one workstream is required"))
  if (errors.length > 0) return { errors: uniqueErrors(errors) }

  const workstreams: ExecutionWorkstream[] = []
  for (const [index, entity] of workstreamEntities.entries()) {
    const id = normalizeID(entity.value) || `workstream-${index + 1}`
    const targets = targetValues(fieldValues(entity, "target"))
    const effectiveTargets = targets.length > 0 ? targets : docTargets
    const stepEntities = Wrapper.entities(entity, "step")
    const workstreamGoal =
      Wrapper.value(entity, "goal") ??
      (stepEntities[0]?.value ? `${stepEntities[0].value} (${entity.value})` : `Complete ${entity.value} workstream`)
    const workflowValue = Wrapper.value(entity, "workflow")
    const workflowHint = workflowValue ? Workflow.canonicalID(workflowValue) : undefined
    if (workflowValue && !workflowHint) errors.push(requiredError(`workstream:${id}.workflow`, "workflow hints must use a canonical workflow id"))
    const artifactKinds = unique([...fieldValues(entity, "artifact"), ...fieldValues(entity, "artifactKind")])
    const workstreamChecks = fieldValues(entity, "check")
    const checkFallback = stepEntities.length === 1 ? [...workstreamChecks, ...docChecks] : workstreamChecks
    const steps = stepEntities
      .map((step, stepIndex) =>
        stepFromEntity(entity, step, stepIndex, effectiveTargets, checkFallback),
      )
    const stepErrors = steps.flatMap((result) => result.errors)
    errors.push(...stepErrors)
    const parsedSteps = steps.flatMap((result) => (result.step ? [result.step] : []))
    if (parsedSteps.length === 0) errors.push(requiredError(`workstream:${id}.step`, "workstream needs at least one step"))
    workstreams.push({
      id,
      goal: workstreamGoal,
      dependencies: fieldValues(entity, "dependency").map(normalizeID).filter(Boolean),
      targets: effectiveTargets,
      steps: parsedSteps,
      status: "pending",
      ...(workflowHint ? { workflowHint } : {}),
      ...(artifactKinds.length > 0 ? { artifactKinds } : {}),
    })
  }
  errors.push(...validatePlanReferences(workstreams))
  if (errors.length > 0) return { errors: uniqueErrors(errors) }
  const plan = refreshStatuses({
    revision: 1,
    goal: goal!,
    ...(scope ? { scope } : {}),
    contextReady: options.contextReady ?? true,
    workstreams,
    mutations: [],
    evidence: [],
    ...(Wrapper.value(document, "intentRevision") ? { intentRevision: Wrapper.value(document, "intentRevision") } : {}),
  })
  return { plan, errors: [] }
}

export function parseStoredPlan(value: unknown): ExecutionPlan | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const input = value as Record<string, unknown>
  if (typeof input.goal !== "string" || typeof input.revision !== "number" || !Array.isArray(input.workstreams)) return undefined
  if (input.intentRevision !== undefined && typeof input.intentRevision !== "string") return undefined
  if (typeof input.contextReady !== "boolean" || !Array.isArray(input.mutations) || !Array.isArray(input.evidence)) return undefined
  if (!input.workstreams.every(isExecutionWorkstream)) return undefined
  if (!input.mutations.every((item) => typeof item === "string")) return undefined
  if (!input.evidence.every(isExecutionEvidence)) return undefined
  const plan = input as unknown as ExecutionPlan
  const workstreams = plan.workstreams.map((workstream) => {
    const steps = workstream.steps.map((step) => {
      const checks = step.checks.map((check) => {
        if (
          check.status === "passed" &&
          typeof check.evidence === "string" &&
          check.evidence.length > 0 &&
          check.evidenceSource !== undefined &&
          TRUSTED_EVIDENCE_SOURCES.has(check.evidenceSource)
        )
          return check
        if (check.status !== "passed") return check
        return { ...check, status: "unknown" as const }
      })
      if (step.status !== "completed" || checks.every((check) => check.status === "passed"))
        return { ...step, targets: targetValues(step.targets), checks }
      return { ...step, targets: targetValues(step.targets), checks, status: "verify_required" as const }
    })
    if (workstream.status !== "completed" || steps.every((step) => step.status === "completed"))
      return { ...workstream, targets: targetValues(workstream.targets), steps }
    return { ...workstream, targets: targetValues(workstream.targets), steps, status: "verifying" as const }
  })
  const evidence = plan.evidence.map((item) => {
    if (item.status !== "passed" || (item.source !== undefined && TRUSTED_EVIDENCE_SOURCES.has(item.source))) return item
    return { ...item, status: "unknown" as const, source: "model_report" as const }
  })
  const normalized = { ...plan, workstreams, evidence }
  return validateExecutionPlan(normalized).length > 0 ? undefined : normalized
}

function isExecutionCheck(value: unknown): value is ExecutionCheck {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const input = value as Record<string, unknown>
  return (
    typeof input.id === "string" &&
    typeof input.description === "string" &&
    typeof input.status === "string" &&
    EXECUTION_CHECK_STATUSES.has(input.status as ExecutionCheckStatus) &&
    (input.evidence === undefined || typeof input.evidence === "string") &&
    (input.evidenceSource === undefined || EXECUTION_EVIDENCE_SOURCES.has(input.evidenceSource as ExecutionEvidenceSource))
  )
}

function isExecutionStep(value: unknown): value is ExecutionStep {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const input = value as Record<string, unknown>
  return (
    typeof input.id === "string" &&
    typeof input.action === "string" &&
    Array.isArray(input.targets) &&
    input.targets.every((item) => typeof item === "string") &&
    Array.isArray(input.checks) &&
    input.checks.every(isExecutionCheck) &&
    Array.isArray(input.dependencies) &&
    input.dependencies.every((item) => typeof item === "string") &&
    typeof input.status === "string" &&
    EXECUTION_STEP_STATUSES.has(input.status as ExecutionStepStatus) &&
    Array.isArray(input.evidence) &&
    input.evidence.every((item) => typeof item === "string") &&
    Array.isArray(input.mutations) &&
    input.mutations.every((item) => typeof item === "string") &&
    (input.workflowHint === undefined || Workflow.isWorkflowId(input.workflowHint)) &&
    (input.artifactKinds === undefined || Array.isArray(input.artifactKinds) && input.artifactKinds.every((item) => typeof item === "string"))
  )
}

function isWorkstreamLock(value: unknown): value is WorkstreamLock {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const input = value as Record<string, unknown>
  return (
    typeof input.leaseID === "string" &&
    typeof input.agentID === "string" &&
    (input.worktreePath === undefined || typeof input.worktreePath === "string") &&
    typeof input.acquiredAt === "number" &&
    typeof input.expiresAt === "number"
  )
}

function isExecutionWorkstream(value: unknown): value is ExecutionWorkstream {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const input = value as Record<string, unknown>
  return (
    typeof input.id === "string" &&
    typeof input.goal === "string" &&
    Array.isArray(input.dependencies) &&
    input.dependencies.every((item) => typeof item === "string") &&
    Array.isArray(input.targets) &&
    input.targets.every((item) => typeof item === "string") &&
    Array.isArray(input.steps) &&
    input.steps.every(isExecutionStep) &&
    typeof input.status === "string" &&
    EXECUTION_WORKSTREAM_STATUSES.has(input.status as ExecutionWorkstreamStatus) &&
    (input.workflowHint === undefined || Workflow.isWorkflowId(input.workflowHint)) &&
    (input.artifactKinds === undefined || Array.isArray(input.artifactKinds) && input.artifactKinds.every((item) => typeof item === "string")) &&
    (input.lock === undefined || isWorkstreamLock(input.lock))
  )
}

function isExecutionEvidence(value: unknown): value is ExecutionEvidence {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const input = value as Record<string, unknown>
  return (
    typeof input.check === "string" &&
    typeof input.status === "string" &&
    input.status !== "pending" &&
    EXECUTION_CHECK_STATUSES.has(input.status as ExecutionCheckStatus) &&
    typeof input.evidence === "string" &&
    (input.source === undefined || EXECUTION_EVIDENCE_SOURCES.has(input.source as ExecutionEvidenceSource))
  )
}

function validatePlanReferences(workstreams: readonly ExecutionWorkstream[]): WrapperError[] {
  const errors: WrapperError[] = []
  const workstreamIDs = new Set<string>()
  for (const workstream of workstreams) {
    if (workstreamIDs.has(workstream.id)) errors.push(requiredError(`workstream:${workstream.id}`, "workstream IDs must be unique"))
    workstreamIDs.add(workstream.id)
    const stepIDs = new Set<string>()
    for (const step of workstream.steps) {
      if (stepIDs.has(step.id)) errors.push(requiredError(`workstream:${workstream.id}.step:${step.id}`, "step IDs must be unique within a workstream"))
      stepIDs.add(step.id)
      const checkIDs = new Set<string>()
      for (const check of step.checks) {
        if (checkIDs.has(check.id)) errors.push(requiredError(`step:${step.id}.check:${check.id}`, "check IDs must be unique within a step"))
        checkIDs.add(check.id)
      }
      for (const dependency of step.dependencies)
        if (!stepIDs.has(dependency) && !workstream.steps.some((candidate) => candidate.id === dependency))
          errors.push(requiredError(`step:${step.id}.dependency`, `unknown step dependency '${dependency}'`))
    }
    for (const dependency of workstream.dependencies)
      if (!workstreamIDs.has(dependency) && !workstreams.some((candidate) => candidate.id === dependency))
        errors.push(requiredError(`workstream:${workstream.id}.dependency`, `unknown workstream dependency '${dependency}'`))
    if (hasCycle(workstream.steps.map((step) => ({ id: step.id, dependencies: step.dependencies }))))
      errors.push(requiredError(`workstream:${workstream.id}.dependency`, "step dependencies must not contain a cycle"))
  }
  if (hasCycle(workstreams.map((workstream) => ({ id: workstream.id, dependencies: workstream.dependencies }))))
    errors.push(requiredError("workstream.dependency", "workstream dependencies must not contain a cycle"))
  return errors
}

export function validateExecutionPlan(plan: ExecutionPlan): string[] {
  return validatePlanReferences(plan.workstreams).map((error) => `${error.key}: ${error.message}`)
}

function hasCycle(items: readonly { readonly id: string; readonly dependencies: readonly string[] }[]): boolean {
  const state = new Map<string, "active" | "done">()
  const visit = (id: string): boolean => {
    if (state.get(id) === "active") return true
    if (state.get(id) === "done") return false
    state.set(id, "active")
    const item = items.find((candidate) => candidate.id === id)
    if (item?.dependencies.some(visit)) return true
    state.set(id, "done")
    return false
  }
  return items.some((item) => visit(item.id))
}

function uniqueErrors(errors: readonly WrapperError[]): WrapperError[] {
  const seen = new Set<string>()
  return errors.filter((error) => {
    const key = `${error.key}:${error.message}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function nextReadyStep(plan: ExecutionPlan): ExecutionStepRef | undefined {
  const current = refreshStatuses(plan)
  for (const workstream of current.workstreams) {
    const step = workstream.steps.find((candidate) => candidate.status === "ready")
    if (step) return { workstreamID: workstream.id, stepID: step.id, step }
  }
  return undefined
}

export function activateStep(plan: ExecutionPlan, workstreamID: string, stepID: string): ExecutionPlan | undefined {
  const ready = nextReadyStep(plan)
  if (!ready || ready.workstreamID !== workstreamID || ready.stepID !== stepID) return undefined
  return {
    ...refreshStatuses(plan),
    revision: plan.revision + 1,
    activeWorkstreamID: workstreamID,
    activeStepID: stepID,
    workstreams: plan.workstreams.map((workstream) =>
      workstream.id !== workstreamID
        ? workstream
        : {
            ...workstream,
            status: "active",
            steps: workstream.steps.map((step) => (step.id === stepID ? { ...step, status: "active" as const } : step)),
          },
    ),
  }
}

export function allowedTargets(plan: ExecutionPlan): string[] {
  const workstream = plan.workstreams.find((candidate) => candidate.id === plan.activeWorkstreamID)
  if (!workstream) {
    return unique(plan.workstreams.flatMap((ws) => [...ws.targets, ...ws.steps.flatMap((s) => s.targets)]))
  }
  return unique([
    ...workstream.targets,
    ...workstream.steps.flatMap((s) => s.targets),
    ...plan.workstreams.flatMap((ws) => ws.targets),
  ])
}

export function recordMutation(plan: ExecutionPlan, path: string): ExecutionPlan {
  const workstream = plan.workstreams.find((candidate) => candidate.id === plan.activeWorkstreamID)
  if (!workstream) return plan
  const step = workstream.steps.find((candidate) => candidate.id === plan.activeStepID)
  if (!step) return plan
  const mutations = unique([...plan.mutations, path])
  return {
    ...plan,
    revision: plan.revision + 1,
    mutations,
    workstreams: plan.workstreams.map((candidate) =>
      candidate.id !== workstream.id
        ? candidate
        : {
            ...candidate,
            status: "verifying",
            steps: candidate.steps.map((item) =>
              item.id !== step.id ? item : { ...item, status: "verify_required" as const, mutations: unique([...item.mutations, path]) },
            ),
          },
    ),
  }
}

export function requireVerification(plan: ExecutionPlan): ExecutionPlan {
  const workstream = plan.workstreams.find((candidate) => candidate.id === plan.activeWorkstreamID)
  if (!workstream) return plan
  return {
    ...plan,
    revision: plan.revision + 1,
    workstreams: plan.workstreams.map((candidate) =>
      candidate.id !== workstream.id
        ? candidate
        : {
            ...candidate,
            status: "verifying",
            steps: candidate.steps.map((step) =>
              step.id === plan.activeStepID && (step.status === "active" || step.status === "verify_required")
                ? { ...step, status: "verify_required" as const }
                : step,
            ),
          },
    ),
  }
}

export function recordEvidence(plan: ExecutionPlan, input: ExecutionEvidenceInput): ExecutionPlan {
  const workstream = plan.workstreams.find((candidate) => candidate.id === plan.activeWorkstreamID)
  if (!workstream) return plan
  const step = workstream.steps.find((candidate) => candidate.id === plan.activeStepID)
  if (!step) return plan
  const normalizedCheck = input.check.trim().toLowerCase()
  const checkIndex = step.checks.findIndex((check) => {
    const checkId = check.id.toLowerCase()
    const checkDesc = check.description.toLowerCase()
    const checkFull = `${checkId}: ${checkDesc}`
    return (
      checkId === normalizedCheck ||
      checkDesc === normalizedCheck ||
      checkFull === normalizedCheck ||
      normalizedCheck.startsWith(`${checkId}:`) ||
      normalizedCheck.endsWith(`: ${checkDesc}`) ||
      checkId.startsWith(normalizedCheck) ||
      checkId.includes(normalizedCheck) ||
      normalizedCheck.includes(checkId) ||
      (step.checks.length === 1 && Boolean(normalizedCheck))
    )
  })
  if (checkIndex < 0) return plan
  const source = input.source ?? "model_report"
  const status = input.status === "passed" && !TRUSTED_EVIDENCE_SOURCES.has(source) ? "unknown" : input.status
  const checks = step.checks.map((check, index) =>
    index === checkIndex
      ? { ...check, status, evidence: input.evidence, evidenceSource: source }
      : check,
  )
  const evidenceInput = { ...input, status, source }
  const evidence = [...plan.evidence, evidenceInput].filter(
    (item, index, all) =>
      all.findIndex(
        (candidate) =>
          candidate.check === item.check && candidate.evidence === item.evidence && candidate.source === item.source,
      ) === index,
  )
  return {
    ...plan,
    revision: plan.revision + 1,
    evidence,
    workstreams: plan.workstreams.map((candidate) =>
      candidate.id !== workstream.id
        ? candidate
        : {
            ...candidate,
            steps: candidate.steps.map((item) =>
              item.id !== step.id ? item : { ...item, checks, evidence: unique([...item.evidence, input.evidence]) },
            ),
          },
    ),
  }
}

export function recordVerifiedEvidence(
  plan: ExecutionPlan,
  input: Omit<ExecutionEvidenceInput, "source"> & { readonly source: TrustedEvidenceSource },
): ExecutionPlan {
  return recordEvidence(plan, input)
}

export function completeStep(plan: ExecutionPlan): ExecutionPlan | undefined {
  const workstream = plan.workstreams.find((candidate) => candidate.id === plan.activeWorkstreamID)
  if (!workstream) return undefined
  const step = workstream.steps.find((candidate) => candidate.id === plan.activeStepID)
  if (
    !step ||
    !step.checks.every(
      (check) =>
        check.status === "passed" &&
        typeof check.evidence === "string" &&
        check.evidence.length > 0 &&
        check.evidenceSource !== undefined &&
        TRUSTED_EVIDENCE_SOURCES.has(check.evidenceSource),
    )
  )
    return undefined
  const workstreams = plan.workstreams.map((candidate) => {
    if (candidate.id !== workstream.id) return candidate
    const steps = candidate.steps.map((item) => (item.id === step.id ? { ...item, status: "completed" as const } : item))
    const status: ExecutionWorkstreamStatus = steps.every((item) => item.status === "completed") ? "completed" : "ready"
    return { ...candidate, status, steps }
  })
  return refreshStatuses({
    ...plan,
    revision: plan.revision + 1,
    activeWorkstreamID: undefined,
    activeStepID: undefined,
    workstreams,
  })
}

export function blockStep(plan: ExecutionPlan, reason: string): ExecutionPlan | undefined {
  const workstream = plan.workstreams.find((candidate) => candidate.id === plan.activeWorkstreamID)
  if (!workstream) return undefined
  const step = workstream.steps.find((candidate) => candidate.id === plan.activeStepID)
  if (!step) return undefined
  return {
    ...plan,
    revision: plan.revision + 1,
    activeWorkstreamID: undefined,
    activeStepID: undefined,
    evidence: [...plan.evidence, { check: "blocked", status: "failed", evidence: reason, source: "model_report" }],
    workstreams: plan.workstreams.map((candidate) =>
      candidate.id !== workstream.id
        ? candidate
        : {
            ...candidate,
            status: "blocked",
            steps: candidate.steps.map((item) => (item.id === step.id ? { ...item, status: "blocked" as const } : item)),
          },
    ),
  }
}

export function updatePlan(plan: ExecutionPlan, input: string | WrapperDocument): ExecutionPlanUpdateResult {
  const document = typeof input === "string" ? Wrapper.parseWrapper(input) : input
  if (Wrapper.entities(document, "workstream").length > 0) {
    const parsed = parseExecutionPlan(document, { contextReady: plan.contextReady })
    if (!parsed.plan) return { errors: parsed.errors }
    return { plan: mergePlan(plan, parsed.plan), errors: [] }
  }

  const workstreamID = normalizeID(Wrapper.value(document, "updateWorkstream") ?? "")
  const action = Wrapper.value(document, "addStep")
  if (!workstreamID || !action) return { errors: [requiredError("workstream", "update requires updateWorkstream and addStep")] }
  const workstream = plan.workstreams.find((candidate) => candidate.id === workstreamID)
  if (!workstream) return { errors: [requiredError("updateWorkstream", `unknown workstream '${workstreamID}'`)] }
  const checks = fieldValuesFromDocument(document, "check").map((description, index) => ({
    id: checkID(description, index),
    description,
    status: "pending" as const,
  }))
  if (checks.length === 0) return { errors: [requiredError("check", "added step needs an observable check")] }
  const stepID = normalizeID(action)
  if (workstream.steps.some((step) => step.id === stepID)) return { plan, errors: [] }
  const reopenedStatus: ExecutionWorkstreamStatus =
    workstream.status === "completed" ? "ready" : workstream.status
  const step: ExecutionStep = {
    id: stepID,
    action,
    targets: targetValues([...fieldValuesFromDocument(document, "target"), ...workstream.targets]),
    checks,
    dependencies: [],
    status: reopenedStatus === "ready" ? "ready" : "pending",
    evidence: [],
    mutations: [],
  }
  return {
    plan: refreshStatuses({
      ...plan,
      revision: plan.revision + 1,
      workstreams: plan.workstreams.map((candidate) =>
        candidate.id === workstreamID ? { ...candidate, status: reopenedStatus, steps: [...candidate.steps, step] } : candidate,
      ),
    }),
    errors: [],
  }
}

function fieldValuesFromDocument(document: WrapperDocument, key: string): string[] {
  return unique([
    ...Wrapper.values(document, key),
    ...Wrapper.entities(document, key).map((entity) => entity.value),
  ])
}

function mergePlan(previous: ExecutionPlan, next: ExecutionPlan): ExecutionPlan {
  const workstreams = next.workstreams.map((workstream) => {
    const prior = previous.workstreams.find((candidate) => candidate.id === workstream.id)
    if (!prior || !sameWorkstreamDefinition(prior, workstream)) return workstream
    const steps = workstream.steps.map((step) => {
      const priorStep = prior.steps.find((candidate) => candidate.id === step.id)
      if (!priorStep || !sameStepDefinition(priorStep, step)) return step
      const checks = step.checks.map((check) => {
        const priorCheck = priorStep.checks.find(
          (candidate) =>
            candidate.id === check.id || candidate.description.toLocaleLowerCase() === check.description.toLocaleLowerCase(),
        )
        return priorCheck
          ? { ...check, status: priorCheck.status, ...(priorCheck.evidence ? { evidence: priorCheck.evidence } : {}) }
          : check
      })
      return {
        ...step,
        status: priorStep.status,
        checks,
        evidence: priorStep.evidence,
        mutations: priorStep.mutations,
      }
    })
    const allCompleted = steps.length > 0 && steps.every((step) => step.status === "completed")
    const status: ExecutionWorkstreamStatus = prior.status === "completed" && !allCompleted ? "pending" : prior.status
    return { ...workstream, status, steps, ...(prior.lock ? { lock: prior.lock } : {}) }
  })
  return refreshStatuses({
    ...next,
    revision: previous.revision + 1,
    mutations: unique([...previous.mutations, ...next.mutations]),
    evidence: [...previous.evidence, ...next.evidence],
    workstreams,
  })
}

function sameWorkstreamDefinition(left: ExecutionWorkstream, right: ExecutionWorkstream): boolean {
  return (
    left.goal === right.goal &&
    JSON.stringify(left.dependencies) === JSON.stringify(right.dependencies) &&
    JSON.stringify(left.targets) === JSON.stringify(right.targets) &&
    left.workflowHint === right.workflowHint &&
    JSON.stringify(left.artifactKinds ?? []) === JSON.stringify(right.artifactKinds ?? [])
  )
}

function sameStepDefinition(left: ExecutionStep, right: ExecutionStep): boolean {
  return (
    left.action === right.action &&
    JSON.stringify(left.targets) === JSON.stringify(right.targets) &&
    JSON.stringify(left.dependencies) === JSON.stringify(right.dependencies) &&
    left.workflowHint === right.workflowHint &&
    JSON.stringify(left.artifactKinds ?? []) === JSON.stringify(right.artifactKinds ?? []) &&
    left.checks.length === right.checks.length &&
    left.checks.every((check, index) => {
      const next = right.checks[index]
      return next !== undefined && check.id === next.id && check.description === next.description
    })
  )
}

export * as PlanWorkstreamState from "./plan-workstream-state"
