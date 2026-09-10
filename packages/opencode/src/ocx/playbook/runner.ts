import { PlaybookQueue } from "./queue"
import { PlaybookCatalog } from "./catalog"
import type { StrategyName } from "@/ocx/strategy"
import type { ExecutionStage, PlaybookPassRecord, PlaybookStage } from "./catalog"
import type { OCXDb } from "../ocx-db"
import { TaskModel } from "../task-model"

export type PassContext = {
  readonly playbookID: StrategyName
  readonly stage: string
  readonly mode: "standard" | "audit"
  readonly order: number
  readonly total: number
  readonly body: string
  readonly displayName: string
}

function displayNameFor(id: string): string {
  const mapping: Record<string, string> = {
    frontend: "Frontend",
    ui: "UI",
    "web-design": "Web Design",
    browser: "Browser",
    quality: "Quality",
    write: "Write",
    structure: "Structure",
    engineering: "Engineering",
    typescript: "TypeScript",
    python: "Python",
    rust: "Rust",
    go: "Go",
    java: "Java",
    kotlin: "Kotlin",
    cpp: "C++",
    swift: "Swift",
    android: "Android",
    compose: "Compose",
    reasoning: "Reasoning",
    think: "Think",
    audit: "Audit",
    review: "Review",
    build: "Build",
    fonts: "Fonts",
    web: "Web",
  }
  return mapping[id] ?? id.replaceAll("-", " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

export function stageForExecutionState(input: {
  readonly workflowPhase?: string
  readonly executionStage?: ExecutionStage
  readonly hasFailure?: boolean
}): PlaybookStage {
  if (input.hasFailure) return "recovery"
  if (input.executionStage === "post_implementation") return "post_implementation"
  if (input.executionStage === "verification") return "verification"
  if (input.executionStage === "recovery") return "recovery"
  const stage = TaskModel.stageKind(input.workflowPhase)
  if (stage === "review" || stage === "validate" || stage === "deliver") return "verification"
  if (stage === "blocked") return "recovery"
  return "pre_implementation"
}

export function reconcileStage(input: {
  readonly store: Pick<OCXDb.Store, "get" | "set">
  readonly sessionID: string
  readonly hasFailure?: boolean
  readonly implementationSettled?: boolean
}): ExecutionStage {
  const current = input.store.get(input.sessionID)
  const priorState = current?.playbookStage
  const prior = priorState?.stage ?? "none"
  const prePending = hasPendingForStage(input.sessionID, "pre_implementation")
  const postPending = hasPendingForStage(input.sessionID, "post_implementation")
  const stage: ExecutionStage = input.hasFailure
    ? "recovery"
    : prior === "recovery"
      ? priorState?.previousStage ?? "implementation"
      : prior === "none"
        ? prePending
          ? "pre_implementation"
          : "implementation"
        : prior === "pre_implementation"
          ? prePending
            ? prior
            : "implementation"
          : prior === "implementation"
            ? input.implementationSettled
              ? postPending
                ? "post_implementation"
                : "verification"
              : prior
            : prior === "post_implementation"
              ? postPending
                ? prior
                : "verification"
              : prior

  if (current && current.playbookStage?.stage !== stage)
    input.store.set(input.sessionID, {
      ...current,
      playbookStage: {
        ...current.playbookStage,
        stage,
        revision: (current.playbookStage?.revision ?? 0) + 1,
        ...(prior !== "recovery" && stage === "recovery" ? { previousStage: prior } : {}),
      },
    })
  return stage
}

export function pendingCount(sessionID: string): number {
  const q = PlaybookQueue.getQueue(sessionID)
  if (!q) return 0
  return q.passes.filter((p) => p.status === "ready" || p.status === "selected" || p.status === "running").length
}

function resolvePassContext(
  sessionID: string,
  queue: PlaybookQueue.QueueState,
  pass: PlaybookQueue.PlaybookPass,
  mode: "standard" | "audit" = "standard",
  markFailedOnMissing = true,
): PassContext | undefined {
  const body = PlaybookCatalog.loadBody(pass.playbookID)
  if (!body) {
    if (markFailedOnMissing) {
      PlaybookQueue.completePass(sessionID, pass.passID, "failed", `playbook body unavailable: ${pass.playbookID}`)
    }
    return undefined
  }
  const total = queue.passes.length
  const idx = queue.passes.findIndex((p) => p.passID === pass.passID)
  return {
    playbookID: pass.playbookID,
    stage: pass.stage,
    mode,
    order: idx + 1,
    total,
    body,
    displayName: displayNameFor(pass.playbookID),
  }
}

export function nextPassContext(
  sessionID: string,
  stage?: PlaybookStage,
  mode: "standard" | "audit" = "standard",
): PassContext | undefined {
  const q = PlaybookQueue.getQueue(sessionID)
  if (!q) return undefined
  const active = mode === "audit"
    ? q.passes.find((p) => p.status === "running")
    : stage
      ? q.passes.find((p) => p.status === "running" && p.stage === stage)
      : q.passes.find((p) => p.status === "running")
  if (active) return resolvePassContext(sessionID, q, active, mode)
  if (mode !== "audit" && !stage) return undefined
  const ready = mode === "audit"
    ? PlaybookQueue.nextReadyForAudit(sessionID)
    : PlaybookQueue.nextReady(sessionID, stage as PlaybookStage)
  if (!ready) return undefined
  const started = PlaybookQueue.startPass(sessionID, ready.passID)
  if (!started) return undefined
  return resolvePassContext(sessionID, q, started, mode)
}

export function prepareNextPass(input: {
  sessionID: string
  stage?: PlaybookStage
  mode?: "standard" | "audit"
}): { directive: string; ctx: PassContext } | undefined {
  const active = PlaybookQueue.activePass(input.sessionID)
  if (active && input.mode === "audit") return undefined
  if (active?.bodyInjected) {
    if (active.stage === "pre_implementation") {
      PlaybookQueue.completePass(input.sessionID, active.passID, "completed")
    } else {
      return undefined
    }
  }
  const ctx = nextPassContext(input.sessionID, input.stage, input.mode ?? "standard")
  if (!ctx) return undefined
  const started = PlaybookQueue.activePass(input.sessionID)
  if (started) PlaybookQueue.markBodyInjected(input.sessionID, started.passID)
  return { directive: formatPlaybookDirective(ctx), ctx }
}

export function restoreCompleted(input: { readonly store: Pick<OCXDb.Store, "get">; readonly sessionID: string }): void {
  const queue = PlaybookQueue.getQueue(input.sessionID)
  const records = input.store.get(input.sessionID)?.playbookStage?.passes ?? []
  if (!queue || records.length === 0) return
  for (const pass of queue.passes) {
    const record = records.find(
      (item) =>
        item.playbookID === pass.playbookID &&
        item.stage === pass.stage &&
        item.hash === pass.playbookHash &&
        item.selectionRevision === pass.selectedRevision,
    )
    if (!record) continue
    if (record.outcome !== "completed") continue
    PlaybookQueue.restorePass(input.sessionID, pass.passID, record.outcome, record.selectionRevision, record.reason)
  }
}

export function persist(input: { readonly store: Pick<OCXDb.Store, "get" | "set">; readonly sessionID: string }): void {
  const queue = PlaybookQueue.snapshot(input.sessionID)
  const current = input.store.get(input.sessionID)
  if (!queue || !current) return
  const terminal = queue.passes
    .filter((pass) => ["completed", "failed", "skipped", "cancelled", "invalidated"].includes(pass.status))
    .slice(-32)
    .map((pass): PlaybookPassRecord => ({
      playbookID: pass.playbookID,
      stage: pass.stage,
      hash: pass.playbookHash,
      selectionRevision: pass.selectedRevision,
      outcome: pass.status as PlaybookPassRecord["outcome"],
      ...(pass.failureReason ? { reason: pass.failureReason } : {}),
    }))
  const stage = current.playbookStage
  input.store.set(input.sessionID, {
    ...current,
    playbookStage: {
      stage: stage?.stage ?? "none",
      revision: stage?.revision ?? 0,
      ...(stage?.previousStage ? { previousStage: stage.previousStage } : {}),
      ...(queue.selectionRevision ? { selectionRevision: queue.selectionRevision } : {}),
      ...(terminal.length > 0 ? { passes: terminal } : {}),
    },
  })
}

export function peekReadyWithoutStart(sessionID: string, stage?: PlaybookStage): PassContext | undefined {
  const q = PlaybookQueue.getQueue(sessionID)
  if (!q) return undefined
  const ready = stage ? PlaybookQueue.nextReady(sessionID, stage) : undefined
  if (!ready) return undefined
  return resolvePassContext(sessionID, q, ready, "standard", false)
}

export function completeActive(
  sessionID: string,
  outcome: "completed" | "failed" | "skipped" | "cancelled" = "completed",
  reason?: string,
): void {
  const active = PlaybookQueue.activePass(sessionID)
  if (!active) return
  PlaybookQueue.completePass(sessionID, active.passID, outcome, reason)
}

export function formatPlaybookDirective(ctx: PassContext): string {
  const isAudit = ctx.mode === "audit" || ctx.stage === "post_implementation" || ctx.stage === "verification"
  if (isAudit) {
    return [
      `=== OCX AUDIT PASS ${ctx.order}/${ctx.total} · ${ctx.displayName} [${ctx.stage}] ===`,
      `You have selected this playbook (${ctx.displayName}). The audit phase requires verifying and auditing your work against every applicable guidance in this playbook:`,
      "",
      ctx.body,
      "",
      `Audit your work and evidence against this playbook. Apply any missing fixes, refinements, or checks required by it before completing this audit pass.`,
      ctx.order < ctx.total
        ? `After this pass, continue to the next selected playbook. Load only that next playbook for the next audit pass.`
        : `This is the final selected playbook. Complete this pass before posting the final verdict.`,
      `=== END OCX AUDIT PASS ${ctx.order}/${ctx.total} · ${ctx.displayName} ===`,
    ].join("\n")
  }
  return [
    `=== OCX GUIDANCE PASS ${ctx.order}/${ctx.total} · ${ctx.displayName} [${ctx.stage}] ===`,
    `You have selected this playbook (${ctx.displayName}). Apply the following guidance to your implementation:`,
    "",
    ctx.body,
    "",
    `=== END OCX GUIDANCE PASS ${ctx.order}/${ctx.total} · ${ctx.displayName} ===`,
  ].join("\n")
}

export function hasPending(sessionID: string): boolean {
  const q = PlaybookQueue.getQueue(sessionID)
  if (!q) return false
  return q.passes.some((p) => p.status === "ready" || p.status === "selected" || (p.status === "running" && !p.bodyInjected))
}

export function hasPendingForStage(sessionID: string, stage: PlaybookStage): boolean {
  const q = PlaybookQueue.getQueue(sessionID)
  if (!q) return false
  return q.passes.some(
    (p) =>
      p.stage === stage &&
      (p.status === "ready" ||
        (p.status === "selected" && stage !== "pre_implementation") ||
        (p.status === "running" && !p.bodyInjected)),
  )
}

export * as PlaybookRunner from "./runner"
