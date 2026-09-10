import { tool, jsonSchema, type Tool as AITool } from "ai"
import type { JSONSchema7 } from "@ai-sdk/provider"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import { ContextReadiness } from "./context/readiness"
import { OCXDb } from "./ocx-db"
import { PlanWorkstreamState } from "./plan-workstream-state"
import { Wrapper } from "./tool-input/wrapper"
import { WorkstreamRunner } from "./workstream-runner"
import { TaskModel } from "./task-model"
import { Workflow } from "./workflow"

const DESCRIPTION = `Record or update the execution plan after context inspection. Use one wrapper string with goal=, workstream=, indented goal/target/step/check lines, and optional dependency= lines. Each step needs a concrete action, target, and observable check. Use updateWorkstream= and addStep= for a small replan. Read-only workflows (documentation/research) reject steps that mutate source code: switch to an implementation workflow or restate the change as a documented follow-up.`
const EXAMPLE = [
  "goal=Implement the retry guard",
  "workstream=runtime",
  "  goal=Change the runtime boundary",
  "  target=src/session/prompt.ts",
  "  step=Guard retry admission",
  "    target=src/session/prompt.ts",
  "    check=Focused retry test passes",
].join("\n")

export type Input = {
  readonly sessionID: string
  readonly workdir: string
  readonly messages: readonly SessionV1.WithParts[]
  readonly store: OCXDb.Store
}

function invalid(errors: readonly { key: string; message: string }[]) {
  return {
    output: [
      Wrapper.formatInputErrors(errors, EXAMPLE),
      ...errors.map((error) => `error ${error.key}: ${error.message}`),
      "hint=Each step= line must be nested under its workstream= line with two extra spaces; steps=[...] inline lists are not parsed. Resubmit the corrected wrapper to dry-run validation before any file mutation.",
    ].join("\n"),
    title: "Invalid OCX plan",
    metadata: { valid: false, errors: errors.map((error) => error.key) },
  }
}

export function validatePlanText(planText: string): readonly { key: string; message: string }[] {
  if (!planText.trim()) return [{ key: "wrapper", message: "plan text is empty; provide goal=/workstream=/step=/target=/check= lines" }]
  return PlanWorkstreamState.parseExecutionPlan(planText, { contextReady: true }).errors
}

function planSummary(plan: PlanWorkstreamState.ExecutionPlan) {
  return {
    output: [
      "OK",
      `goal=${plan.goal}`,
      `revision=${plan.revision}`,
      `workstreams=${plan.workstreams.length}`,
      `steps=${plan.workstreams.reduce((total, workstream) => total + workstream.steps.length, 0)}`,
      "Plan accepted. The runtime will provide one ready workstream step at a time.",
    ].join("\n"),
    title: "OCX plan accepted",
    metadata: {
      valid: true,
      revision: plan.revision,
      workstreams: plan.workstreams.length,
      steps: plan.workstreams.reduce((total, workstream) => total + workstream.steps.length, 0),
    },
  }
}

export function createPlanTool(input: Input): AITool {
  return tool({
    description: DESCRIPTION,
    inputSchema: jsonSchema({
      type: "object",
      properties: {
        wrapper: { type: "string", description: "Key=value lines for the execution plan" },
        plan: { type: "string", description: "Execution plan text (alternative to wrapper)" },
      },
      additionalProperties: false,
    } as JSONSchema7),
    async execute(args) {
      const planText =
        typeof args.wrapper === "string" && args.wrapper.trim()
          ? args.wrapper
          : typeof (args as any).plan === "string" && (args as any).plan.trim()
            ? (args as any).plan
            : ""
      const readiness = ContextReadiness.inspect(input.messages, input.workdir)
      if (!readiness.ready)
        return {
          output: ["BLOCK", "reason=context incomplete", `missing=${readiness.gaps.join(",")}`, "next=inspect the missing context before planning"].join("\n"),
          title: "Context required before planning",
          metadata: { valid: false, reason: "context", gaps: [...readiness.gaps], nonBlocking: true },
        }

      const existing = WorkstreamRunner.getPlan({ store: input.store, sessionID: input.sessionID })
      if (existing) {
        const result = WorkstreamRunner.updatePlan({ store: input.store, sessionID: input.sessionID }, planText)
        if (!result.plan) return invalid(result.errors)
        return planSummary(result.plan)
      }

      const parsed = PlanWorkstreamState.parseExecutionPlan(planText, { contextReady: true })
      if (!parsed.plan) return invalid(parsed.errors)
      const current = input.store.get(input.sessionID)
      if (!current) return invalid([{ key: "session", message: "workflow state is unavailable for this session" }])
      const actPhase = current.workflow ? Workflow.actionPhase(current.workflow) : undefined
      const currentStage = TaskModel.stageKind(current.phase, current.workflow)
      const nextPhase = actPhase && (currentStage === "understand" || currentStage === "plan") ? actPhase : current.phase
      input.store.set(input.sessionID, { ...current, phase: nextPhase, plan: parsed.plan })
      return planSummary(parsed.plan)
    },
    toModelOutput({ output }) {
      return { type: "text", value: output.output }
    },
  })
}

export * as PlanTool from "./plan-tool"
