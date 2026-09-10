import { tool, jsonSchema } from "ai"
import type { Tool as AITool } from "ai"
import type { JSONSchema7 } from "@ai-sdk/provider"
import { Header } from "@/ocx/header"
import { Workflow } from "@/ocx/workflow"
import { MutationGuard } from "@/ocx/mutation-guard"
import { Progress } from "@/ocx/progress"
import { Wrapper } from "@/ocx/tool-input/wrapper"
import { Effect } from "effect"
import type { TurnServices } from "./types"
import * as State from "./state"
import type { OCXDb } from "@/ocx/ocx-db"

const DESCRIPTION = `Record lightweight OCX intake before context inspection. Use one wrapper string with topic=, workflow=, optional reason=, optional phase= hint, repeated playbook=, intent=, and risk= lines. OCX validates the workflow and selects the actual phase; do not try to switch phases through this tool. If your workflow differs from the active workflow, explain why with reason= and wait for explicit user approval. Do not create the detailed plan here; inspect the task and repository first, then use ocx_plan.`

export function ifOpen(
  services: TurnServices,
  userId: string,
  workflowName: string | undefined,
  phases: ReadonlyArray<Workflow.Phase>,
  mutationContext: MutationGuard.Context,
  store?: OCXDb.Store,
): AITool | undefined {
  const key = State.turnKey(services.sessionID, userId)
  return create(
    key,
    workflowName,
    phases,
    mutationContext,
    services.sessionID,
    services.cwd,
    store,
  )
}

function create(
  key: string,
  workflowName: string | undefined,
  phases: ReadonlyArray<Workflow.Phase>,
  mutationContext: MutationGuard.Context,
  sessionID: string,
  workdir: string,
  store?: OCXDb.Store,
): AITool {
  return tool({
      description: DESCRIPTION,
      inputSchema: jsonSchema({
        type: "object",
        properties: {
          wrapper: {
            type: "string",
            description:
              `Key=value lines for intake. Required: topic and workflow. Optional repeated keys: playbook, intent, risk. Optional phase hint (runtime selects the actual phase). Workflow hint: ${workflowName ?? "coding"}. First phase hint: ${phases[0]?.id ?? "the first phase"}.`,
          },
          topic: { type: "string", description: "Task topic (alternative to wrapper)" },
          workflow: { type: "string", description: `Workflow name (hint: ${workflowName ?? "coding"})` },
          reason: { type: "string", description: "Why a different workflow is appropriate (alternative to wrapper)" },
        },
        additionalProperties: false,
      } as JSONSchema7),
    async execute(args) {
      const lines: string[] = []
      if (typeof args.topic === "string" && args.topic.trim()) lines.push(`topic=${args.topic.trim()}`)
      if (typeof args.workflow === "string" && args.workflow.trim()) lines.push(`workflow=${args.workflow.trim()}`)
      if (typeof args.reason === "string" && args.reason.trim()) lines.push(`reason=${args.reason.trim()}`)
      if (typeof args.wrapper === "string" && args.wrapper.trim()) lines.push(args.wrapper.trim())
      for (const [k, v] of Object.entries(args)) {
        if (k === "topic" || k === "workflow" || k === "reason" || k === "wrapper") continue
        if (Array.isArray(v)) lines.push(...v.map((item) => `${k}=${item}`))
        else if (v !== undefined) lines.push(`${k}=${v}`)
      }
      const rawInput = lines.join("\n")
      const parsed = Header.parseHeaderWrapper(rawInput, {
        ...(workflowName ? { storedWorkflow: workflowName, storedPhases: phases } : {}),
      })
      if (!parsed.header)
        return {
          output: Wrapper.formatInputErrors(parsed.errors, "topic=Fix the parser\nworkflow=coding"),
          title: "Invalid OCX intake",
          metadata: { valid: false, errors: parsed.errors.map((error) => error.key) },
        }
      const header = parsed.header
      State.setHeader(key, header)
      MutationGuard.recordHeader(mutationContext, header)
      const current = store?.get(sessionID)
      const currentWorkflow = current?.workflow ?? workflowName
      const requestedWorkflow = header.workflowName ?? workflowName
      const differs = Boolean(
        currentWorkflow &&
          requestedWorkflow &&
          (Workflow.canonicalID(currentWorkflow) ?? currentWorkflow) !== (Workflow.canonicalID(requestedWorkflow) ?? requestedWorkflow),
      )
      if (differs && requestedWorkflow && store) {
        if (current) {
          store.set(sessionID, {
            ...current,
            workflow: requestedWorkflow,
            ...(header.variant ? { variant: header.variant } : {}),
            ...(header.phase ? { phase: header.phase } : {}),
            ...(header.topic ? { objective: header.topic } : {}),
          })
        } else {
          const canonical = Workflow.canonicalID(requestedWorkflow)
          const preset = canonical ? Workflow.preset(canonical) : undefined
          store.set(sessionID, {
            workflow: requestedWorkflow,
            phase: preset?.phases[0]?.id ?? "discover",
            phases: preset?.phases ?? [],
            ...(header.variant ? { variant: header.variant } : {}),
            ...(header.topic ? { objective: header.topic } : {}),
          })
        }
        store.clearWorkflowProposal(sessionID)
      } else {
        store?.clearWorkflowProposal(sessionID)
      }
      MutationGuard.recordWorkflow(mutationContext, requestedWorkflow ?? currentWorkflow)
      const progress = await Effect.runPromise(Progress.seed({ sessionID, workdir, header }))
      return {
        output: `Intake recorded. Workflow active: ${requestedWorkflow ?? currentWorkflow}. Inspect relevant context before creating the execution plan. ${progress.saved ? "Task memory initialized." : `Task memory unavailable: ${progress.error ?? "unknown error"}.`}`,
        title: "OCX intake",
        metadata: {
          valid: true,
          workflow: requestedWorkflow,
          intakeOnly: true,
          progressSaved: progress.saved,
        },
      }
    },
    toModelOutput({ output }) {
      return { type: "text", value: output.output }
    },
  })
}

export * as HeaderTool from "./header-tool"
