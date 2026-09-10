import * as Tool from "./tool"
import DESCRIPTION from "./task.txt"
import { ToolJsonSchema } from "./json-schema"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { BackgroundJob } from "@/background/job"
import { Session } from "@/session/session"
import { SessionID, MessageID } from "../session/schema"
import { MessageV2 } from "../session/message-v2"
import { Agent } from "../agent/agent"
import { deriveSubagentSessionPermission } from "../agent/subagent-permissions"
import { Wildcard } from "@opencode-ai/core/util/wildcard"
import type { SessionPrompt } from "../session/prompt"
import { Config } from "@/config/config"
import { Effect, Exit, Schema, Scope } from "effect"
import { EffectBridge } from "@/effect/bridge"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Database } from "@opencode-ai/core/database/database"
import { OCXTask } from "@/ocx/ocx-task"
import { TodoSync } from "@/ocx/todo/sync"
import { TrustBoundary } from "@/ocx/trust-boundary"
import { OwnerSession } from "@/ocx/owner/session-filter"
import { OwnerRouter } from "@/ocx/owner/router"
import { OwnerRegistry } from "@/ocx/owner/registry"
import { toWorkdirRelative } from "@/ocx/owner/workspace-tree"
import { Todo } from "../session/todo"

export interface TaskPromptOps {
  cancel(sessionID: SessionID): Effect.Effect<void>
  resolvePromptParts(template: string): Effect.Effect<SessionPrompt.PromptInput["parts"]>
  prompt(input: SessionPrompt.PromptInput): Effect.Effect<SessionV1.WithParts>
}

const DOMAIN_OWNERS: Record<string, { description: string }> = {
  app: {
    description: "Domain Owner for packages/app (web/desktop application frontend, Solid components, stores).",
  },
  tui: {
    description: "Domain Owner for packages/tui (terminal UI, keyboard shortcuts, CLI components).",
  },
  session: {
    description: "Domain Owner for packages/opencode/src/session (session runner, prompt lifecycle, turns).",
  },
  ocx: {
    description: "Domain Owner for packages/opencode/src/ocx (agentic workflow, graph engine, watchdog, gates).",
  },
  server: {
    description: "Domain Owner for packages/server (HTTP API endpoints, sync protocols, transports).",
  },
  plugin: {
    description: "Domain Owner for packages/plugin (plugin lifecycle, extension hooks, integration points).",
  },
  ui: {
    description:
      "UI and Frontend specialist. Handles web/desktop interfaces, styling, components, state management, and accessibility.",
  },
  database: {
    description:
      "Database specialist. Handles schemas, queries, migrations, SQLite/Postgres persistence, and data models.",
  },
  build: {
    description:
      "Build and Tooling specialist. Handles bundlers, compiler configs, CI workflows, packaging, and scripts.",
  },
  auth: {
    description:
      "Authentication and Security specialist. Handles credentials, tokens, permissions, and session authorization.",
  },
  security: {
    description:
      "Security and Compliance specialist. Handles vulnerability scans, secret redaction, audit rules, and safety invariants.",
  },
  core: {
    description:
      "Core Architecture specialist. Handles framework internals, runtime loops, effect graphs, and domain state.",
  },
}

const PATH_OWNER_MAP: Array<{ readonly pattern: RegExp; readonly owner: string }> = [
  { pattern: /packages\/app\//i, owner: "app" },
  { pattern: /packages\/tui\//i, owner: "tui" },
  { pattern: /packages\/opencode\/src\/session\//i, owner: "session" },
  { pattern: /packages\/opencode\/src\/ocx\//i, owner: "ocx" },
  { pattern: /packages\/core\//i, owner: "core" },
  { pattern: /packages\/server\//i, owner: "server" },
  { pattern: /packages\/schema\//i, owner: "database" },
  { pattern: /packages\/plugin\//i, owner: "plugin" },
  { pattern: /packages\/(?:ui|session-ui)\//i, owner: "ui" },
  { pattern: /(?:infra|\.github|nix|script)\//i, owner: "build" },
]

const CURATED_DOMAIN_OWNERS: ReadonlySet<string> = new Set(Object.keys(DOMAIN_OWNERS))

function resolveDomainOwner(prompt: string, explicitType?: string): string {
  if (explicitType && explicitType !== "general" && explicitType !== "explore" && explicitType !== "undefined") {
    return explicitType
  }

  for (const entry of PATH_OWNER_MAP) {
    if (entry.pattern.test(prompt)) {
      return entry.owner
    }
  }

  const pathMatch = /(?:[a-zA-Z0-9_\-.]+\/)+[a-zA-Z0-9_\-.]+/g.exec(prompt)
  if (pathMatch) {
    const norm = toWorkdirRelative(process.cwd(), pathMatch[0])
    const segments = norm.split("/").filter(Boolean)
    const invalidRoots = new Set(["mnt", "home", "Users", "root", "var", "tmp"])
    const filtered = segments.filter((s) => !invalidRoots.has(s))
    const packageIdx = filtered.indexOf("packages")
    if (packageIdx >= 0 && filtered[packageIdx + 1]) {
      return filtered[packageIdx + 1]
    }
    if (filtered[0]) {
      return filtered[0]
    }
  }

  const topic = OwnerRouter.domains({ prompt })[0]?.topic
  if (topic === "authentication") return "auth"
  if (topic && DOMAIN_OWNERS[topic]) return topic

  return "core"
}

const id = "task"
const BACKGROUND_DESCRIPTION = [
  "Background mode: background=true launches the subagent asynchronously and returns immediately.",
  "Foreground is the default; use it when you need the result before continuing.",
  "Use background only for independent work that can run while you continue elsewhere.",
  "You will be notified automatically when it finishes.",
].join(" ")
const BACKGROUND_STARTED = [
  "The task is working in the background. You will be notified automatically when it finishes.",
  "DO NOT sleep, poll for progress, ask the task for status, or duplicate this task's work — avoid working with the same files or topics it is using.",
  "Work on non-overlapping tasks, or briefly tell the user what you launched and end your response.",
].join("\n")
const BACKGROUND_UPDATED = [
  "Additional context sent to the running background task.",
  "The task is still working in the background. You will be notified automatically when it finishes.",
  "DO NOT sleep, poll for progress, ask the task for status, or duplicate this task's work — avoid working with the same files or topics it is using.",
  "Work on non-overlapping tasks, or briefly tell the user what you sent and end your response.",
].join("\n")

const BaseParameterFields = {
  description: Schema.String.annotate({ description: "A short (3-5 words) description of the task" }),
  prompt: Schema.String.annotate({ description: "The task for the agent to perform" }),
  subagent_type: Schema.String.annotate({ description: "The type of specialized agent to use for this task" }),
  task_id: Schema.optional(Schema.String).annotate({
    description:
      "This should only be set if you mean to resume a previous task (you can pass a prior task_id and the task will continue the same subagent session as before instead of creating a fresh one)",
  }),
  command: Schema.optional(Schema.String).annotate({ description: "The command that triggered this task" }),
}

const BaseParameters = Schema.Struct(BaseParameterFields)

export const Parameters = Schema.Struct({
  ...BaseParameterFields,
  background: Schema.optional(Schema.Boolean).annotate({
    description:
      "Run the agent in the background. You will be notified when it completes. DO NOT sleep, poll, or proactively check on its progress",
  }),
})

function renderOutput(input: {
  sessionID: SessionID
  state: "running" | "completed" | "error"
  summary?: string
  text: string
}) {
  const tag = input.state === "error" ? "task_error" : "task_result"
  return [
    `<task id="${TrustBoundary.escape(input.sessionID)}" state="${input.state}">`,
    ...(input.summary ? [`<summary>${TrustBoundary.escape(input.summary)}</summary>`] : []),
    `<${tag}>`,
    TrustBoundary.block("delegated task result", "delegated result", input.text),
    `</${tag}>`,
    "</task>",
  ].join("\n")
}

export const TaskTool = Tool.define(
  id,
  Effect.gen(function* () {
    const agent = yield* Agent.Service
    const background = yield* BackgroundJob.Service
    const config = yield* Config.Service
    const sessions = yield* Session.Service
    const scope = yield* Scope.Scope
    const flags = yield* RuntimeFlags.Service
    const database = yield* Database.Service
    const todos = yield* Todo.Service

    const run = Effect.fn("TaskTool.execute")(function* (
      params: Schema.Schema.Type<typeof Parameters>,
      ctx: Tool.Context,
    ) {
      const cfg = yield* config.get()
      const runInBackground = params.background === true
      if (runInBackground && !flags.experimentalBackgroundSubagents) {
        return yield* Effect.fail(
          new Error("Background subagents require OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true"),
        )
      }

      const parent = yield* sessions.get(ctx.sessionID)
      let root = parent
      let depth = 0
      while (root.parentID) {
        depth++
        root = yield* sessions.get(root.parentID)
      }
      const isParentOwner = OwnerSession.isInternal(parent)
      let effectiveSubagentType = params.subagent_type
      let effectivePrompt = params.prompt

      if (!isParentOwner) {
        const isAlreadyOwner = Object.keys(DOMAIN_OWNERS).includes(effectiveSubagentType)
        if (!isAlreadyOwner) {
          const originalSubagent = effectiveSubagentType
          const resolvedDomain = resolveDomainOwner(params.prompt, effectiveSubagentType)

          if (!DOMAIN_OWNERS[resolvedDomain]) {
            DOMAIN_OWNERS[resolvedDomain] = {
              description: `Codebase Domain Owner for ${resolvedDomain}. Handles subsystem architectural integrity, invariants, and child delegation.`,
            }
          }

          effectiveSubagentType = resolvedDomain
          effectivePrompt = params.prompt
        }
      }
      const maxDepth = Math.max(cfg.subagent_depth ?? 1, isParentOwner ? 2 : 2)
      if (depth >= maxDepth) {
        return yield* Effect.fail(
          new Error(
            `Subagent depth limit reached (${maxDepth}). Increase "subagent_depth" to allow nested subagents.`,
          ),
        )
      }

      if (!ctx.extra?.bypassAgentCheck) {
        yield* ctx.ask({
          permission: id,
          patterns: [effectiveSubagentType],
          always: ["*"],
          metadata: {
            description: params.description,
            subagent_type: effectiveSubagentType,
          },
        })
      }

      let next = yield* agent.get(effectiveSubagentType)
      let ownerHint: string | undefined = undefined
      if (!next) {
        const general = yield* agent.get("general")
        if (general) {
          next = general
          ownerHint = effectiveSubagentType
        }
      }
      if (!next) {
        return yield* Effect.fail(new Error(`Unknown agent type: ${effectiveSubagentType} is not a valid agent type`))
      }

      const requestedSession = params.task_id
        ? yield* sessions.get(SessionID.make(params.task_id)).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
        : undefined
      const workdir = typeof ctx.extra?.worktree === "string" ? ctx.extra.worktree : undefined
      const repoID = workdir ? OwnerRegistry.repositoryID(workdir) : undefined
      const ownerRegistry = workdir
        ? yield* OwnerRegistry.open(workdir, ctx.sessionID).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
        : undefined
      const persistentOwner = ownerRegistry && repoID ? ownerRegistry.get(repoID, effectiveSubagentType) : undefined
      const persistentSessionID = persistentOwner?.currentSessionID
      const persistentSession =
        !requestedSession && persistentSessionID
          ? yield* sessions
              .get(SessionID.make(persistentSessionID))
              .pipe(Effect.catchCause(() => Effect.succeed(undefined)))
          : undefined

      const ownerTask = yield* OCXTask.prepare({
        enabled: flags.ocxPipeline,
        workdir,
        sessionID: ctx.sessionID,
        prompt: ownerHint ? `[domain: ${ownerHint}] ${effectivePrompt}` : effectivePrompt,
        contextEnabled: flags.contextEnabled,
        contextRetrieval: flags.contextAgentRetrieval,
        contextFreshnessChecks: flags.contextFreshnessChecks,
        incidentalUpdates: flags.contextIncidentalUpdates,
      })
      const ownerSession =
        !requestedSession && !persistentSession
          ? yield* OCXTask.reusableSession(
              ownerTask,
              (sessionID) =>
                sessions.get(SessionID.make(sessionID)).pipe(Effect.mapError((error) => error as unknown)),
            )
          : undefined
      const session = requestedSession ?? persistentSession ?? ownerSession
      const primaryTools = cfg.experimental?.primary_tools ?? []
      const childPermission = deriveSubagentSessionPermission({
        parentSessionPermission: parent.permission ?? [],
        subagent: next,
      }).filter(
        (rule) =>
          rule.action !== "allow" || !primaryTools.some((tool) => Wildcard.match(tool, rule.permission)),
      )
      const isOwnerSession = Boolean(ownerTask.owner)
      const childToolDenies = [
        ...(next.permission.some((rule) => rule.permission === "todowrite")
          ? []
          : [{ permission: "todowrite" as const, pattern: "*" as const, action: "deny" as const }]),
        ...(isOwnerSession || next.permission.some((rule) => rule.permission === id)
          ? []
          : [{ permission: id, pattern: "*" as const, action: "deny" as const }]),
        ...primaryTools.map((permission) => ({
          permission,
          pattern: "*" as const,
          action: "deny" as const,
        })),
      ]
      const nextSession =
        session ??
        (yield* sessions.create({
          parentID: ctx.sessionID,
          title: OCXTask.title(ownerTask, params.description, next.name),
          agent: next.name,
          ...(OCXTask.sessionMetadata(ownerTask) ? { metadata: OCXTask.sessionMetadata(ownerTask) } : {}),
          permission: [
            ...childPermission,
            ...childToolDenies.filter(
              (deny) =>
                !childPermission.some(
                  (rule) =>
                    rule.permission === deny.permission && rule.pattern === deny.pattern && rule.action === deny.action,
                ),
            ),
          ],
        }))

      if (ownerRegistry && repoID && persistentOwner && nextSession.id !== persistentSessionID) {
        ownerRegistry.attachSession(repoID, effectiveSubagentType, nextSession.id)
      }
      if (ownerTask.owner && nextSession.id !== ownerTask.owner.currentSessionID)
        yield* OCXTask.attachSession(ownerTask, nextSession.id).pipe(Effect.ignore)

      const msg = yield* MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID }).pipe(
        Effect.provideService(Database.Service, database),
        Effect.orDie,
      )
      if (msg.info.role !== "assistant") return yield* Effect.fail(new Error("Not an assistant message"))
      const variant = msg.info.variant

      const primaryModel = root.model
        ? {
            modelID: root.model.id,
            providerID: root.model.providerID,
          }
        : {
            modelID: msg.info.modelID,
            providerID: msg.info.providerID,
          }
      const primaryVariant = root.model?.variant ?? variant

      const isOwner = Boolean(ownerTask.owner || persistentOwner || CURATED_DOMAIN_OWNERS.has(next.name))
      const model = isOwner
        ? primaryModel
        : (next.model ?? primaryModel)
      const selectedVariant = isOwner
        ? primaryVariant
        : (next.model ? undefined : (primaryVariant ?? variant))

      if (
        nextSession.model?.providerID !== model.providerID ||
        nextSession.model?.id !== model.modelID
      ) {
        yield* sessions
          .setAgentModel({
            sessionID: nextSession.id,
            agent: nextSession.agent ?? next.name,
            model: {
              id: model.modelID,
              providerID: model.providerID,
              variant: selectedVariant ?? "default",
            },
            time: Date.now(),
          })
          .pipe(Effect.ignore)
      }

      const metadata = OCXTask.metadata(ownerTask, {
        parentSessionID: ctx.sessionID,
        sessionID: nextSession.id,
        model,
        ...(runInBackground ? { background: true } : {}),
      })

      yield* OCXTask.start(ownerTask, ctx.sessionID, params.description).pipe(Effect.ignore)

      yield* ctx.metadata({
        title: params.description,
        metadata,
      })

      const ops = ctx.extra?.promptOps as TaskPromptOps
      if (!ops) return yield* Effect.fail(new Error("TaskTool requires promptOps in ctx.extra"))

      const syncParentTodo = Effect.fn("TaskTool.syncParentTodo")(function* (status: TodoSync.DelegatedStatus) {
        const existing = yield* todos.get(ctx.sessionID).pipe(Effect.catch(() => Effect.succeed([])))
        const updated = TodoSync.reconcileDelegation(existing, params.description, status)
        if (JSON.stringify(existing) === JSON.stringify(updated)) return
        yield* todos.update({ sessionID: ctx.sessionID, todos: updated }).pipe(Effect.ignore)
      })
      yield* syncParentTodo("in_progress")

      const runTask = Effect.fn("TaskTool.runTask")(function* () {
        return yield* OCXTask.execute(
          ownerTask,
          { primarySessionID: ctx.sessionID, summary: params.description },
          Effect.gen(function* () {
            const parts = yield* ops.resolvePromptParts(
              OCXTask.prompt(ownerTask, effectivePrompt, Boolean(session)),
            )
            return yield* ops.prompt({
              messageID: MessageID.ascending(),
              sessionID: nextSession.id,
              model: {
                modelID: model.modelID,
                providerID: model.providerID,
              },
              variant: selectedVariant,
              agent: next.name,
              parts,
            })
          }),
        )
      })

      const inject = Effect.fn("TaskTool.injectBackgroundResult")(function* (
        state: "completed" | "error",
        text: string,
      ) {
        yield* syncParentTodo(state === "completed" ? "completed" : "pending").pipe(Effect.ignore)
        const currentParent = yield* sessions.get(ctx.sessionID)
        yield* ops
          .prompt({
            sessionID: ctx.sessionID,
            agent: currentParent.agent ?? ctx.agent,
            variant,
            parts: [
              {
                type: "text",
                synthetic: true,
                text: renderOutput({
                  sessionID: nextSession.id,
                  state,
                  summary:
                    state === "completed"
                      ? `Background task completed: ${params.description}`
                      : `Background task failed: ${params.description}`,
                  text,
                }),
              },
            ],
          })
          .pipe(Effect.ignore, Effect.forkIn(scope, { startImmediately: true }))
      })

      const notify = Effect.fn("TaskTool.notifyBackgroundResult")(function* (jobID: string) {
        yield* background.wait({ id: jobID }).pipe(
          Effect.flatMap((result) => {
            if (result.info?.status === "completed") return inject("completed", result.info.output ?? "")
            if (result.info?.status === "error") return inject("error", result.info.error ?? "")
            if (result.info?.status === "cancelled") return syncParentTodo("pending").pipe(Effect.ignore)
            return Effect.void
          }),
          Effect.forkIn(scope, { startImmediately: true }),
        )
      })

      if (yield* background.extend({ id: nextSession.id, run: runTask() })) {
        return {
          title: params.description,
          metadata: {
            ...metadata,
            background: true,
            jobId: nextSession.id,
          },
          output: renderOutput({
            sessionID: nextSession.id,
            state: "running",
            summary: "Background task updated",
            text: BACKGROUND_UPDATED,
          }),
        }
      }

      const info = yield* background.start({
        id: nextSession.id,
        type: id,
        title: params.description,
        metadata,
        onPromote: Effect.all([
          ctx.metadata({
            title: params.description,
            metadata: { ...metadata, background: true, jobId: nextSession.id },
          }),
          notify(nextSession.id),
        ]),
        run: runTask().pipe(Effect.onInterrupt(() => ops.cancel(nextSession.id))),
      })

      function backgroundResult() {
        return {
          title: params.description,
          metadata: {
            ...metadata,
            background: true,
            jobId: info.id,
          },
          output: renderOutput({
            sessionID: nextSession.id,
            state: "running",
            summary: "Background task started",
            text: BACKGROUND_STARTED,
          }),
        }
      }

      if (runInBackground) {
        yield* notify(info.id)
        return backgroundResult()
      }

      const runCancel = yield* EffectBridge.make()
      const cancel = ops.cancel(nextSession.id)

      function onAbort() {
        runCancel.fork(cancel)
      }

      return yield* Effect.acquireUseRelease(
        Effect.sync(() => {
          ctx.abort.addEventListener("abort", onAbort)
        }),
        () =>
          Effect.gen(function* () {
            const result = yield* Effect.raceFirst(
              background.wait({ id: nextSession.id }).pipe(Effect.map((waited) => waited.info)),
              background.waitForPromotion(nextSession.id),
            )
            if (result?.metadata?.background === true) return backgroundResult()
            if (result?.status === "error") {
              yield* syncParentTodo("pending").pipe(Effect.ignore)
              return yield* Effect.fail(new Error(result.error ?? "Task failed"))
            }
            if (result?.status === "cancelled") {
              yield* syncParentTodo("pending").pipe(Effect.ignore)
              return yield* Effect.fail(new Error("Task cancelled"))
            }
            yield* syncParentTodo("completed").pipe(Effect.ignore)
            return {
              title: params.description,
              metadata,
              output: renderOutput({ sessionID: nextSession.id, state: "completed", text: result?.output ?? "" }),
            }
          }),
        (_, exit) =>
          Effect.gen(function* () {
            if (Exit.hasInterrupts(exit))
              yield* Effect.all([cancel, background.cancel(nextSession.id), syncParentTodo("pending")], { discard: true })
          }).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                ctx.abort.removeEventListener("abort", onAbort)
              }),
            ),
          ),
      )
    })

    return {
      description: flags.experimentalBackgroundSubagents
        ? [DESCRIPTION, BACKGROUND_DESCRIPTION].join("\n\n")
        : DESCRIPTION,
      parameters: Parameters,
      jsonSchema: flags.experimentalBackgroundSubagents ? undefined : ToolJsonSchema.fromSchema(BaseParameters),
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        run(params, ctx).pipe(Effect.orDie),
    }
  }),
)
