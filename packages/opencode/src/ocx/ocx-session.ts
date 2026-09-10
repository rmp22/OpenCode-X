import { tool, jsonSchema, type Tool as AITool } from "ai"
import type { JSONSchema7 } from "@ai-sdk/provider"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import type { OCXDb } from "./ocx-db"
import { WorkflowPhaseProfile } from "./workflow-phase-profile"
import { PlanWorkstreamState } from "./plan-workstream-state"
import { TaskModel } from "./task-model"
import type { Operation } from "./workflow"

type Snapshot = {
  readonly id: string
  readonly role: string
  readonly created: number
  readonly finish?: string
  readonly parts: readonly {
    readonly type: string
    readonly text?: string
    readonly tool?: string
    readonly status?: string
    readonly outputLength?: number
  }[]
}

const MAX_TEXT = 240
const MAX_MESSAGES = 20

function text(value: string): string {
  const clean = value.replace(/\s+/g, " ").trim()
  return clean.length > MAX_TEXT ? `${clean.slice(0, MAX_TEXT - 3)}...` : clean
}

export function snapshot(messages: readonly SessionV1.WithParts[], limit = MAX_MESSAGES): Snapshot[] {
  return messages.slice(-Math.min(MAX_MESSAGES, Math.max(1, limit))).map((message) => ({
    id: message.info.id,
    role: message.info.role,
    created: message.info.time.created,
    ...("finish" in message.info && message.info.finish ? { finish: message.info.finish } : {}),
    parts: message.parts.map((part) => {
      if (part.type === "text" || part.type === "reasoning") return { type: part.type, text: text(part.text) }
      if (part.type === "tool") {
        const output = part.state.status === "completed" ? part.state.output : undefined
        return {
          type: part.type,
          tool: part.tool,
          status: part.state.status,
          ...(output !== undefined ? { outputLength: output.length } : {}),
        }
      }
      return { type: part.type }
    }),
  }))
}


export function renderSummary(input: {
  readonly sessionID: string
  readonly messageCount: number
  readonly fallbackWorkflow?: string
  readonly state?: OCXDb.State
  readonly operation?: Operation
}): string {
  const workflow = input.state?.workflow ?? input.fallbackWorkflow
  const phase = input.state?.phase
  const phases = input.state?.phases ?? []
  const index = phase ? phases.findIndex((item) => item.id === phase) : -1
  const next = index >= 0 ? phases[index + 1]?.id : undefined
  const phaseProfile = workflow && phase
    ? WorkflowPhaseProfile.profile({
        workflow,
        phase,
        phases,
        epoch: "0",
        toolsetVersion: 1,
      })
    : undefined
  const plan = input.state?.plan
  const ready = plan && !plan.activeStepID ? PlanWorkstreamState.nextReadyStep(plan) : undefined
  const activeWorkstream = plan?.workstreams.find((item) => item.id === plan.activeWorkstreamID)
  const activeStep = activeWorkstream?.steps.find((item) => item.id === plan?.activeStepID)
  const pendingChecks = activeStep?.checks.filter((check) => check.status !== "passed") ?? []
  const task = TaskModel.taskKind(workflow)
  const stage = TaskModel.stageKind(phase)
  const workflowLabel = workflow ? `${workflow}${input.state?.variant ? `[${input.state.variant}]` : ""}` : undefined
  return [
    "SESSION",
    `id=${input.sessionID}`,
    `task=${task}`,
    ...(workflowLabel ? [`workflow=${workflowLabel}`] : []),
    ...(phase ? [`phase=${phase}`, `stage=${stage}:${phase}`] : []),
    ...(input.state?.objective ? [`objective=${text(input.state.objective)}`] : []),
    ...(input.state?.status ? [`status=${input.state.status}`] : []),
    ...(input.state?.revision !== undefined ? [`revision=${input.state.revision}`] : []),
    ...(input.state?.intentRevision !== undefined ? [`intent=${input.state.intentRevision}`] : []),
    ...(input.operation ? [`operation=${input.operation.surface}:${input.operation.action}`] : []),
    ...(next ? [`next=${TaskModel.stageKind(next)}:${next}`] : []),
    ...(phaseProfile ? [`purpose=${phaseProfile.purpose}`, `legal=${phaseProfile.tools.join(",")}`, `blocked=${phaseProfile.blocked.join(";")}`, `action=${phaseProfile.nextAction}`] : []),
    `plan=${plan ? "active" : "none"}`,
    `done=${input.state?.done ? "yes" : "no"}`,
    ...(input.state?.playbookStage?.stage ? [`pb=${input.state.playbookStage.stage}`] : []),
    ...(plan?.activeWorkstreamID ? [`ws=${plan.activeWorkstreamID}`] : []),
    ...(plan?.activeStepID ? [`sp=${plan.activeStepID}`] : []),
    ...(!plan?.activeStepID && ready ? [`ready_ws=${ready.workstreamID}`, `ready_sp=${ready.stepID}`, `ready_action=${ready.step.action}`] : []),
    ...pendingChecks.map((check) => `check=${check.id}:${check.status}:${check.description}`),
    `messages=${input.messageCount}`,
  ].join("\\n")
}

export function create(input: {
  readonly sessionID: string
  readonly messages: readonly SessionV1.WithParts[]
  readonly workflow?: string
  readonly operation?: Operation
  readonly store?: Pick<OCXDb.Store, "get">
}): AITool {
  return tool({
    description: "Inspect the current session without changing it. Use bounded summary or recent message metadata; no other session can be queried.",
    inputSchema: jsonSchema({
      type: "object",
      properties: {
        view: { type: "string", enum: ["summary", "messages"], description: "Return session summary or bounded recent messages" },
        limit: { type: "integer", minimum: 1, maximum: MAX_MESSAGES, description: "Maximum recent messages for the messages view" },
      },
      required: ["view"],
      additionalProperties: false,
    } as JSONSchema7),
    async execute(args) {
      const view = (args as { view?: string }).view
      const messages = snapshot(input.messages, (args as { limit?: number }).limit)
      const output = view === "messages"
        ? { sessionID: input.sessionID, view, messages }
        : renderSummary({
            sessionID: input.sessionID,
            messageCount: input.messages.length,
            fallbackWorkflow: input.workflow,
            state: input.store?.get(input.sessionID),
            ...(input.operation ? { operation: input.operation } : {}),
          })
      return {
        output: typeof output === "string" ? output : JSON.stringify(output),
        title: "Current session",
        metadata: { view, readOnly: true },
      }
    },
    toModelOutput({ output }) {
      return { type: "text", value: output.output }
    },
  })
}

export * as OCXSession from "./ocx-session"
