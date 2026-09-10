import { Cause, Effect, Exit } from "effect"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import type { Info } from "../session/session"
import type { SessionID } from "../session/schema"
import { OwnerLifecycle } from "./owner/lifecycle"
import type { OwnerRegistry } from "./owner/registry"
import { OCXOperation } from "./operation"
import { Recovery } from "./recovery"
import { TrustBoundary } from "./trust-boundary"
import { ContextOrchestration } from "./context/orchestration"
import { declaresNeedsInput } from "./session-done"


export class OwnerBusyError extends Error {
  readonly ownerID: string
  readonly taskID: string

  constructor(ownerName: string, ownerID: string, taskID: string) {
    super(`OWNER_BUSY owner=${ownerID} task=${taskID} owner_name=${ownerName}; task is queued for retry after the current owner task finishes`)
    this.name = "OwnerBusyError"
    this.ownerID = ownerID
    this.taskID = taskID
  }
}

export type OwnerTaskContext = {
  readonly workdir?: string
  readonly sessionID?: string
  readonly route?: OwnerLifecycle.RouteResult
  readonly owner?: OwnerRegistry.Owner
  readonly leaseID?: string
  readonly taskID?: string
  readonly startedAt?: number
  readonly revisionBefore?: string
  readonly contextPacket?: string
  readonly taskPrompt?: string
  readonly incidentalUpdates?: boolean
}

export function prepare(input: {
  readonly enabled: boolean
  readonly workdir?: string
  readonly sessionID: string
  readonly prompt: string
  readonly contextEnabled?: boolean
  readonly contextRetrieval?: boolean
  readonly contextFreshnessChecks?: boolean
  readonly incidentalUpdates?: boolean
}): Effect.Effect<OwnerTaskContext, unknown> {
  const workdir = input.workdir
  const packet =
    input.contextEnabled !== false && input.contextRetrieval === true && workdir
      ? ContextOrchestration.renderPacket({
          workdir,
          prompt: input.prompt,
          checkFreshness: input.contextFreshnessChecks === true,
        })
      : undefined
  const base = {
    ...(workdir ? { workdir } : {}),
    taskPrompt: input.prompt,
    ...(packet ? { contextPacket: packet } : {}),
    ...(input.incidentalUpdates ? { incidentalUpdates: true } : {}),
  }
  if (!input.enabled || !workdir || !OwnerLifecycle.isRepositoryTask(input.prompt)) return Effect.succeed(base)
  return Effect.gen(function* () {
    const route = yield* OwnerLifecycle.route({ workdir, sessionID: input.sessionID, prompt: input.prompt }).pipe(
      Effect.catch(() => Effect.succeed(undefined)),
    )
    const owner = route?.owners[0]
    if (!route || !owner) return base
    const leaseID = OwnerLifecycle.leaseID()
    const taskID = OwnerLifecycle.leaseID("owner-task")
    const startedAt = Date.now()
    const revisionBefore = OwnerLifecycle.repositoryRevision(workdir)
    const acquired = yield* OwnerLifecycle.acquire({
      workdir,
      sessionID: input.sessionID,
      ownerID: owner.id,
      leaseID,
    }).pipe(Effect.catch(() => Effect.succeed(false)))
    if (!acquired) {
      yield* OwnerLifecycle.recordTask({
        id: taskID,
        workdir,
        ownerID: owner.id,
        primarySessionID: input.sessionID,
        summary: input.prompt.slice(0, 500),
        status: "queued",
        startedAt,
        ...(revisionBefore ? { revisionBefore } : {}),
        resultSummary: `Waiting for ${owner.name} to become available`,
      }).pipe(Effect.ignore)
      return yield* Effect.fail(new OwnerBusyError(owner.name, owner.id, taskID))
    }
    return {
      workdir,
      sessionID: input.sessionID,
      route,
      owner,
      leaseID,
      taskID,
      startedAt,
      revisionBefore,
      taskPrompt: input.prompt,
      ...(packet ? { contextPacket: packet } : {}),
      ...(input.incidentalUpdates ? { incidentalUpdates: true } : {}),
    }
  })
}

export function reusableSession(
  context: OwnerTaskContext,
  get: (sessionID: string) => Effect.Effect<Info, unknown>,
): Effect.Effect<Info | undefined> {
  const sessionID = context.owner?.currentSessionID
  if (!sessionID) return Effect.succeed(undefined)
  return get(sessionID).pipe(
    Effect.catch(() => Effect.succeed(undefined)),
  )
}

export function sessionMetadata(context: OwnerTaskContext) {
  return context.owner && context.route
    ? OwnerLifecycle.sessionMetadata(context.owner.id, context.route.repositoryID)
    : undefined
}

export function attachSession(context: OwnerTaskContext, sessionID: string): Effect.Effect<void, unknown> {
  if (!context.owner || !context.route || !context.workdir || !context.sessionID) return Effect.void
  return OwnerLifecycle.attachSession({
    workdir: context.workdir,
    repositoryID: context.route.repositoryID,
    ownerID: context.owner.id,
    sessionID,
    registrySessionID: context.sessionID,
  })
}

export function title(context: OwnerTaskContext, description: string, agentName: string): string {
  return description + (context.owner ? ` (${context.owner.name})` : ` (@${agentName} subagent)`)
}

export function prompt(context: OwnerTaskContext, taskPrompt: string, loadedSession?: boolean): string {
  const request = TrustBoundary.request(taskPrompt)
  return ContextOrchestration.ownerPrompt({
    workdir: context.workdir ?? "",
    prompt: taskPrompt,
    taskPrompt: request,
    ...(loadedSession ? { loadedSession: true } : {}),
    ...(context.contextPacket ? { packet: context.contextPacket } : {}),
    ...(context.route?.instructions ? { routeInstructions: context.route.instructions } : {}),
  })
}

export function metadata(
  context: OwnerTaskContext,
  input: {
    readonly parentSessionID: SessionID
    readonly sessionID: SessionID
    readonly model: unknown
    readonly background?: boolean
  },
) {
  return {
    parentSessionId: input.parentSessionID,
    sessionId: input.sessionID,
    model: input.model,
    ...(context.owner && context.route
      ? {
          ownerID: context.owner.id,
          ownerName: context.owner.name,
          ownerTopic: context.owner.topic,
          ownerRepositoryID: context.route.repositoryID,
        }
      : {}),
    ...(input.background ? { background: true } : {}),
  }
}

export function start(context: OwnerTaskContext, primarySessionID: SessionID, summary: string): Effect.Effect<void, unknown> {
  if (!context.owner || !context.workdir || !context.sessionID || !context.taskID || !context.startedAt) return Effect.void
  return OwnerLifecycle.recordTask({
    id: context.taskID,
    workdir: context.workdir,
    ownerID: context.owner.id,
    primarySessionID,
    summary,
    status: "running",
    startedAt: context.startedAt,
    ...(context.revisionBefore ? { revisionBefore: context.revisionBefore } : {}),
  }).pipe(Effect.asVoid)
}

export function execute(
  context: OwnerTaskContext,
  input: { readonly primarySessionID: SessionID; readonly summary: string },
  work: Effect.Effect<SessionV1.WithParts, unknown>,
): Effect.Effect<string, unknown> {
  const result = Effect.gen(function* () {
    const exit = yield* Effect.exit(work)
    if (Exit.isFailure(exit)) {
      if (Cause.hasInterruptsOnly(exit.cause)) {
        yield* OCXOperation.recordCancellation({
          sessionID: input.primarySessionID,
          operation: "task",
          error: Cause.pretty(exit.cause),
        }).pipe(Effect.ignore)
        yield* finish(context, input, "cancelled", "Task cancelled")
        return yield* Effect.failCause(exit.cause)
      }
      const recovery = Recovery.create({ operation: "task", error: Cause.pretty(exit.cause) })
      yield* OCXOperation.recordFailure({
        sessionID: input.primarySessionID,
        operation: "task",
        error: Cause.pretty(exit.cause),
      }).pipe(Effect.ignore)
      yield* finish(context, input, "failed", recovery.message)
      return yield* Effect.fail(new Error(Recovery.render(recovery)))
    }
    const text = exit.value.parts.findLast((part) => part.type === "text")?.text ?? ""
    if (declaresNeedsInput(text)) {
      yield* finish(context, input, "needs_input", text.slice(0, 500), text)
      return text
    }
    yield* finish(context, input, "completed", text.slice(0, 500), text)
    return text
  })
  return result.pipe(Effect.ensuring(release(context)))
}

function finish(
  context: OwnerTaskContext,
  input: { readonly primarySessionID: SessionID; readonly summary: string },
  status: "needs_input" | "completed" | "failed" | "cancelled",
  resultSummary: string,
  resultText = resultSummary,
): Effect.Effect<void, unknown> {
  const workdir = context.workdir
  const taskID = context.taskID ?? `task_${Date.now()}`
  const taskPrompt = context.taskPrompt
  const revisionAfter = workdir ? OwnerLifecycle.repositoryRevision(workdir) : undefined
  const promotion =
    status === "completed" && context.incidentalUpdates && taskPrompt && workdir
      ? Effect.sync(() =>
          ContextOrchestration.promoteTask({
            workdir,
            taskID,
            ...(context.owner ? { ownerID: context.owner.id } : {}),
            taskPrompt,
            resultText,
            ...(revisionAfter ? { sourceRevision: revisionAfter } : {}),
          }),
        ).pipe(Effect.asVoid, Effect.ignore)
      : Effect.void
  if (!context.owner || !context.workdir || !context.sessionID || !context.taskID || !context.startedAt) return promotion
  return Effect.all([
    promotion,
    OwnerLifecycle.recordTask({
      id: context.taskID,
      workdir: context.workdir,
      ownerID: context.owner.id,
      primarySessionID: input.primarySessionID,
      summary: input.summary,
      status,
      startedAt: context.startedAt,
      ...(status === "needs_input" ? {} : { completedAt: Date.now() }),
      ...(context.revisionBefore ? { revisionBefore: context.revisionBefore } : {}),
      ...(revisionAfter ? { revisionAfter } : {}),
      resultSummary,
    }),
    ...(status !== "cancelled" && context.route
      ? [
          OwnerLifecycle.recordKnowledge({
            workdir: context.workdir,
            sessionID: context.sessionID,
            repositoryID: context.route.repositoryID,
            ownerID: context.owner.id,
            category: status === "completed" ? "task" : status === "needs_input" ? "needs_input" : "failure",
            key: status === "completed" ? "last_result" : status === "needs_input" ? "last_input_request" : "last_failure",
            value: resultSummary.slice(0, 1_000),
            ...(revisionAfter ? { sourceRevision: revisionAfter } : {}),
          }),
        ]
      : []),
  ]).pipe(Effect.asVoid)
}

function release(context: OwnerTaskContext): Effect.Effect<void> {
  if (!context.owner || !context.workdir || !context.sessionID || !context.leaseID) return Effect.void
  return OwnerLifecycle.release({ workdir: context.workdir, sessionID: context.sessionID, ownerID: context.owner.id, leaseID: context.leaseID }).pipe(
    Effect.catch(() => Effect.void),
  )
}

export * as OCXTask from "./ocx-task"
