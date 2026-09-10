import { jsonSchema, tool, type Tool as AITool } from "ai"
import type { JSONSchema7 } from "@ai-sdk/provider"
import { Effect } from "effect"
import { Progress } from "./progress"
import { Wrapper } from "./tool-input/wrapper"
import { WorkstreamRunner } from "./workstream-runner"
import type { OCXDb } from "./ocx-db"

const DESCRIPTION = `Record a concise OCX checkpoint or update the active execution step. Use one wrapper string. For plan execution, prefer ws=, sp=, st=started|completed|blocked, ck=, ev=, and optional nx=. st=started activates only the exact next ready step; it never succeeds as a no-op. For task memory, goal= and scope= are optional when an execution plan already provides them. This tool never changes workflow phase.`

function dynamicExample(
  active?: { workstreamID: string; stepID: string; step?: { action?: string; checks?: readonly { description?: string }[] } },
  plan?: { workstreams?: readonly { id: string; steps?: readonly { id: string; action?: string; checks?: readonly { description?: string }[] }[] }[] },
): string {
  const wsID = active?.workstreamID ?? plan?.workstreams?.[0]?.id ?? "runtime"
  const stepID = active?.stepID ?? plan?.workstreams?.[0]?.steps?.[0]?.id ?? "guard-retry-admission"
  const checkDesc =
    active?.step?.checks?.[0]?.description ??
    plan?.workstreams?.[0]?.steps?.[0]?.checks?.[0]?.description ??
    "Focused retry test passes"
  const nextAction =
    active?.step?.action ?? plan?.workstreams?.[0]?.steps?.[0]?.action ?? "Review the diff"
  return [
    `ws=${wsID}`,
    `sp=${stepID}`,
    "st=completed",
    `ck=${checkDesc}`,
    "ev=bun test test/session/prompt.test.ts passed",
    `nx=${nextAction}`,
  ].join("\n")
}

function compactInvalid(
  errors: readonly { key: string; message: string }[],
  active?: { workstreamID: string; stepID: string; step?: { action?: string; checks?: readonly { description?: string }[] } },
  plan?: { workstreams?: readonly { id: string; steps?: readonly { id: string; action?: string; checks?: readonly { description?: string }[] }[] }[] },
) {
  return {
    output: Wrapper.formatInputErrors(errors, dynamicExample(active, plan)),
    title: "Invalid OCX progress",
    metadata: { valid: false, errors: errors.map((error) => error.key) },
  }
}

export function createProgressTool(input: {
  readonly sessionID: string
  readonly workdir: string
  readonly store?: OCXDb.Store
}): AITool {
  return tool({
    description: DESCRIPTION,
    inputSchema: jsonSchema({
      type: "object",
      properties: { wrapper: { type: "string", description: "Key=value lines for the task checkpoint" } },
      required: ["wrapper"],
      additionalProperties: false,
    } as JSONSchema7),
    async execute(args) {
      const document = Wrapper.parseWrapper(args.wrapper)
      const { OCXDb } = await import("./ocx-db")
      const store = input.store ?? (await Effect.runPromise(OCXDb.shared.pipe(Effect.catch(() => Effect.succeed(OCXDb.memory())))))
      const state = store.get(input.sessionID)
      const planInput = { store, sessionID: input.sessionID }
      const plan = state?.plan
      let active = WorkstreamRunner.activeStep(planInput)
      const status = (Wrapper.value(document, "status") ?? "").trim().toLowerCase()
      const checks = Wrapper.values(document, "check")
      const evidence = Wrapper.values(document, "evidence")
      const requestedWorkstream = Wrapper.value(document, "workstream")
      const requestedStep = Wrapper.value(document, "step")
      const norm = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")

      if (["started", "start", "active", "in_progress"].includes(status)) {
        if (!plan)
          return {
            output: "BLOCK\nreason=no execution plan\nnext=record an execution plan before starting a step",
            title: "OCX step cannot start",
            metadata: { valid: false, reason: "plan", nonBlocking: true },
          }
        if (!active) {
          let next = WorkstreamRunner.nextReadyStep(planInput)
          if (requestedWorkstream && (!next || norm(next.workstreamID) !== norm(requestedWorkstream))) {
            const requestedWs = plan.workstreams.find((w) => norm(w.id) === norm(requestedWorkstream))
            const readyInWs = requestedWs?.steps.find((s) => s.status === "ready")
            if (readyInWs && requestedWs) {
              next = { workstreamID: requestedWs.id, stepID: readyInWs.id, step: readyInWs }
            }
          }
          if (!next)
            return {
              output: "BLOCK\nreason=no ready execution step\nnext=resolve the current blocker or complete the preceding step",
              title: "OCX step cannot start",
              metadata: { valid: false, reason: "not-ready", nonBlocking: true },
            }
          const workstreamMatches = !requestedWorkstream || norm(requestedWorkstream) === norm(next.workstreamID)
          const stepMatches =
            !requestedStep ||
            norm(requestedStep) === norm(next.stepID) ||
            norm(next.stepID).startsWith(norm(requestedStep)) ||
            norm(requestedStep).startsWith(norm(next.stepID)) ||
            norm(requestedStep) === norm(next.step.action) ||
            norm(next.step.action).startsWith(norm(requestedStep))
          if (!workstreamMatches || !stepMatches)
            return {
              output: [
                "BLOCK",
                "reason=requested step is not the next ready step",
                `ready=${next.workstreamID}/${next.stepID}`,
                `action=${next.step.action}`,
                "next=start the ready step exactly",
              ].join("\n"),
              title: "OCX step order mismatch",
              metadata: { valid: false, reason: "step-order", readyWorkstream: next.workstreamID, readyStep: next.stepID, nonBlocking: true },
            }
          WorkstreamRunner.activateStep(planInput, next.workstreamID, next.stepID)
          active = WorkstreamRunner.activeStep(planInput)
        } else {
          const workstreamMatches = !requestedWorkstream || norm(requestedWorkstream) === norm(active.workstreamID)
          const stepMatches =
            !requestedStep ||
            norm(requestedStep) === norm(active.stepID) ||
            norm(active.stepID).startsWith(norm(requestedStep)) ||
            norm(requestedStep).startsWith(norm(active.stepID)) ||
            norm(requestedStep) === norm(active.step.action) ||
            norm(active.step.action).startsWith(norm(requestedStep))
          if (!workstreamMatches || !stepMatches)
            return {
              output: [
                "BLOCK",
                "reason=another execution step is already active",
                `active=${active.workstreamID}/${active.stepID}`,
                "next=finish or block the active step before starting another",
              ].join("\n"),
              title: "OCX step already active",
              metadata: { valid: false, reason: "active-step", nonBlocking: true },
            }
        }
      }

      const changesStepState =
        evidence.length > 0 || ["blocked", "completed", "complete", "passed", "done"].includes(status)
      if (changesStepState && plan && !active) {
        const next = WorkstreamRunner.nextReadyStep(planInput)
        if (next) {
          const workstreamMatches = !requestedWorkstream || norm(requestedWorkstream) === norm(next.workstreamID)
          const stepMatches =
            !requestedStep ||
            norm(requestedStep) === norm(next.stepID) ||
            norm(next.stepID).startsWith(norm(requestedStep)) ||
            norm(requestedStep).startsWith(norm(next.stepID)) ||
            norm(requestedStep) === norm(next.step.action) ||
            norm(next.step.action).startsWith(norm(requestedStep))
          if (workstreamMatches && stepMatches) {
            WorkstreamRunner.activateStep(planInput, next.workstreamID, next.stepID)
            active = WorkstreamRunner.activeStep(planInput)
          }
        }
        if (!active)
          return {
            output: "BLOCK\nreason=no active execution step\nnext=start the next ready step before recording step evidence or completion",
            title: "OCX step is not active",
            metadata: { valid: false, reason: "no-active-step", nonBlocking: true },
          }
      }
      if (changesStepState && active && !WorkstreamRunner.matchesActiveStep(planInput, requestedWorkstream, requestedStep))
        return {
          output: [
            "BLOCK",
            "reason=progress update does not identify the active execution step",
            `active=${active.workstreamID}/${active.stepID}`,
            "next=record progress only for the active workstream and step",
          ].join("\n"),
          title: "OCX progress step mismatch",
          metadata: { valid: false, reason: "step-identity", activeWorkstream: active.workstreamID, activeStep: active.stepID, nonBlocking: true },
        }

      if (active && evidence.length > 0) {
        const checkTargets = checks.length > 0 ? checks : active.step.checks.map((c) => c.id)
        for (let index = 0; index < checkTargets.length; index++) {
          const checkName = checkTargets[index]!
          const proof = evidence[index] ?? evidence[0]!
          WorkstreamRunner.recordVerifiedEvidence(planInput, {
            check: checkName,
            status: "passed",
            evidence: proof,
            source: "verification",
          })
        }
      }

      if (active && status === "blocked") {
        const reason = Wrapper.value(document, "blocker") ?? evidence[0] ?? "active execution step is blocked"
        WorkstreamRunner.blockStep(planInput, reason)
      }

      if (active && ["completed", "complete", "passed", "done"].includes(status)) {
        const completion = WorkstreamRunner.completeActiveStep(planInput)
        if (!completion.completed)
          return {
            output: ["BLOCK", "reason=step checks incomplete", `missing=${completion.missing.join("|")}`, "next=record evidence for the missing checks"].join("\n"),
            title: "OCX step still needs evidence",
            metadata: { valid: false, reason: "evidence", missing: [...completion.missing] },
          }
      }

      const refreshedPlan = store.get(input.sessionID)?.plan
      const nextReady = refreshedPlan ? WorkstreamRunner.nextReadyStep(planInput) : undefined
      const currentActive = WorkstreamRunner.activeStep(planInput)
      const objective = Wrapper.value(document, "goal") ?? refreshedPlan?.goal
      const scope = Wrapper.value(document, "scope") ?? refreshedPlan?.scope ?? input.workdir
      const nextAction =
        Wrapper.value(document, "next") ??
        currentActive?.step.action ??
        nextReady?.step.action ??
        (refreshedPlan ? "Continue the execution plan." : undefined)
      const nextCheck =
        Wrapper.value(document, "check") ??
        currentActive?.step.checks.find((check) => check.status !== "passed")?.description ??
        nextReady?.step.checks[0]?.description ??
        (refreshedPlan ? "Record the next source-backed verification result." : undefined)

      const missing = [
        ...(objective ? [] : [{ key: "goal", message: "goal is required when no execution plan exists" }]),
        ...(nextAction ? [] : [{ key: "next", message: "next action is required when no execution plan exists" }]),
        ...(nextCheck ? [] : [{ key: "check", message: "next check is required when no execution plan exists" }]),
      ]
      if (missing.length > 0) return compactInvalid(missing, active, plan)

      const phase = state?.phase ?? "context"
      const requestedPhase = Wrapper.value(document, "phase")
      const parseResult = Progress.parseDetailed({
        objective,
        scope,
        phase,
        completed: Wrapper.values(document, "completed"),
        evidence,
        corrections: Wrapper.values(document, "correction"),
        blocker: Wrapper.value(document, "blocker"),
        nextAction,
        nextCheck,
      })
      if (!parseResult.success)
        return compactInvalid(parseResult.errors, active, plan)
      const update = parseResult.value

      const result = await Effect.runPromise(Progress.write({ ...update, sessionID: input.sessionID, workdir: input.workdir }))
      if (!result.saved)
        return {
          output: `ERR progress\nreason=${result.error ?? "unknown checkpoint error"}`,
          title: "OCX progress error",
          metadata: { valid: false },
        }

      const completedStep = active && ["completed", "complete", "passed", "done"].includes(status)
      return {
        output: [
          "OK",
          `st=${completedStep ? "completed" : status || "saved"}`,
          `ph=${phase}`,
          ...(requestedPhase && requestedPhase !== phase ? [`phase_ignored=${requestedPhase}`] : []),
          ...(currentActive ? [`ws=${currentActive.workstreamID}`, `sp=${currentActive.stepID}`] : []),
          `nx=${update.nextAction}`,
        ].join("\n"),
        title: "OCX progress saved",
        metadata: { valid: true, stepCompleted: Boolean(completedStep) },
      }
    },
    toModelOutput({ output }) {
      return { type: "text", value: output.output }
    },
  })
}

export * as ProgressTool from "./progress-tool"
