import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import path from "path"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import os from "os"
import { SessionID, MessageID, PartID } from "./schema"
import { MessageV2 } from "./message-v2"
import { SessionRevert } from "./revert"
import { Session } from "./session"
import { Agent } from "../agent/agent"
import { Provider } from "@/provider/provider"

import { type Tool as AITool, tool, jsonSchema } from "ai"
import type { JSONSchema7 } from "@ai-sdk/provider"
import { SessionCompaction } from "./compaction"
import { SystemPrompt } from "./system"
import { Instruction } from "./instruction"
import { Plugin } from "../plugin"
import { MAX_STEPS_PROMPT } from "@opencode-ai/core/session/runner/max-steps"
import { ToolRegistry } from "@/tool/registry"
import { MCP } from "../mcp"
import { LSP } from "@/lsp/lsp"
import { ulid } from "ulid"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import * as Stream from "effect/Stream"
import { Command } from "../command"
import { pathToFileURL, fileURLToPath } from "url"
import { Config } from "@/config/config"
import { ConfigMarkdown } from "@/config/markdown"
import { SessionSummary } from "./summary"
import { NamedError } from "@opencode-ai/core/util/error"
import { SessionProcessor } from "./processor"
import { Tool } from "@/tool/tool"
import { Permission } from "@/permission"
import { SessionStatus } from "./status"
import { Todo } from "./todo"
import { LLM } from "./llm"
import { Shell } from "@opencode-ai/core/shell"
import { ShellID } from "@/tool/shell/id"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Truncate } from "@/tool/truncate"
import { Image } from "@/image/image"
import { decodeDataUrl } from "@/util/data-url"
import { Process } from "@/util/process"
import { Cause, Effect, Exit, Latch, Layer, Option, Scope, Context, Schema, Types } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { TaskTool, type TaskPromptOps } from "@/tool/task"
import { SessionRunState } from "./run-state"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Database } from "@opencode-ai/core/database/database"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { eq } from "drizzle-orm"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { SessionReminders } from "./reminders"
import { SessionTools } from "./tools"
import { LLMEvent } from "@opencode-ai/llm"
import { OCXWorkflowEvent } from "@opencode-ai/schema/ocx-workflow-event"
import { ActivityRuntime } from "@/ocx/activity/runtime"
import { BuildGuard } from "@/ocx/build-guard"
import { MutationGuard } from "@/ocx/mutation-guard"
import { OCXDb } from "@/ocx/ocx-db"
import { HeaderTool } from "@/ocx/turn/header-tool"
import { Gate } from "@/ocx/turn/gate"
import { OCXPipeline } from "@/ocx/ocx-pipeline"
import { OperationClassifier } from "@/ocx/operation-classifier"
import { PathConstraint } from "@/ocx/scope/path-constraint"
import { PlaybookQueue } from "@/ocx/playbook/queue"
import { PlaybookRunner } from "@/ocx/playbook/runner"
import { PromptGovernor } from "@/ocx/prompt-governor"
import { PromptTools } from "@/ocx/prompt-tools"
import { ReasoningControl } from "@/ocx/reasoning/control"
import { ShellPolicy } from "@/ocx/shell-policy"
import { VerifyLadder } from "@/ocx/verify-ladder"
import { WorkflowV2 } from "@/ocx/workflow-v2"
import { declaresDone, declaresNeedsInput } from "@/ocx/session-done"
import { Claim } from "@/ocx/turn/claim"
import { Frame } from "@/ocx/turn/frame"
import type { Stage } from "@/ocx/turn/types"
import { State } from "@/ocx/turn/state"
import { BeforeStep } from "@/ocx/turn/before-step"
import type { PromptBlock } from "@/ocx/prompt-governor"
import { AttentionCoordinator } from "@/ocx/attention/coordinator"
import { containsPath } from "../project/instance-context"
import { SystemContext } from "@opencode-ai/core/system-context"
import { OCXSystemContext } from "@/system-context/ocx"

globalThis.AI_SDK_LOG_WARNINGS = false

const decodeMessageInfo = Schema.decodeUnknownExit(SessionV1.Info)
const decodeMessagePart = Schema.decodeUnknownExit(SessionV1.Part)
const MAX_MCP_RESOURCE_BLOB_BYTES = 10 * 1024 * 1024
const SUPPORTED_MCP_RESOURCE_ATTACHMENT_MIMES = new Set([
  "application/pdf",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
])

function promptBlock(
  source: PromptBlock["source"],
  content: string,
  id: string,
  trimPolicy?: PromptBlock["trimPolicy"],
): PromptBlock {
  return {
    source,
    content,
    id,
    tokens: Math.ceil(content.length / 4),
    ...(trimPolicy ? { trimPolicy } : {}),
  }
}

const STRUCTURED_OUTPUT_DESCRIPTION = `Use this tool to return your final response in the requested structured format.

IMPORTANT:
- You MUST call this tool exactly once at the end of your response
- The input must be valid JSON matching the required schema
- Complete all necessary research and tool calls BEFORE calling this tool
- This tool provides your final answer - no further actions are taken after calling it`

const STRUCTURED_OUTPUT_SYSTEM_PROMPT = `IMPORTANT: The user has requested structured output. You MUST use the StructuredOutput tool to provide your final response. Do NOT respond with plain text - you MUST call the StructuredOutput tool with your answer formatted according to the schema.`

function mcpResourceBase64Size(value: string) {
  const trimmed = value.replace(/\s/g, "")
  const padding = trimmed.endsWith("==") ? 2 : trimmed.endsWith("=") ? 1 : 0
  return Math.max(0, Math.floor((trimmed.length * 3) / 4) - padding)
}

function formatMcpResourceBytes(value: number) {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${Math.ceil(value / 1024)} KB`
  return `${Math.ceil(value / (1024 * 1024))} MB`
}

function isOrphanedInterruptedTool(part: SessionV1.ToolPart) {
  return part.state.status === "error" && part.state.metadata?.interrupted === true
}

const MAX_TODO_NUDGES = 2

function todoNudgeText(open: readonly Todo.Info[], doneDeclared = false) {
  const items = open.map((item) => `- [${item.status}] ${item.content}`).join("\n")
  const prefix = doneDeclared
    ? "OCX todo guard: You declared STATE: done, but the session todo list still has open items:\n"
    : "OCX todo guard: the todo list still has open items:\n"
  return `${prefix}${items}\nBefore stopping, use the todowrite tool to mark finished items completed, cancel stale ones, or keep working on the next item. Do not end with a stale list.`
}

export interface Interface {
  readonly cancel: (sessionID: SessionID) => Effect.Effect<void>
  readonly prompt: (input: PromptInput) => Effect.Effect<SessionV1.WithParts, Image.Error>
  readonly loop: (input: LoopInput) => Effect.Effect<SessionV1.WithParts>
  readonly shell: (input: ShellInput) => Effect.Effect<SessionV1.WithParts, Session.BusyError>
  readonly command: (input: CommandInput) => Effect.Effect<SessionV1.WithParts, Image.Error>
  readonly resolvePromptParts: (template: string) => Effect.Effect<PromptInput["parts"]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionPrompt") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const status = yield* SessionStatus.Service
    const sessions = yield* Session.Service
    const agents = yield* Agent.Service
    const provider = yield* Provider.Service
    const processor = yield* SessionProcessor.Service
    const compaction = yield* SessionCompaction.Service
    const plugin = yield* Plugin.Service
    const commands = yield* Command.Service
    const config = yield* Config.Service
    const permission = yield* Permission.Service
    const fsys = yield* FSUtil.Service
    const mcp = yield* MCP.Service
    const lsp = yield* LSP.Service
    const registry = yield* ToolRegistry.Service
    const truncate = yield* Truncate.Service
    const image = yield* Image.Service
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const scope = yield* Scope.Scope
    const instruction = yield* Instruction.Service
    const state = yield* SessionRunState.Service
    const revert = yield* SessionRevert.Service
    const summary = yield* SessionSummary.Service
    const sys = yield* SystemPrompt.Service
    const llm = yield* LLM.Service
    const events = yield* EventV2Bridge.Service
    const flags = yield* RuntimeFlags.Service
    const todo = yield* Todo.Service
    const database = yield* Database.Service
    const { db } = database
    const ops = Effect.fn("SessionPrompt.ops")(function* () {
      return {
        cancel: (sessionID: SessionID) => cancel(sessionID),
        resolvePromptParts: (template: string) => resolvePromptParts(template),
        prompt: (input: PromptInput) => prompt(input).pipe(Effect.catch(Effect.die)),
      } satisfies TaskPromptOps
    })

    const guardShell = Effect.fn("SessionPrompt.guardShell")(function* (input: {
      readonly sessionID: SessionID
      readonly parentSessionID?: string
      readonly cwd: string
      readonly command: string
      readonly applyRepositoryPolicy?: boolean
      readonly store?: OCXDb.Store
    }) {
      const store = input.store ?? (yield* OCXDb.shared.pipe(Effect.catch(() => Effect.succeed(OCXDb.memory()))))
      if (flags.ocxPipeline) {
        const auth = WorkflowV2.Gate.guardAction({
          operation: "command.run",
          sessionID: input.sessionID,
          command: input.command,
        })
        if (!auth.allowed) throw new Error(auth.reason ?? `Workflow blocked: command disallowed`)
      }
      if (input.applyRepositoryPolicy !== false) {
        const shellRule = ShellPolicy.check(input.command, input.cwd)
        if (shellRule) throw new Error(`${shellRule.rule}: ${shellRule.message}`)
      }
    })

    const runVerificationCommand = Effect.fn("SessionPrompt.runVerificationCommand")(function* (input: {
      readonly sessionID: SessionID
      readonly messageID: MessageID
      readonly agent: Agent.Info
      readonly session: Session.Info
      readonly messages: readonly SessionV1.WithParts[]
      readonly store: OCXDb.Store
      readonly command: string
      readonly cwd: string
      readonly timeoutMs: number
      readonly kind: VerifyLadder.RunCommandInput["kind"]
    }) {
      yield* guardShell({
        sessionID: input.sessionID,
        cwd: input.cwd,
        command: input.command,
        store: input.store,
      })

      const instance = yield* InstanceState.context
      const constraints = PathConstraint.fromMessages(input.messages, instance.directory)
      const executionDecision = PathConstraint.authorize(constraints, "execute", input.cwd)
      if (executionDecision && !executionDecision.allowed)
        throw new Error(PathConstraint.renderBlocked(executionDecision))
      const readTargets = ShellPolicy.readTargets(input.command, input.cwd)
      const readDecision = PathConstraint.firstBlockedRead(constraints, readTargets)
      if (readDecision) throw new Error(PathConstraint.renderBlocked(readDecision))

      const externalDirectories = [
        ...new Set(readTargets.filter((target) => !containsPath(target, instance)).map((target) => path.dirname(target))),
      ]
      if (externalDirectories.length > 0) {
        const patterns = externalDirectories.map((directory) =>
          process.platform === "win32" ? FSUtil.normalizePathPattern(path.join(directory, "*")) : path.join(directory, "*"),
        )
        yield* permission.ask({
          permission: "external_directory",
          patterns,
          always: patterns,
          metadata: {
            command: input.command,
            directories: externalDirectories,
            reason: "verification command reads outside the working directory",
          },
          sessionID: input.sessionID,
          tool: { messageID: input.messageID, callID: `ocx-verify-${input.kind}` },
          ruleset: Permission.merge(input.agent.permission, input.session.permission ?? []),
        })
      }

      const buildDecision = BuildGuard.classifyCommand(input.command)
      if (buildDecision.requiresPermission)
        yield* permission.ask({
          permission: buildDecision.permission,
          patterns: [input.command],
          always: [],
          metadata: {
            command: input.command,
            reason: "verification command requires explicit user approval",
            detail: buildDecision.reason,
            kind: buildDecision.kind,
            destructive: buildDecision.destructive,
          },
          sessionID: input.sessionID,
          tool: { messageID: input.messageID, callID: `ocx-verify-${input.kind}` },
          ruleset: Permission.merge(input.agent.permission, input.session.permission ?? []),
        })

      const cfg = yield* config.get()
      const shell = Shell.acceptable(cfg.shell)
      const startedAt = Date.now()
      const abort = new AbortController()
      const timer = setTimeout(() => abort.abort(), input.timeoutMs)
      const result = yield* Effect.promise(() =>
        Process.text([input.command], {
          cwd: input.cwd,
          shell,
          abort: abort.signal,
          nothrow: true,
        }),
      ).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            clearTimeout(timer)
            abort.abort()
          }),
        ),
      )
      return {
        outcome: result.code === 0 ? ("passed" as const) : ("failed" as const),
        durationMs: Date.now() - startedAt,
      }
    })

    const cancel = Effect.fn("SessionPrompt.cancel")(function* (sessionID: SessionID) {
      yield* Effect.logInfo("cancel", { "session.id": sessionID })
      yield* state.cancel(sessionID)
    })

    const resolvePromptParts = Effect.fn("SessionPrompt.resolvePromptParts")(function* (template: string) {
      const ctx = yield* InstanceState.context
      const parts: Types.DeepMutable<PromptInput["parts"]> = [{ type: "text", text: template }]
      const files = ConfigMarkdown.files(template)
      const seen = new Set<string>()
      yield* Effect.forEach(
        files,
        Effect.fnUntraced(function* (match) {
          const name = match[1]
          if (!name) return
          if (seen.has(name)) return
          seen.add(name)

          const filepath = name.startsWith("~/")
            ? path.join(os.homedir(), name.slice(2))
            : path.resolve(ctx.worktree, name)

          const info = yield* fsys.stat(filepath).pipe(Effect.option)
          if (Option.isNone(info)) {
            const found = yield* agents.get(name)
            if (found) parts.push({ type: "agent", name: found.name })
            return
          }
          const stat = info.value
          parts.push({
            type: "file",
            url: pathToFileURL(filepath).href,
            filename: name,
            mime: stat.type === "Directory" ? "application/x-directory" : "text/plain",
          })
        }),
        { concurrency: "unbounded", discard: true },
      )
      return parts
    })

    const title = Effect.fn("SessionPrompt.ensureTitle")(function* (input: {
      session: Session.Info
      history: SessionV1.WithParts[]
      providerID: ProviderV2.ID
      modelID: ModelV2.ID
    }) {
      if (input.session.parentID) return
      if (!Session.isDefaultTitle(input.session.title)) return

      const real = (m: SessionV1.WithParts) =>
        m.info.role === "user" && !m.parts.every((p) => "synthetic" in p && p.synthetic)
      const idx = input.history.findIndex(real)
      if (idx === -1) return

      const context = input.history.slice(0, idx + 1)
      const firstUser = context[idx]
      if (!firstUser || firstUser.info.role !== "user") return
      const firstInfo = firstUser.info

      const subtasks = firstUser.parts.filter((p): p is SessionV1.SubtaskPart => p.type === "subtask")
      const onlySubtasks = subtasks.length > 0 && firstUser.parts.every((p) => p.type === "subtask")

      const ag = yield* agents.get("title")
      if (!ag) return
      const mdl = ag.model
        ? yield* provider.getModel(ag.model.providerID, ag.model.modelID)
        : yield* provider.getModel(input.providerID, input.modelID)
      const msgs = onlySubtasks
        ? [{ role: "user" as const, content: subtasks.map((p) => p.prompt).join("\n") }]
        : yield* MessageV2.toModelMessagesEffect(context, mdl)
      const streamed = yield* llm
        .stream({
          agent: ag,
          user: firstInfo,
          system: [],
          small: true,
          tools: {},
          model: mdl,
          sessionID: input.session.id,
          retries: 2,
          messages: [{ role: "user", content: "Generate a title for this conversation:\n" }, ...msgs],
        })
        .pipe(
          Stream.filter(LLMEvent.is.textDelta),
          Stream.map((e) => e.text),
          Stream.mkString,
          Effect.exit,
        )
      const text = Exit.isSuccess(streamed) ? streamed.value : undefined
      const found = text
        ?.replace(/<think>[\s\S]*?<\/think>\s*/g, "")
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line.length > 0)
      const cleaned = found === undefined ? undefined : capTitle(found)
      const t = cleaned ?? titleFromParts(firstUser.parts)
      if (!t) return
      yield* sessions
        .setTitle({ sessionID: input.session.id, title: t })
        .pipe(Effect.catchCause((cause) => Effect.logError("failed to generate title", { error: Cause.squash(cause) })))
    })

    const capTitle = (line: string) => (line.length > 100 ? line.substring(0, 97) + "..." : line)

    function titleFromParts(parts: SessionV1.Part[]) {
      const text = parts.find(
        (p): p is SessionV1.TextPart => p.type === "text" && !("synthetic" in p && p.synthetic),
      )?.text
      if (!text) return undefined
      const line = text
        .replace(/<think>[\s\S]*?<\/think>\s*/g, "")
        .split("\n")
        .map((candidate) => candidate.trim())
        .find((candidate) => candidate.length > 0)
      return line ? capTitle(line.replace(/\s+/g, " ").trim()) : undefined
    }

    const handleSubtask = Effect.fn("SessionPrompt.handleSubtask")(function* (input: {
      task: SessionV1.SubtaskPart
      model: Provider.Model
      lastUser: SessionV1.User
      sessionID: SessionID
      session: Session.Info
      msgs: SessionV1.WithParts[]
    }) {
      const { task, model, lastUser, sessionID, session, msgs } = input
      const ctx = yield* InstanceState.context
      const store = yield* OCXDb.shared.pipe(Effect.catch(() => Effect.succeed(OCXDb.memory())))
      if (flags.ocxPipeline) {
        const auth = WorkflowV2.Gate.guardTool({ toolName: TaskTool.id, sessionID })
        if (!auth.allowed) throw new Error(auth.renderedFailure ?? auth.reason ?? `Workflow blocked: tool ${TaskTool.id} disallowed`)
      }
      const promptOps = yield* ops()
      const { task: taskTool } = yield* registry.named()
      const taskModel = task.model ? yield* getModel(task.model.providerID, task.model.modelID, sessionID) : model
      const assistantMessage: SessionV1.Assistant = yield* sessions.updateMessage({
        id: MessageID.ascending(),
        role: "assistant",
        parentID: lastUser.id,
        sessionID,
        mode: task.agent,
        agent: task.agent,
        variant: lastUser.model.variant,
        path: { cwd: ctx.directory, root: ctx.worktree },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        modelID: taskModel.id,
        providerID: taskModel.providerID,
        time: { created: Date.now() },
      })
      let part: SessionV1.ToolPart = yield* sessions.updatePart({
        id: PartID.ascending(),
        messageID: assistantMessage.id,
        sessionID: assistantMessage.sessionID,
        type: "tool",
        callID: ulid(),
        tool: TaskTool.id,
        state: {
          status: "running",
          input: {
            prompt: task.prompt,
            description: task.description,
            subagent_type: task.agent,
            command: task.command,
          },
          time: { start: Date.now() },
        },
      })
      const taskArgs = {
        prompt: task.prompt,
        description: task.description,
        subagent_type: task.agent,
        command: task.command,
      }
      yield* plugin.trigger(
        "tool.execute.before",
        { tool: TaskTool.id, sessionID, callID: part.id },
        { args: taskArgs },
      )

      const taskAgent = yield* agents.get(task.agent)
      if (!taskAgent) {
        const available = (yield* agents.list()).filter((a) => !a.hidden).map((a) => a.name)
        const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
        const error = new NamedError.Unknown({ message: `Agent not found: "${task.agent}".${hint}` })
        yield* events.publish(Session.Event.Error, { sessionID, error: error.toObject() })
        throw error
      }

      let error: Error | undefined
      const taskAbort = new AbortController()
      const result = yield* taskTool
        .execute(taskArgs, {
          agent: task.agent,
          messageID: assistantMessage.id,
          sessionID,
          abort: taskAbort.signal,
          callID: part.callID,
          extra: { bypassAgentCheck: true, promptOps },
          messages: msgs,
          metadata: (val: { title?: string; metadata?: Record<string, any> }) =>
            Effect.gen(function* () {
              part = yield* sessions.updatePart({
                ...part,
                type: "tool",
                state: { ...part.state, ...val },
              } satisfies SessionV1.ToolPart)
            }),
          ask: (req: any) =>
            permission
              .ask({
                ...req,
                sessionID,
                ruleset: Permission.merge(taskAgent.permission, session.permission ?? []),
              })
              .pipe(Effect.orDie),
        })
        .pipe(
          Effect.catchCause((cause) => {
            const defect = Cause.squash(cause)
            error = defect instanceof Error ? defect : new Error(String(defect))
            return Effect.logError("subtask execution failed", {
              error,
              agent: task.agent,
              description: task.description,
            })
          }),
          Effect.onInterrupt(() =>
            Effect.gen(function* () {
              taskAbort.abort()
              assistantMessage.finish = "tool-calls"
              assistantMessage.time.completed = Date.now()
              yield* sessions.updateMessage(assistantMessage)
              if (part.state.status === "running") {
                yield* sessions.updatePart({
                  ...part,
                  state: {
                    status: "error",
                    error: "Cancelled",
                    time: { start: part.state.time.start, end: Date.now() },
                    metadata: part.state.metadata,
                    input: part.state.input,
                  },
                } satisfies SessionV1.ToolPart)
              }
            }),
          ),
        )

      const attachments = result?.attachments?.map((attachment) => ({
        ...attachment,
        id: PartID.ascending(),
        sessionID,
        messageID: assistantMessage.id,
      }))

      yield* plugin.trigger(
        "tool.execute.after",
        { tool: TaskTool.id, sessionID, callID: part.id, args: taskArgs },
        result,
      )

      assistantMessage.finish = "tool-calls"
      assistantMessage.time.completed = Date.now()
      yield* sessions.updateMessage(assistantMessage)

      if (result && part.state.status === "running") {
        yield* sessions.updatePart({
          ...part,
          state: {
            status: "completed",
            input: part.state.input,
            title: result.title,
            metadata: result.metadata,
            output: result.output,
            attachments,
            time: { ...part.state.time, end: Date.now() },
          },
        } satisfies SessionV1.ToolPart)
      }

      if (!result) {
        yield* sessions.updatePart({
          ...part,
          state: {
            status: "error",
            error: error ? `Tool execution failed: ${error.message}` : "Tool execution failed",
            time: {
              start: part.state.status === "running" ? part.state.time.start : Date.now(),
              end: Date.now(),
            },
            metadata: part.state.status === "pending" ? undefined : part.state.metadata,
            input: part.state.input,
          },
        } satisfies SessionV1.ToolPart)
      }

      if (!task.command) return

      const summaryUserMsg: SessionV1.User = {
        id: MessageID.ascending(),
        sessionID,
        role: "user",
        time: { created: Date.now() },
        agent: lastUser.agent,
        model: lastUser.model,
      }
      yield* sessions.updateMessage(summaryUserMsg)
      yield* sessions.updatePart({
        id: PartID.ascending(),
        messageID: summaryUserMsg.id,
        sessionID,
        type: "text",
        text: "Summarize the task tool output above and continue with your task.",
        synthetic: true,
      } satisfies SessionV1.TextPart)
    })

    const shellImpl = Effect.fn("SessionPrompt.shellImpl")(function* (input: ShellInput, ready?: Latch.Latch) {
      return yield* Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const markReady = ready ? ready.open.pipe(Effect.asVoid) : Effect.void
          const { msg, part, cwd } = yield* Effect.gen(function* () {
            const ctx = yield* InstanceState.context
            const session = yield* sessions.get(input.sessionID).pipe(Effect.orDie)
            yield* guardShell({
              sessionID: input.sessionID,
              parentSessionID: session.parentID,
              cwd: ctx.directory,
              command: input.command,
              applyRepositoryPolicy: false,
            })
            if (session.revert) {
              yield* revert.cleanup(session)
            }
            const agent = yield* agents.get(input.agent)
            if (!agent) {
              const available = (yield* agents.list()).filter((a) => !a.hidden).map((a) => a.name)
              const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
              const error = new NamedError.Unknown({ message: `Agent not found: "${input.agent}".${hint}` })
              yield* events.publish(Session.Event.Error, { sessionID: input.sessionID, error: error.toObject() })
              throw error
            }
            const model = input.model ?? agent.model ?? (yield* currentModel(input.sessionID))
            const userMsg: SessionV1.User = {
              id: input.messageID ?? MessageID.ascending(),
              sessionID: input.sessionID,
              time: { created: Date.now() },
              role: "user",
              agent: input.agent,
              model: { providerID: model.providerID, modelID: model.modelID },
            }
            yield* sessions.updateMessage(userMsg)
            const userPart: SessionV1.Part = {
              type: "text",
              id: PartID.ascending(),
              messageID: userMsg.id,
              sessionID: input.sessionID,
              text: "The following tool was executed by the user",
              synthetic: true,
            }
            yield* sessions.updatePart(userPart)

            const msg: SessionV1.Assistant = {
              id: MessageID.ascending(),
              sessionID: input.sessionID,
              parentID: userMsg.id,
              mode: input.agent,
              agent: input.agent,
              cost: 0,
              path: { cwd: ctx.directory, root: ctx.worktree },
              time: { created: Date.now() },
              role: "assistant",
              tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
              modelID: model.modelID,
              providerID: model.providerID,
            }
            yield* sessions.updateMessage(msg)
            const started = Date.now()
            const part: SessionV1.ToolPart = {
              type: "tool",
              id: PartID.ascending(),
              messageID: msg.id,
              sessionID: input.sessionID,
              tool: ShellID.ToolID,
              callID: ulid(),
              state: {
                status: "running",
                time: { start: started },
                input: { command: input.command },
              },
            }
            yield* sessions.updatePart(part)
            return { msg, part, cwd: ctx.directory }
          }).pipe(Effect.ensuring(markReady))

          const cfg = yield* config.get()
          const sh = Shell.preferred(cfg.shell)
          const args = Shell.args(sh, input.command, cwd)
          let output = ""
          let aborted = false

          const finish = Effect.uninterruptible(
            Effect.gen(function* () {
              if (aborted) {
                output += "\n\n" + ["<metadata>", "User aborted the command", "</metadata>"].join("\n")
              }
              const completed = Date.now()
              if (!msg.time.completed) {
                msg.time.completed = completed
                yield* sessions.updateMessage(msg)
              }
              if (part.state.status === "running") {
                part.state = {
                  status: "completed",
                  time: { ...part.state.time, end: completed },
                  input: part.state.input,
                  title: "",
                  metadata: { output },
                  output,
                }
                yield* sessions.updatePart(part)
              }
            }),
          )

          const exit = yield* restore(
            Effect.gen(function* () {
              const shellEnv = yield* plugin.trigger(
                "shell.env",
                { cwd, sessionID: input.sessionID, callID: part.callID },
                { env: {} },
              )
              const cmd = ChildProcess.make(sh, args, {
                cwd,
                extendEnv: true,
                env: { ...shellEnv.env, TERM: "dumb" },
                stdin: "ignore",
                forceKillAfter: "3 seconds",
              })
              const handle = yield* spawner.spawn(cmd)
              yield* Stream.runForEach(Stream.decodeText(handle.all), (chunk) =>
                Effect.gen(function* () {
                  output += chunk
                  if (part.state.status === "running") {
                    part.state.metadata = { output }
                    yield* sessions.updatePart(part)
                  }
                }),
              )
              yield* handle.exitCode
            }).pipe(Effect.scoped, Effect.orDie),
          ).pipe(Effect.exit)

          if (Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause) && !Cause.hasDies(exit.cause)) {
            aborted = true
          }
          yield* finish

          if (Exit.isFailure(exit) && !aborted && !Cause.hasInterruptsOnly(exit.cause)) {
            return yield* Effect.failCause(exit.cause)
          }

          return { info: msg, parts: [part] }
        }),
      )
    })

    const getModel = Effect.fn("SessionPrompt.getModel")(function* (
      providerID: ProviderV2.ID,
      modelID: ModelV2.ID,
      sessionID: SessionID,
    ) {
      const exit = yield* provider.getModel(providerID, modelID).pipe(Effect.exit)
      if (Exit.isSuccess(exit)) return exit.value
      const err = Cause.squash(exit.cause)
      if (Provider.ModelNotFoundError.isInstance(err)) {
        const hint = err.suggestions?.length ? ` Did you mean: ${err.suggestions.join(", ")}?` : ""
        yield* events.publish(Session.Event.Error, {
          sessionID,
          error: new NamedError.Unknown({
            message: `Model not found: ${err.providerID}/${err.modelID}.${hint}`,
          }).toObject(),
        })
      }
      return yield* Effect.die(err)
    })

    const currentModel = Effect.fnUntraced(function* (sessionID: SessionID) {
      const current = yield* db
        .select({ model: SessionTable.model })
        .from(SessionTable)
        .where(eq(SessionTable.id, sessionID))
        .get()
        .pipe(Effect.orDie)
      if (current?.model) {
        return {
          providerID: ProviderV2.ID.make(current.model.providerID),
          modelID: ModelV2.ID.make(current.model.id),
          ...(current.model.variant && current.model.variant !== "default" ? { variant: current.model.variant } : {}),
        }
      }
      const match = yield* sessions
        .findMessage(sessionID, (m) => m.info.role === "user" && !!m.info.model)
        .pipe(Effect.orDie)
      if (Option.isSome(match) && match.value.info.role === "user") return match.value.info.model
      return yield* provider.defaultModel().pipe(Effect.orDie)
    })

    const createUserMessage = Effect.fn("SessionPrompt.createUserMessage")(function* (input: PromptInput) {
      const agentName = input.agent
      const ag = agentName ? yield* agents.get(agentName) : yield* agents.defaultInfo()
      if (!ag) {
        const available = (yield* agents.list()).filter((a) => !a.hidden).map((a) => a.name)
        const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
        const error = new NamedError.Unknown({ message: `Agent not found: "${agentName}".${hint}` })
        yield* events.publish(Session.Event.Error, { sessionID: input.sessionID, error: error.toObject() })
        throw error
      }

      const model = input.model ?? ag.model ?? (yield* currentModel(input.sessionID))
      const same = ag.model && model.providerID === ag.model.providerID && model.modelID === ag.model.modelID
      const full =
        !input.variant && ag.variant && same
          ? yield* provider
              .getModel(model.providerID, model.modelID)
              .pipe(Effect.catchIf(Provider.ModelNotFoundError.isInstance, () => Effect.succeed(undefined)))
          : undefined
      const variant = input.variant ?? (ag.variant && full?.variants?.[ag.variant] ? ag.variant : undefined)

      const info: SessionV1.User = {
        id: input.messageID ?? MessageID.ascending(),
        role: "user",
        sessionID: input.sessionID,
        time: { created: Date.now() },
        tools: input.tools,
        agent: ag.name,
        model: {
          providerID: model.providerID,
          modelID: model.modelID,
          variant,
        },
        system: input.system,
        format: input.format,
      }

      const current = yield* sessions.get(input.sessionID).pipe(Effect.orDie)
      if (
        current.agent !== info.agent ||
        current.model?.providerID !== info.model.providerID ||
        current.model?.id !== info.model.modelID ||
        (current.model?.variant === "default" ? undefined : current.model?.variant) !== info.model.variant
      ) {
        yield* sessions.setAgentModel({
          sessionID: input.sessionID,
          agent: info.agent,
          model: {
            id: info.model.modelID,
            providerID: info.model.providerID,
            variant: info.model.variant ?? "default",
          },
          time: info.time.created,
        })
      }

      yield* Effect.addFinalizer(() => instruction.clear(info.id))

      type Draft<T> = T extends SessionV1.Part ? Omit<T, "id"> & { id?: string } : never
      const assign = (part: Draft<SessionV1.Part>): SessionV1.Part => ({
        ...part,
        id: part.id ? PartID.make(part.id) : PartID.ascending(),
      })

      const resolvePart: (part: PromptInput["parts"][number]) => Effect.Effect<Draft<SessionV1.Part>[]> = Effect.fn(
        "SessionPrompt.resolveUserPart",
      )(function* (part) {
        if (part.type === "file") {
          if (part.source?.type === "resource") {
            const { clientName, uri } = part.source
            yield* Effect.logInfo("mcp resource", { clientName, uri, mime: part.mime })
            const pieces: Draft<SessionV1.Part>[] = [
              {
                messageID: info.id,
                sessionID: input.sessionID,
                type: "text",
                synthetic: true,
                text: `Reading MCP resource: ${part.filename} (${uri})`,
              },
            ]
            const exit = yield* mcp.readResource(clientName, uri).pipe(Effect.exit)
            if (Exit.isSuccess(exit)) {
              const content = exit.value
              if (!content) throw new Error(`Resource not found: ${clientName}/${uri}`)
              const items = Array.isArray(content.contents) ? content.contents : [content.contents]
              for (const c of items) {
                if (!c || typeof c !== "object") continue
                if ("text" in c && typeof c.text === "string" && c.text) {
                  pieces.push({
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: c.text,
                  })
                } else if ("blob" in c && typeof c.blob === "string" && c.blob) {
                  const mime = "mimeType" in c && typeof c.mimeType === "string" ? c.mimeType : part.mime
                  const filename = "uri" in c && typeof c.uri === "string" ? c.uri : part.filename
                  const size = mcpResourceBase64Size(c.blob)
                  if (!SUPPORTED_MCP_RESOURCE_ATTACHMENT_MIMES.has(mime)) {
                    pieces.push({
                      messageID: info.id,
                      sessionID: input.sessionID,
                      type: "text",
                      synthetic: true,
                      text: `[Binary MCP resource omitted: ${filename ?? uri} (${mime}, ${formatMcpResourceBytes(size)}) is not a supported attachment type]`,
                    })
                    continue
                  }
                  if (size > MAX_MCP_RESOURCE_BLOB_BYTES) {
                    pieces.push({
                      messageID: info.id,
                      sessionID: input.sessionID,
                      type: "text",
                      synthetic: true,
                      text: `[Binary MCP resource omitted: ${filename ?? uri} (${mime}, ${formatMcpResourceBytes(size)}) exceeds ${formatMcpResourceBytes(MAX_MCP_RESOURCE_BLOB_BYTES)}]`,
                    })
                    continue
                  }
                  pieces.push({
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `[Binary MCP resource attached: ${filename ?? uri} (${mime})]`,
                  })
                  pieces.push({
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "file",
                    mime,
                    filename,
                    url: `data:${mime};base64,${c.blob}`,
                  })
                }
              }
            } else {
              const error = Cause.squash(exit.cause)
              yield* Effect.logError("failed to read MCP resource", { error, clientName, uri })
              const message = error instanceof Error ? error.message : String(error)
              pieces.push({
                messageID: info.id,
                sessionID: input.sessionID,
                type: "text",
                synthetic: true,
                text: `Failed to read MCP resource ${part.filename}: ${message}`,
              })
            }
            return pieces
          }
          const url = new URL(part.url)
          switch (url.protocol) {
            case "data:":
              if (part.mime === "text/plain") {
                return [
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `Called the Read tool with the following input: ${JSON.stringify({ filePath: part.filename })}`,
                  },
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: decodeDataUrl(part.url),
                  },
                  { ...part, messageID: info.id, sessionID: input.sessionID },
                ]
              }
              break
            case "file:": {
              yield* Effect.logInfo("file", { mime: part.mime })
              const filepath = fileURLToPath(part.url)
              const mime = (yield* fsys.isDir(filepath)) ? "application/x-directory" : part.mime

              const { read } = yield* registry.named()
              const execRead = (args: Parameters<typeof read.execute>[0], extra?: Tool.Context["extra"]) => {
                const controller = new AbortController()
                return read
                  .execute(args, {
                    sessionID: input.sessionID,
                    abort: controller.signal,
                    agent: input.agent!,
                    messageID: info.id,
                    extra: { bypassCwdCheck: true, ...extra },
                    messages: [],
                    metadata: () => Effect.void,
                    ask: () => Effect.void,
                  })
                  .pipe(Effect.onInterrupt(() => Effect.sync(() => controller.abort())))
              }

              if (mime === "text/plain") {
                let offset: number | undefined
                let limit: number | undefined
                const range = { start: url.searchParams.get("start"), end: url.searchParams.get("end") }
                if (range.start != null) {
                  const filePathURI = part.url.split("?")[0]
                  let start = parseInt(range.start)
                  let end = range.end ? parseInt(range.end) : undefined
                  if (start === end) {
                    const symbols = yield* lsp.documentSymbol(filePathURI).pipe(Effect.catch(() => Effect.succeed([])))
                    for (const symbol of symbols) {
                      let r: LSP.Range | undefined
                      if ("range" in symbol) r = symbol.range
                      else if ("location" in symbol) r = symbol.location.range
                      if (r?.start?.line && r?.start?.line === start) {
                        start = r.start.line
                        end = r?.end?.line ?? start
                        break
                      }
                    }
                  }
                  offset = Math.max(start, 1)
                  if (end) limit = end - (offset - 1)
                }
                const args = { filePath: filepath, offset, limit }
                const pieces: Draft<SessionV1.Part>[] = [
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `Called the Read tool with the following input: ${JSON.stringify(args)}`,
                  },
                ]
                const exit = yield* provider.getModel(info.model.providerID, info.model.modelID).pipe(
                  Effect.flatMap((mdl) => execRead(args, { model: mdl })),
                  Effect.exit,
                )
                if (Exit.isSuccess(exit)) {
                  const result = exit.value
                  pieces.push({
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: result.output,
                  })
                  if (result.attachments?.length) {
                    pieces.push(
                      ...result.attachments.map((a) => ({
                        ...a,
                        synthetic: true,
                        filename: a.filename ?? part.filename,
                        messageID: info.id,
                        sessionID: input.sessionID,
                      })),
                    )
                  } else {
                    pieces.push({ ...part, mime, messageID: info.id, sessionID: input.sessionID })
                  }
                } else {
                  const error = Cause.squash(exit.cause)
                  yield* Effect.logError("failed to read file", { error, filepath })
                  const message = error instanceof Error ? error.message : String(error)
                  yield* events.publish(Session.Event.Error, {
                    sessionID: input.sessionID,
                    error: new NamedError.Unknown({ message }).toObject(),
                  })
                  pieces.push({
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `Read tool failed to read ${filepath} with the following error: ${message}`,
                  })
                }
                return pieces
              }

              if (mime === "application/x-directory") {
                const args = { filePath: filepath }
                const exit = yield* execRead(args).pipe(Effect.exit)
                if (Exit.isFailure(exit)) {
                  const error = Cause.squash(exit.cause)
                  yield* Effect.logError("failed to read directory", { error, filepath })
                  const message = error instanceof Error ? error.message : String(error)
                  yield* events.publish(Session.Event.Error, {
                    sessionID: input.sessionID,
                    error: new NamedError.Unknown({ message }).toObject(),
                  })
                  return [
                    {
                      messageID: info.id,
                      sessionID: input.sessionID,
                      type: "text",
                      synthetic: true,
                      text: `Read tool failed to read ${filepath} with the following error: ${message}`,
                    },
                  ]
                }
                return [
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `Called the Read tool with the following input: ${JSON.stringify(args)}`,
                  },
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: exit.value.output,
                  },
                  { ...part, mime, messageID: info.id, sessionID: input.sessionID },
                ]
              }

              return [
                {
                  messageID: info.id,
                  sessionID: input.sessionID,
                  type: "text",
                  synthetic: true,
                  text: `Called the Read tool with the following input: {"filePath":"${filepath}"}`,
                },
                {
                  id: part.id,
                  messageID: info.id,
                  sessionID: input.sessionID,
                  type: "file",
                  url:
                    `data:${mime};base64,` +
                    Buffer.from(yield* fsys.readFile(filepath).pipe(Effect.catch(Effect.die))).toString("base64"),
                  mime,
                  filename: part.filename!,
                  source: part.source,
                },
              ]
            }
          }
        }

        if (part.type === "agent") {
          const perm = Permission.evaluate("task", part.name, ag.permission)
          const hint = perm.action === "deny" ? " . Invoked by user; guaranteed to exist." : ""
          return [
            { ...part, messageID: info.id, sessionID: input.sessionID },
            {
              messageID: info.id,
              sessionID: input.sessionID,
              type: "text",
              synthetic: true,
              text:
                " Use the above message and context to generate a prompt and call the task tool with subagent: " +
                part.name +
                hint,
            },
          ]
        }

        return [{ ...part, messageID: info.id, sessionID: input.sessionID }]
      })

      const resolvedParts = yield* Effect.forEach(input.parts, resolvePart, { concurrency: "unbounded" }).pipe(
        Effect.map((x) => x.flat().map(assign)),
      )

      yield* plugin.trigger(
        "chat.message",
        {
          sessionID: input.sessionID,
          agent: input.agent,
          model: input.model,
          messageID: input.messageID,
          variant: input.variant,
        },
        { message: info, parts: resolvedParts },
      )

      const parts = yield* Effect.forEach(resolvedParts, (part) =>
        part.type === "file" && part.mime.startsWith("image/")
          ? image.normalize(part).pipe(
              Effect.catchIf(
                (error) => error instanceof Image.ResizerUnavailableError,
                () => Effect.succeed(part),
              ),
            )
          : Effect.succeed(part),
      )

      const parsed = decodeMessageInfo(info, { errors: "all", propertyOrder: "original" })
      if (Exit.isFailure(parsed)) {
        yield* Effect.logError("invalid user message before save", {
          sessionID: input.sessionID,
          messageID: info.id,
          agent: info.agent,
          model: info.model,
          cause: Cause.pretty(parsed.cause),
        })
      }
      for (const [index, part] of parts.entries()) {
        const p = decodeMessagePart(part, { errors: "all", propertyOrder: "original" })
        if (Exit.isSuccess(p)) continue
        yield* Effect.logError("invalid user part before save", {
          sessionID: input.sessionID,
          messageID: info.id,
          partID: part.id,
          partType: part.type,
          index,
          cause: Cause.pretty(p.cause),
          part,
        })
      }

      yield* sessions.updateMessage(info)
      for (const part of parts) yield* sessions.updatePart(part)

      return { info, parts }
    }, Effect.scoped)

    const prompt: (input: PromptInput) => Effect.Effect<SessionV1.WithParts, Image.Error> = Effect.fn(
      "SessionPrompt.prompt",
    )(function* (input: PromptInput) {
      const session = yield* sessions.get(input.sessionID).pipe(Effect.orDie)
      yield* revert.cleanup(session)
      const message = yield* createUserMessage(input)
      yield* sessions.touch(input.sessionID)

      const permissions: PermissionV1.Rule[] = []
      for (const [t, enabled] of Object.entries(input.tools ?? {})) {
        permissions.push({ permission: t, action: enabled ? "allow" : "deny", pattern: "*" })
      }
      if (permissions.length > 0) {
        session.permission = permissions
        yield* sessions.setPermission({ sessionID: session.id, permission: permissions })
      }

      if (input.noReply === true) return message
      return yield* loop({ sessionID: input.sessionID })
    })

    const lastAssistant = Effect.fnUntraced(function* (sessionID: SessionID) {
      const match = yield* sessions.findMessage(sessionID, (m) => m.info.role !== "user").pipe(Effect.orDie)
      if (Option.isSome(match)) return match.value
      const msgs = yield* sessions.messages({ sessionID, limit: 1 }).pipe(Effect.orDie)
      if (msgs.length > 0) return msgs[0]
      throw new Error("Impossible")
    })

    const runLoop: (sessionID: SessionID) => Effect.Effect<SessionV1.WithParts> = Effect.fn("SessionPrompt.run")(
      function* (sessionID: SessionID) {
        const ctx = yield* InstanceState.context
        let structured: unknown
        let step = 0
        let todoNudges = 0
        let todoNudge: Todo.Info[] | undefined
        let todoDoneDeclared = false
        const session = yield* sessions.get(sessionID).pipe(Effect.orDie)
        const ocxStore = yield* OCXDb.shared.pipe(Effect.catch(() => Effect.succeed(OCXDb.memory())))
        const strongReviewer = flags.ocxStrongReviewer ? Provider.parseModel(flags.ocxStrongReviewer) : undefined
        const strongReviewerModel = strongReviewer
          ? yield* provider
              .getModel(strongReviewer.providerID, strongReviewer.modelID)
              .pipe(Effect.catch(() => Effect.succeed(undefined)))
          : undefined
        let ocxContextSnapshot: SystemContext.Snapshot | undefined

        while (true) {
          yield* status.set(sessionID, { type: "busy" })
          yield* Effect.logInfo("loop", { "session.id": sessionID, step })

          let msgs = yield* MessageV2.filterCompactedEffect(sessionID).pipe(
            Effect.provideService(Database.Service, database),
          )

          const { user: lastUser, assistant: lastAssistant, finished: lastFinished, tasks } = MessageV2.latest(msgs)

          let pipeline: OCXPipeline.Result | undefined
          let ocxSystemCache: { userID: string; phase: string; parts: PromptBlock[] } | undefined
          const ocx = () => ({
            store: ocxStore,
            todoGet: (sid: string) =>
              Effect.map(todo.get(SessionID.make(sid)), (items) =>
                items.map((item) => ({ content: item.content, status: item.status, priority: item.priority })),
              ),
            todoSet: (sid: string, items: ReadonlyArray<{ content: string; status: string; priority: string }>) =>
              todo.update({ sessionID: SessionID.make(sid), todos: [...items] }).pipe(Effect.ignore),
            llm,
            model,
            user: lastUser as SessionV1.User,
            sessionID,
            cwd: ctx.directory,
            contextEnabled: flags.contextEnabled,
            contextAgentRetrieval: flags.contextAgentRetrieval,
            contextFreshnessChecks: flags.contextFreshnessChecks,
            ocxVerifyLadder: flags.ocxVerifyLadder,
            ocxWorkGraph: flags.ocxWorkGraph,
            ocxReviewEnvelope: flags.ocxReviewEnvelope,
            ocxFlakeGate: flags.ocxFlakeGate,
            ocxPractices: flags.ocxPractices,
            ocxPatchSelection: flags.ocxPatchSelection,
            verify: (input: { readonly changed: readonly string[]; readonly cwd: string }) =>
              VerifyLadder.runVerifyLadderEffect({
                ...input,
                exec: (command) =>
                  runVerificationCommand({
                    ...command,
                    sessionID,
                    messageID: msg.id,
                    agent,
                    session,
                    messages: msgs,
                    store: ocxStore,
                  }).pipe(
                    Effect.catch(() =>
                      Effect.succeed({ outcome: "skipped" as const, durationMs: 0 }),
                    ),
                  ),
              }),
            ...(strongReviewerModel ? { reviewerModel: strongReviewerModel } : {}),
            publishActivity: (stage: Stage, active: boolean, summary?: string) =>
              ActivityRuntime.publishStage({ sessionID, stage, active, ...(summary ? { summary } : {}) }, events),
            publishWorkflow: (workflow: {
              workflow: string
              phase: string
              phases: ReadonlyArray<{ readonly id: string; readonly goal: string }>
            }) =>
              events
                .publish(OCXWorkflowEvent.Updated, { sessionID, ...workflow, phases: [...workflow.phases] })
                .pipe(Effect.ignore),
            updatePart: (part: SessionV1.Part) => sessions.updatePart(part as never).pipe(Effect.asVoid),
          })

          if (!lastUser) throw new Error("No user message found in stream. This should never happen.")

          const lastAssistantMsg = msgs.findLast(
            (msg) => msg.info.role === "assistant" && msg.info.id === lastAssistant?.id,
          )
          const hasFinishedAssistant =
            !!lastAssistant?.finish && !["tool-calls", "unknown"].includes(lastAssistant.finish)
          const hasNeedsInput =
            hasFinishedAssistant &&
            lastUser.id < lastAssistant.id &&
            (lastAssistantMsg?.parts.some((part) => part.type === "text" && declaresNeedsInput(part.text)) ?? false)
          if (hasNeedsInput) {
            yield* Effect.logInfo("exiting loop after needs_input", { "session.id": sessionID })
            break
          }
          const hasToolCalls =
            lastAssistantMsg?.parts.some(
              (part) => part.type === "tool" && !part.metadata?.providerExecuted && !isOrphanedInterruptedTool(part),
            ) ?? false

          if (
            lastAssistant?.finish &&
            !["tool-calls"].includes(lastAssistant.finish) &&
            !hasToolCalls &&
            lastUser.id < lastAssistant.id
          ) {
            const open = (yield* todo
              .get(sessionID)
              .pipe(Effect.catch(() => Effect.succeed([] as Todo.Info[])))).filter(
              (item) => item.status === "pending" || item.status === "in_progress",
            )
            const doneDeclared = lastAssistantMsg
              ? lastAssistantMsg.parts.some((part) => part.type === "text" && declaresDone(part.text))
              : false
            if (
              open.length > 0 &&
              todoNudges < MAX_TODO_NUDGES &&
              !doneDeclared &&
              !(lastAssistantMsg && "error" in lastAssistantMsg.info && lastAssistantMsg.info.error != null)
            ) {
              todoNudges++
              todoNudge = open
              todoDoneDeclared = doneDeclared
            } else {
              if (doneDeclared && open.length > 0) {
                const allTodos = yield* todo
                  .get(sessionID)
                  .pipe(Effect.catch(() => Effect.succeed([] as Todo.Info[])))
                yield* todo
                  .update({
                    sessionID,
                    todos: allTodos.map((item) =>
                      item.status === "pending" || item.status === "in_progress"
                        ? { ...item, status: "completed" as const }
                        : item,
                    ),
                  })
                  .pipe(Effect.ignore)
              }
              const orphan = lastAssistantMsg?.parts.find(
                (part): part is SessionV1.ToolPart => part.type === "tool" && isOrphanedInterruptedTool(part),
              )
              if (orphan) {
                yield* Effect.logWarning("loop exit with orphaned interrupted tool", {
                  "session.id": sessionID,
                  messageID: lastAssistant.id,
                  tool: orphan.tool,
                  callID: orphan.callID,
                })
              }
              yield* Effect.logInfo("exiting loop", { "session.id": sessionID })
              break
            }
          }

          step++
          if (step === 1)
            yield* title({
              session,
              modelID: lastUser.model.modelID,
              providerID: lastUser.model.providerID,
              history: msgs,
            }).pipe(Effect.ignore, Effect.forkIn(scope))

          const model = yield* getModel(lastUser.model.providerID, lastUser.model.modelID, sessionID)

          if (flags.ocxPipeline)
            pipeline = yield* Frame.begin(ocx(), msgs, lastUser.id).pipe(
              Effect.catchCause(() => Effect.succeed(undefined)),
            )

          const task = tasks.pop()

          if (task?.type === "subtask") {
            yield* handleSubtask({ task, model, lastUser, sessionID, session, msgs })
            continue
          }

          if (task?.type === "compaction") {
            const result = yield* compaction.process({
              messages: msgs,
              parentID: lastUser.id,
              sessionID,
              auto: task.auto,
              overflow: task.overflow,
            })
            if (result === "stop") break
            continue
          }

          if (
            lastFinished &&
            lastFinished.summary !== true &&
            (yield* compaction.isOverflow({ tokens: lastFinished.tokens, model }))
          ) {
            yield* compaction.create({ sessionID, agent: lastUser.agent, model: lastUser.model, auto: true })
            continue
          }

          const agent = yield* agents.get(lastUser.agent)
          if (!agent) {
            const available = (yield* agents.list()).filter((a) => !a.hidden).map((a) => a.name)
            const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
            const error = new NamedError.Unknown({ message: `Agent not found: "${lastUser.agent}".${hint}` })
            yield* events.publish(Session.Event.Error, { sessionID, error: error.toObject() })
            throw error
          }
          const activePass = PlaybookQueue.activePass(sessionID)
          const activePassContext =
            activePass && (activePass.stage === "post_implementation" || activePass.stage === "verification")
              ? PlaybookRunner.nextPassContext(sessionID)
              : undefined
          const activeTopic = activePassContext
            ? `Playbook Pass ${activePassContext.order}/${activePassContext.total} · ${activePassContext.displayName}`
            : undefined
          const topic = activeTopic ?? pipeline?.topic
          const maxSteps = agent.steps ?? Infinity
          const isLastStep = step >= maxSteps
          const wasPlan = msgs.some((message) => message.info.role === "assistant" && message.info.agent === "plan")
          const reminderKey = `${State.turnKey(sessionID, lastUser.id)}:${agent.name}:${wasPlan ? "after-plan" : "current"}`
          if (!State.isReminderInjected(reminderKey)) {
            msgs = yield* SessionReminders.apply({ messages: msgs, agent, session }).pipe(
              Effect.provideService(RuntimeFlags.Service, flags),
              Effect.provideService(FSUtil.Service, fsys),
              Effect.provideService(Session.Service, sessions),
            )
            State.markReminderInjected(reminderKey)
          }
          const msg: SessionV1.Assistant = {
            id: MessageID.ascending(),
            parentID: lastUser.id,
            role: "assistant",
            mode: agent.name,
            agent: agent.name,
            variant: lastUser.model.variant,
            path: { cwd: ctx.directory, root: ctx.worktree },
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            modelID: model.id,
            providerID: model.providerID,
            time: { created: Date.now() },
            sessionID,
          }
          yield* sessions.updateMessage(msg)

          const settlePlaybook = Effect.fnUntraced(function* (
            outcome: "completed" | "failed" | "skipped" | "cancelled",
            reason?: string,
          ) {
            const active = PlaybookQueue.activePass(sessionID)
            if (!active) return
            PlaybookQueue.completePass(sessionID, active.passID, outcome, reason)
            PlaybookRunner.persist({ store: ocxStore, sessionID })
            yield* ActivityRuntime.publishStage({ sessionID, stage: "thinking", active: false }, events)
          })

          const finalizeInterruptedAssistant = Effect.gen(function* () {
            if (!msg.time.completed) {
              msg.error ??= MessageV2.fromError(new DOMException("Aborted", "AbortError"), {
                providerID: msg.providerID,
                aborted: true,
              })
              msg.time.completed = Date.now()
              yield* sessions.updateMessage(msg)
            }
            yield* settlePlaybook("cancelled", "assistant processing interrupted")
          })

          const created = yield* Effect.exit(
            processor
              .create({
                assistantMessage: msg,
                sessionID,
                model,
                topic,
                ...(flags.ocxPipeline ? { request: OCXPipeline.promptText(msgs) ?? undefined } : {}),
              })
              .pipe(Effect.onInterrupt(() => finalizeInterruptedAssistant)),
          )
          if (Exit.isFailure(created)) {
            yield* settlePlaybook(
              Cause.hasInterruptsOnly(created.cause) ? "cancelled" : "failed",
              Cause.pretty(created.cause),
            )
            return yield* Effect.failCause(created.cause)
          }
          const handle = created.value

          const outcome: "break" | "continue" = yield* Effect.gen(function* () {
            const lastUserMsg = msgs.findLast((m) => m.info.role === "user")
            const bypassAgentCheck = lastUserMsg?.parts.some((p) => p.type === "agent") ?? false
            const promptOps = yield* ops()
            const mutationContext = MutationGuard.fromMessages(msgs)
            if (!mutationContext.workflow && pipeline?.workflow.name)
              MutationGuard.recordWorkflow(mutationContext, pipeline.workflow.name)
            const workflow =
              flags.ocxPipeline && pipeline
                ? WorkflowV2.Gate.current({ sessionID })
                : undefined
            const currentWorkflow = workflow
              ? () => WorkflowV2.Gate.current({ sessionID })
              : undefined

            const tools = yield* SessionTools.resolve({
              agent,
              session,
              model,
              processor: handle,
              bypassAgentCheck,
              messages: msgs,
              promptOps,
              mutationContext,
              planStore: ocxStore,
              ...(workflow ? { workflow } : {}),
              ...(currentWorkflow ? { currentWorkflow } : {}),
              publishWorkflow: (wf: any) =>
                events
                  .publish(OCXWorkflowEvent.Updated, { sessionID, ...wf, phases: [...(wf?.phases ?? [])] })
                  .pipe(Effect.ignore),
            }).pipe(
              Effect.provideService(Plugin.Service, plugin),
              Effect.provideService(Permission.Service, permission),
              Effect.provideService(ToolRegistry.Service, registry),
              Effect.provideService(MCP.Service, mcp),
              Effect.provideService(Truncate.Service, truncate),
              Effect.provideService(RuntimeFlags.Service, flags),
            )

            if (flags.ocxPipeline && pipeline)
              Gate.apply(Frame.headerOpen(ocx(), lastUser.id) && step < 4, step, tools, {
                workflow: (currentWorkflow?.() as any)?.workflow ?? (workflow as any)?.workflow ?? mutationContext.workflow,
                phase: (currentWorkflow?.() as any)?.phase ?? (workflow as any)?.phase,
                phases: (currentWorkflow?.() as any)?.phases ?? (workflow as any)?.phases,
                messages: msgs,
                planAccepted: ocxStore.get(sessionID)?.plan !== undefined,
              })

            if (lastUser.format?.type === "json_schema") {
              tools["StructuredOutput"] = createStructuredOutputTool({
                schema: lastUser.format.schema,
                onSuccess(output) {
                  structured = output
                },
              })
            }
            PromptTools.install({
              tools,
              sessionID,
                messages: msgs,
                workflow: pipeline?.workflow.name,
                operation: OperationClassifier.classifyRequest(OCXPipeline.promptText(msgs) ?? ""),
                pipelineEnabled: flags.ocxPipeline,
              practicesEnabled: flags.ocxPractices,
              turnDone: Frame.isDone(ocx()),
              workdir: ctx.directory,
              store: ocxStore,
            })
            const headerTool = Frame.isDone(ocx())
              ? undefined
              : HeaderTool.ifOpen(
                  ocx(),
                  lastUser.id,
                  pipeline?.workflow.name,
                  pipeline?.workflow.phases ?? [],
                  mutationContext,
                  ocx().store,
                )
            if (headerTool) tools["ocx_header"] = headerTool

            if (step === 1)
              yield* summary.summarize({ sessionID, messageID: lastUser.id }).pipe(Effect.ignore, Effect.forkIn(scope))

            yield* plugin.trigger("experimental.chat.messages.transform", {}, { messages: msgs })

            const userPromptText = (lastUserMsg?.parts ?? [])
              .filter((p): p is Extract<SessionV1.Part, { type: "text" }> => p.type === "text")
              .map((p) => p.text)
              .join("\n")

            const attentionCoord = AttentionCoordinator.coordinate({
              messages: msgs,
              userQuery: userPromptText,
              globalObjective: userPromptText,
            })

            const [skills, env, instructions, mcpInstructions, modelMsgs] = yield* Effect.all([
              sys.skills(agent),
              sys.environment({ model, variant: lastUser.model.variant, sessionID }),
              instruction.system().pipe(Effect.orDie),
              sys.mcp(agent, session.permission),
              MessageV2.toModelMessagesEffect(msgs, model, { attentionMask: attentionCoord.attentionMask }),
            ])
            const systemBlocks: PromptBlock[] = [
              ...env.map((content, index) => promptBlock("core", content, `environment:${index}`, "never")),
              ...instructions.map((content, index) =>
                promptBlock("hard_constraint", content, `instructions:${index}`, "never"),
              ),
              ...(mcpInstructions ? [promptBlock("optional_knowledge", mcpInstructions, "mcp-instructions")] : []),
              ...(skills ? [promptBlock("optional_knowledge", skills, "skills")] : []),
            ]
            if (attentionCoord.dualFocusAnchor) {
              systemBlocks.push(promptBlock("hard_constraint", attentionCoord.dualFocusAnchor, "dual-focus-anchor", "never"))
            }
            if (attentionCoord.segments.length > 0) {
              systemBlocks.push(promptBlock("core", attentionCoord.segmentDirectory, "attention-segment-directory", "never"))
            }
            if (pipeline && (ocxSystemCache?.userID !== lastUser.id || ocxSystemCache.phase !== pipeline.workflow.phase)) {
              ocxSystemCache = {
                userID: lastUser.id,
                phase: pipeline.workflow.phase,
                parts: [
                  ...OCXPipeline.directiveBlocks(pipeline, {
                    includeBodies: false,
                    includeCatalog: pipeline.workflow.phase === "plan",
                  }),
                ],
              }
            }
            if (ocxSystemCache) systemBlocks.push(...ocxSystemCache.parts)
            if (flags.ocxPipeline) {
              const steerResult = WorkflowV2.Lanes.steerWithPrompt(sessionID, userPromptText, model.id)
              const agentTuning = WorkflowV2.Tuning.tuneSessionAgent({
                modelId: model.id,
                sessionID,
                lane: steerResult.lane.risk,
              })
              const capabilityBlock = WorkflowV2.Gate.renderPromptContext({
                sessionID,
                lane: steerResult.lane.kind,
                risk: steerResult.lane.risk,
                pipelineId: steerResult.analysis.pipelineId,
                analysis: steerResult.analysis,
                tuning: agentTuning,
              })
              if (capabilityBlock)
                systemBlocks.push(promptBlock("hard_constraint", capabilityBlock, "workflow-agentic", "never"))
            }
            if (pipeline) {
              const context = yield* OCXSystemContext.render({
                store: ocxStore,
                sessionID,
                repositoryID: ctx.worktree,
                ...(ocxContextSnapshot ? { snapshot: ocxContextSnapshot } : {}),
              }).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
              if (context) {
                ocxContextSnapshot = context.snapshot
                if (context.text) systemBlocks.push(promptBlock("context", context.text, "context-system"))
              }
            }
            const { deltas, feedback } = flags.ocxPipeline
              ? yield* BeforeStep.run(ocx(), msgs, lastUser.id).pipe(
                  Effect.catchCause(() => Effect.succeed({ deltas: [] as string[], feedback: undefined })),
                )
              : { deltas: [] as string[], feedback: undefined }
            systemBlocks.push(
              ...deltas.map((content, index) =>
                content.includes("=== OCX AUDIT PASS") || content.includes("=== OCX PLAYBOOK PASS")
                  ? promptBlock("playbook", content, `playbook-pass:${index}`, "bounded")
                  : promptBlock("current_step", content, `before-step:${index}`),
              ),
            )
            const format = lastUser.format ?? { type: "text" as const }
            if (format.type === "json_schema")
              systemBlocks.push(
                promptBlock("hard_constraint", STRUCTURED_OUTPUT_SYSTEM_PROMPT, "structured-output", "never"),
              )
            if (flags.ocxPipeline) {
              const hasFailure =
                feedback !== undefined || deltas.some((d) => d.includes("failure") || d.includes("Recovery"))
              const workflowPhase = (currentWorkflow?.() as any)?.phase ?? pipeline?.workflow.phase
              const profile = hasFailure
                ? "recovery"
                : workflowPhase === "verify" || workflowPhase === "fullcheck"
                  ? "deep"
                  : "normal"
              const control = ReasoningControl.build({ profile, hasFailure, workflowPhase })
              if (control && !systemBlocks.some((block) => block.content.includes("OCX REASONING CONTROL")))
                systemBlocks.push(promptBlock("reasoning_control", control, "reasoning-control", "never"))
            }
            let system = systemBlocks.map((block) => block.content)
            if (flags.ocxPipeline) {
              const governor = new PromptGovernor(8000)
              const governed = governor.govern(systemBlocks)
              system = governed.admitted.map((block) => block.content)
            }
            const nudge = todoNudge
            const nudgeDone = todoDoneDeclared
            todoNudge = undefined
            todoDoneDeclared = false
            const gateFeedback = feedback
            const processed = yield* Effect.exit(
              handle.process({
                user: lastUser,
                agent,
                permission: session.permission,
                sessionID,
                parentSessionID: session.parentID,
                system,
                messages: [
                  ...modelMsgs,
                  ...(isLastStep ? [{ role: "assistant" as const, content: MAX_STEPS_PROMPT }] : []),
                  ...(nudge ? [{ role: "user" as const, content: todoNudgeText(nudge, nudgeDone) }] : []),
                  ...(gateFeedback ? [{ role: "user" as const, content: gateFeedback }] : []),
                ],
                tools,
                ...(workflow ? { workflow } : {}),
                ...(currentWorkflow ? { currentWorkflow } : {}),
                workflowStore: ocxStore,
                publishWorkflow: (state) =>
                  events
                    .publish(OCXWorkflowEvent.Updated, {
                      sessionID,
                      workflow: state.workflow,
                      phase: state.phase,
                      phases: [...state.phases],
                      ...(state.variant ? { variant: state.variant } : {}),
                      ...(state.objective ? { objective: state.objective } : {}),
                      ...(state.status ? { status: state.status } : {}),
                      ...(state.revision !== undefined ? { revision: state.revision } : {}),
                      ...(state.intentRevision !== undefined ? { intentRevision: state.intentRevision } : {}),
                    })
                    .pipe(Effect.ignore),
                model,
                toolChoice: format.type === "json_schema" ? "required" : undefined,
              }),
            )
            if (Exit.isFailure(processed)) {
              yield* settlePlaybook(
                Cause.hasInterruptsOnly(processed.cause) ? "cancelled" : "failed",
                Cause.pretty(processed.cause),
              )
              return yield* Effect.failCause(processed.cause)
            }
            const result = processed.value
            if (handle.message.error) yield* settlePlaybook("failed", JSON.stringify(handle.message.error))

            const finished = handle.message.finish && !["tool-calls", "unknown"].includes(handle.message.finish)
            let passFailed = false
            if (finished) {
              const responseParts = yield* MessageV2.parts(handle.message.id).pipe(
                Effect.provideService(Database.Service, database),
              )
              passFailed = responseParts.some((part) => part.type === "tool" && part.state.status === "error")
              if (!flags.ocxPipeline) {
                if (responseParts.some((part) => part.type === "text" && declaresNeedsInput(part.text))) {
                  yield* Effect.logInfo("exiting loop after needs_input", { "session.id": sessionID })
                  yield* settlePlaybook("skipped", "assistant requested user input")
                  return "break" as const
                }
                if (responseParts.some((part) => part.type === "text" && declaresDone(part.text))) {
                  yield* Effect.logInfo("exiting loop after declares_done", { "session.id": sessionID })
                  yield* settlePlaybook(passFailed ? "failed" : "completed")
                  return "break" as const
                }
              }
            }

            if (structured !== undefined) {
              handle.message.structured = structured
              handle.message.finish = handle.message.finish ?? "stop"
              yield* sessions.updateMessage(handle.message)
              yield* settlePlaybook(
                passFailed ? "failed" : "completed",
                passFailed ? "a pass-owned tool failed" : undefined,
              )
              return "break" as const
            }

            if (finished && !handle.message.error) {
              if (handle.message.finish === "content-filter") {
                handle.message.error = new SessionV1.ContentFilterError({
                  message: "The response was blocked by the provider's content filter",
                }).toObject()
                yield* sessions.updateMessage(handle.message)
                yield* events.publish(Session.Event.Error, { sessionID, error: handle.message.error })
                yield* settlePlaybook("failed", "provider content filter rejected the response")
                return "break" as const
              }
              if (format.type === "json_schema") {
                handle.message.error = new SessionV1.StructuredOutputError({
                  message: "Model did not produce structured output",
                  retries: 0,
                }).toObject()
                yield* sessions.updateMessage(handle.message)
                yield* settlePlaybook("failed", "structured output was not produced")
                return "break" as const
              }

              if (flags.ocxPipeline) {
                yield* settlePlaybook(
                  passFailed ? "failed" : "completed",
                  passFailed ? "a pass-owned tool failed" : undefined,
                )
                msgs = yield* MessageV2.filterCompactedEffect(sessionID).pipe(
                  Effect.provideService(Database.Service, database),
                )
                const gate = yield* Claim.run(ocx(), msgs, lastUser.id)
                if (gate.continueTurn) return "continue" as const
                const refreshed = MessageV2.latest(msgs)
                if (refreshed.user && refreshed.user.id !== lastUser.id) return "continue" as const
              }
              const finishedParts = yield* MessageV2.parts(handle.message.id).pipe(
                Effect.provideService(Database.Service, database),
              )
              if (finishedParts.some((part) => part.type === "tool")) return "continue" as const
              return "break" as const
            }

            if (result === "stop") {
              if (!handle.message.error)
                yield* settlePlaybook("failed", "assistant processing stopped before a terminal pass result")
              return "break" as const
            }
            if (result === "compact") {
              yield* compaction.create({
                sessionID,
                agent: lastUser.agent,
                model: lastUser.model,
                auto: true,
                overflow: !handle.message.finish,
              })
            }
            return "continue" as const
          }).pipe(
            Effect.ensuring(instruction.clear(handle.message.id)),
            Effect.onInterrupt(() => finalizeInterruptedAssistant),
          )
          if (outcome === "break") break
          continue
        }

        yield* compaction.prune({ sessionID }).pipe(Effect.ignore, Effect.forkIn(scope))
        return yield* lastAssistant(sessionID)
      },
    )

    const loop: (input: LoopInput) => Effect.Effect<SessionV1.WithParts> = Effect.fn("SessionPrompt.loop")(function* (
      input: LoopInput,
    ) {
      return yield* state.ensureRunning(
        input.sessionID,
        lastAssistant(input.sessionID),
        runLoop(input.sessionID).pipe(Effect.ensuring(Effect.sync(() => State.clearTransient(input.sessionID)))),
      )
    })

    const shell: (input: ShellInput) => Effect.Effect<SessionV1.WithParts, Session.BusyError> = Effect.fn(
      "SessionPrompt.shell",
    )(function* (input: ShellInput) {
      const ready = yield* Latch.make()
      return yield* state.startShell(input.sessionID, lastAssistant(input.sessionID), shellImpl(input, ready), ready)
    })

    const command = Effect.fn("SessionPrompt.command")(function* (input: CommandInput) {
      yield* Effect.logInfo("command", {
        "session.id": input.sessionID,
        command: input.command,
        agent: input.agent,
      })
      const cmd = yield* commands.get(input.command)
      if (!cmd) {
        const available = (yield* commands.list()).map((c) => c.name)
        const hint = available.length ? ` Available commands: ${available.join(", ")}` : ""
        const error = new NamedError.Unknown({ message: `Command not found: "${input.command}".${hint}` })
        yield* events.publish(Session.Event.Error, { sessionID: input.sessionID, error: error.toObject() })
        throw error
      }
      const agentName = cmd.agent ?? input.agent

      const raw = input.arguments.match(argsRegex) ?? []
      const args = raw.map((arg) => arg.replace(quoteTrimRegex, ""))
      const templateCommand = yield* Effect.promise(async () => cmd.template)

      const placeholders = templateCommand.match(placeholderRegex) ?? []
      let last = 0
      for (const item of placeholders) {
        const value = Number(item.slice(1))
        if (value > last) last = value
      }

      const withArgs = templateCommand.replaceAll(placeholderRegex, (_, index) => {
        const position = Number(index)
        const argIndex = position - 1
        if (argIndex >= args.length) return ""
        if (position === last) return args.slice(argIndex).join(" ")
        return args[argIndex]
      })
      const usesArgumentsPlaceholder = templateCommand.includes("$ARGUMENTS")
      let template = withArgs.replaceAll("$ARGUMENTS", input.arguments)

      if (placeholders.length === 0 && !usesArgumentsPlaceholder && input.arguments.trim()) {
        template = template + "\n\n" + input.arguments
      }

      const shellMatches = ConfigMarkdown.shell(template)
      if (shellMatches.length > 0) {
        const ctx = yield* InstanceState.context
        for (const [, command] of shellMatches)
          yield* guardShell({
            sessionID: input.sessionID,
            cwd: ctx.directory,
            command,
            applyRepositoryPolicy: flags.ocxPipeline,
          })
        const cfg = yield* config.get()
        const sh = Shell.preferred(cfg.shell)
        const results = yield* Effect.promise(() =>
          Promise.all(
            shellMatches.map(async ([, cmd]) => (await Process.text([cmd], { shell: sh, nothrow: true })).text),
          ),
        )
        let index = 0
        template = template.replace(bashRegex, () => results[index++])
      }
      template = template.trim()

      const taskModel = yield* Effect.gen(function* () {
        if (cmd.model) return Provider.parseModel(cmd.model)
        if (cmd.agent) {
          const cmdAgent = yield* agents.get(cmd.agent)
          if (cmdAgent?.model) return cmdAgent.model
        }
        if (input.model) return Provider.parseModel(input.model)
        return yield* currentModel(input.sessionID)
      })

      yield* getModel(taskModel.providerID, taskModel.modelID, input.sessionID)

      const agent = agentName ? yield* agents.get(agentName) : yield* agents.defaultInfo()
      if (!agent) {
        const available = (yield* agents.list()).filter((a) => !a.hidden).map((a) => a.name)
        const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
        const error = new NamedError.Unknown({ message: `Agent not found: "${agentName}".${hint}` })
        yield* events.publish(Session.Event.Error, { sessionID: input.sessionID, error: error.toObject() })
        throw error
      }

      const templateParts = yield* resolvePromptParts(template)
      const inputFiles = new Set(
        input.parts?.filter((part) => new URL(part.url).protocol === "file:").map((part) => fileURLToPath(part.url)),
      )
      const uniqueTemplateParts = templateParts.filter(
        (part) => part.type !== "file" || !inputFiles.has(fileURLToPath(part.url)),
      )
      const isSubtask = (agent.mode === "subagent" && cmd.subtask !== false) || cmd.subtask === true
      const parts = isSubtask
        ? [
            {
              type: "subtask" as const,
              agent: agent.name,
              description: cmd.description ?? "",
              command: input.command,
              model: { providerID: taskModel.providerID, modelID: taskModel.modelID },
              prompt: templateParts.find((y) => y.type === "text")?.text ?? "",
            },
          ]
        : [...uniqueTemplateParts, ...(input.parts ?? [])]

      const userAgent = isSubtask ? (input.agent ?? (yield* agents.defaultInfo()).name) : agent.name
      const userModel = isSubtask
        ? input.model
          ? Provider.parseModel(input.model)
          : yield* currentModel(input.sessionID)
        : taskModel

      yield* plugin.trigger(
        "command.execute.before",
        { command: input.command, sessionID: input.sessionID, arguments: input.arguments },
        { parts },
      )

      const result = yield* prompt({
        sessionID: input.sessionID,
        messageID: input.messageID,
        model: userModel,
        agent: userAgent,
        parts,
        variant: input.variant,
      })
      yield* events.publish(Command.Event.Executed, {
        name: input.command,
        sessionID: input.sessionID,
        arguments: input.arguments,
        messageID: result.info.id,
      })
      return result
    })

    return Service.of({
      cancel,
      prompt,
      loop,
      shell,
      command,
      resolvePromptParts,
    })
  }),
)

const ModelRef = Schema.Struct({
  providerID: ProviderV2.ID,
  modelID: ModelV2.ID,
})

export const PromptInput = Schema.Struct({
  sessionID: SessionID,
  messageID: Schema.optional(MessageID),
  model: Schema.optional(ModelRef),
  agent: Schema.optional(Schema.String),
  noReply: Schema.optional(Schema.Boolean),
  tools: Schema.optional(Schema.Record(Schema.String, Schema.Boolean)).annotate({
    description:
      "@deprecated tools and permissions have been merged, you can set permissions on the session itself now",
  }),
  format: Schema.optional(SessionV1.Format),
  system: Schema.optional(Schema.String),
  variant: Schema.optional(Schema.String),
  parts: Schema.Array(
    Schema.Union([
      SessionV1.TextPartInput,
      SessionV1.FilePartInput,
      SessionV1.AgentPartInput,
      SessionV1.SubtaskPartInput,
    ]).annotate({ discriminator: "type" }),
  ),
})
export type PromptInput = Schema.Schema.Type<typeof PromptInput>

export class LoopInput extends Schema.Class<LoopInput>("SessionPrompt.LoopInput")({
  sessionID: SessionID,
}) {}

export const ShellInput = Schema.Struct({
  sessionID: SessionID,
  messageID: Schema.optional(MessageID),
  agent: Schema.String,
  model: Schema.optional(ModelRef),
  command: Schema.String,
})
export type ShellInput = Schema.Schema.Type<typeof ShellInput>

export const CommandInput = Schema.Struct({
  messageID: Schema.optional(MessageID),
  sessionID: SessionID,
  agent: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  arguments: Schema.String,
  command: Schema.String,
  variant: Schema.optional(Schema.String),
  parts: Schema.optional(
    Schema.Array(
      Schema.Union([
        Schema.Struct({
          id: Schema.optional(PartID),
          type: Schema.Literal("file"),
          mime: Schema.String,
          filename: Schema.optional(Schema.String),
          url: Schema.String,
          source: Schema.optional(SessionV1.FilePartSource),
        }),
      ]).annotate({ discriminator: "type" }),
    ),
  ),
})
export type CommandInput = Schema.Schema.Type<typeof CommandInput>

export function createStructuredOutputTool(input: {
  schema: Record<string, any>
  onSuccess: (output: unknown) => void
}): AITool {
  const { $schema: _, ...toolSchema } = input.schema

  return tool({
    description: STRUCTURED_OUTPUT_DESCRIPTION,
    inputSchema: jsonSchema(toolSchema as JSONSchema7),
    async execute(args) {
      input.onSuccess(args)
      return {
        output: "Structured output captured successfully.",
        title: "Structured Output",
        metadata: { valid: true },
      }
    },
    toModelOutput({ output }) {
      return {
        type: "text",
        value: output.output,
      }
    },
  })
}
const bashRegex = /!`([^`]+)`/g
const argsRegex = /(?:\[Image\s+\d+\]|"[^"]*"|'[^']*'|[^\s"']+)/gi
const placeholderRegex = /\$(\d+)/g
const quoteTrimRegex = /^["']|["']$/g

export const node = LayerNode.make({
  service: Service,
  layer: layer,
  deps: [
    SessionStatus.node,
    Session.node,
    Agent.node,
    Provider.node,
    SessionProcessor.node,
    SessionCompaction.node,
    Plugin.node,
    Command.node,
    Config.node,
    Permission.node,
    FSUtil.node,
    MCP.node,
    LSP.node,
    ToolRegistry.node,
    Truncate.node,
    Image.node,
    CrossSpawnSpawner.node,
    Instruction.node,
    SessionRunState.node,
    SessionRevert.node,
    SessionSummary.node,
    SystemPrompt.node,
    LLM.node,
    EventV2Bridge.node,
    RuntimeFlags.node,
    Database.node,
    Todo.node,
  ],
})

export * as SessionPrompt from "./prompt"
