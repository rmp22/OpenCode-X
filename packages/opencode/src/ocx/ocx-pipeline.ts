import { Effect } from "effect"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import { Strategy, type StrategyName } from "@/ocx/strategy"
import { Workflow } from "@/ocx/workflow"
import { OCXDb } from "@/ocx/ocx-db"
import { SemanticBridge } from "@/ocx/semantic-bridge"
import type { TodoItem, TodoStore } from "@/ocx/todo/agent"
import { Requirements } from "./requirements"
import { WorkflowV2 } from "./workflow-v2"
import type { InjectorSource, PromptBlock } from "./prompt-governor"
import { OperationClassifier } from "./operation-classifier"
import { IntentRevision } from "./intent-revision"
import { formatCapabilityOrientation } from "./orientation"

export type Deps = {
  readonly store: OCXDb.Store
  readonly todo: Pick<TodoStore, "get">
}

export type RunInput = {
  readonly sessionID: string
  readonly prompt: string
}

export type WorkflowState = {
  readonly name: string
  readonly variant?: string
  readonly phase: string
  readonly phases: readonly Workflow.Phase[]
  readonly objective?: string
  readonly status?: Workflow.WorkflowStatus
  readonly revision?: number
  readonly intentRevision?: number
  readonly operation?: Workflow.Operation
  readonly workstream?: readonly Workflow.Workstream[]
  readonly reminder?: string
}

export type Result = {
  readonly changed: boolean
  readonly polished: string
  readonly orientation?: string
  readonly strategies: Strategy.StrategyName[]
  readonly stack?: string
  readonly workflow: WorkflowState
  readonly notice: string | undefined
  readonly topic?: string
  readonly todos?: readonly TodoItem[]
  readonly requirements?: readonly Requirements.Record[]
  readonly proposal?: OCXDb.WorkflowProposal
}

function isContinuation(prompt: string): boolean {
  return /^(continue|resume|keep going|carry on|finish|next step|update the todo|mark the todo)/i.test(prompt.trim())
}

function stateFromStored(stored: OCXDb.State | undefined): Workflow.WorkflowState | undefined {
  if (!stored?.workflow || !stored.phase) return undefined
  const workflow = Workflow.canonicalID(stored.workflow)
  if (!workflow) return undefined
  return Workflow.workflowState(workflow, stored.phase, {
    ...(stored.variant ? { variant: stored.variant } : {}),
    ...(stored.objective ? { objective: stored.objective } : {}),
    ...(stored.status ? { status: stored.status } : {}),
    ...(stored.revision !== undefined ? { revision: stored.revision } : {}),
  })
}

function stateFromProposal(proposal: OCXDb.WorkflowProposal | undefined): Workflow.WorkflowState | undefined {
  if (!proposal?.previousWorkflow || !proposal.previousPhase) return undefined
  const workflow = Workflow.canonicalID(proposal.previousWorkflow)
  if (!workflow) return undefined
  return Workflow.workflowState(workflow, proposal.previousPhase, {
    ...(proposal.previousVariant ? { variant: proposal.previousVariant } : {}),
    ...(proposal.previousObjective ? { objective: proposal.previousObjective } : {}),
  })
}

function parseApproval(prompt: string): { kind: "APPROVE" | "DENY" | "NONE" } {
  const text = prompt.trim().toLowerCase()
  if (
    ["yes", "approve", "confirm", "proceed", "accept", "ok", "y"].includes(text) ||
    /^(?:yes|approve|confirm|proceed|accept|ok|y)\b/i.test(text) ||
    /\b(?:approve|approved)\b/i.test(text)
  ) {
    return { kind: "APPROVE" }
  }
  if (
    ["no", "deny", "reject", "cancel", "abort", "n"].includes(text) ||
    /^(?:no|deny|reject|cancel|abort|n)\b/i.test(text)
  ) {
    return { kind: "DENY" }
  }
  return { kind: "NONE" }
}

export const run = Effect.fn("OCXPipeline.run")(function* (deps: Deps, input: RunInput) {
  const prompt = input.prompt.trim()
  const stored = yield* Effect.try({
    try: () => deps.store.get(input.sessionID),
    catch: (error) => error,
  }).pipe(Effect.catch(() => Effect.succeed(undefined)))
  const storedProposal = yield* Effect.try({
    try: () => deps.store.getWorkflowProposal(input.sessionID),
    catch: (error) => error,
  }).pipe(Effect.catch(() => Effect.succeed(undefined)))
  const proposalDecision = storedProposal ? parseApproval(prompt) : { kind: "NONE" as const }

  return yield* Effect.gen(function* () {
    const storedTodos = yield* deps.todo.get(input.sessionID).pipe(Effect.catch(() => Effect.succeed([] as TodoItem[])))
    const isShort = prompt.split(/\s+/).length < 3
    if (!stored && !storedProposal && isShort) {
      return {
        changed: false,
        polished: input.prompt,
        orientation: formatCapabilityOrientation({ workflow: "coding", phase: "plan" }),
        strategies: [],
        workflow: {
          name: "coding",
          phase: "plan",
          phases: Workflow.preset("coding").phases,
          status: "active",
          revision: 0,
          intentRevision: 0,
        },
        notice: undefined,
      } as Result
    }
    const semantic = yield* SemanticBridge.analyzePrompt(prompt)
    const continuation = isContinuation(prompt)
    const requirements = Requirements.merge(continuation ? stored?.requirements ?? [] : [], Requirements.fromText(prompt))
    const stack = semantic.stack ?? (continuation ? stored?.stack : undefined)
    const canonicalStored = stored?.workflow ? Workflow.canonicalID(stored.workflow) : undefined
    const currentState = stateFromStored(stored) ?? stateFromProposal(storedProposal)
    const proposedWorkflow = storedProposal ? Workflow.canonicalID(storedProposal.workflow) : undefined
    const proposedTarget = proposedWorkflow
      ? {
          workflow: proposedWorkflow,
          ...(storedProposal?.variant ? { variant: storedProposal.variant as Workflow.WorkflowVariant } : {}),
          ...(storedProposal?.phase ? { phase: storedProposal.phase } : {}),
        }
      : undefined
    const isApprovedProposal = Boolean(storedProposal && proposalDecision.kind === "APPROVE" && proposedTarget)
    const isDeniedProposal = Boolean(storedProposal && proposalDecision.kind === "DENY")
    const routed =
      isApprovedProposal && proposedTarget
        ? {
            kind: "SWITCH" as const,
            state: Workflow.workflowState(
              proposedTarget.workflow,
              proposedTarget.phase ?? Workflow.get(proposedTarget.workflow)?.phases[0]?.id ?? "frame",
              {
                ...(proposedTarget.variant ? { variant: proposedTarget.variant } : {}),
                objective: prompt || currentState?.objective || "answer the request",
              },
            ),
            reason: "proposal approved",
          }
        : isDeniedProposal
          ? {
              kind: "STAY" as const,
              state: currentState ?? Workflow.workflowState("research", "frame", { objective: prompt || "answer the request" }),
              reason: "workflow proposal was denied; the current workflow remains unchanged",
            }
          : {
              kind: "SWITCH" as const,
              state: currentState && continuation
                ? currentState
                : Workflow.workflowState(
                    semantic.workflow ?? currentState?.workflow ?? "coding",
                    currentState && continuation
                      ? currentState.phase
                      : (semantic.workflow ?? currentState?.workflow ?? "coding") === "research" && OperationClassifier.classifyRequest(prompt)?.surface === "research"
                        ? "gather"
                        : Workflow.get(semantic.workflow ?? currentState?.workflow ?? "coding")?.phases[0]?.id ?? "plan",
                    {
                      ...(semantic.variant ? { variant: semantic.variant } : currentState?.variant ? { variant: currentState.variant } : {}),
                      objective: prompt || currentState?.objective || "answer the request",
                    },
                  ),
              reason: "semantic transition",
            }
    const automaticProposal =
      !storedProposal &&
      !isApprovedProposal &&
      !isDeniedProposal &&
      currentState &&
      routed.state.workflow !== currentState.workflow
        ? {
            workflow: routed.state.workflow,
            ...(routed.state.variant ? { variant: routed.state.variant } : {}),
            phase: routed.state.phase,
            objective: prompt,
            reason: `The request selects the ${routed.state.workflow} workflow instead of the active ${currentState.workflow} workflow.`,
            previousWorkflow: currentState.workflow,
            previousVariant: currentState.variant,
            previousPhase: currentState.phase,
            previousObjective: currentState.objective,
          }
        : undefined
    if (automaticProposal)
      yield* Effect.try({
        try: () => deps.store.setWorkflowProposal(input.sessionID, automaticProposal),
        catch: (error) => error,
      }).pipe(Effect.ignore)
    const proposal = storedProposal ?? automaticProposal
    const isPendingProposal = Boolean(proposal && !isApprovedProposal && !isDeniedProposal)
    const route = isPendingProposal
      ? {
          kind: "STAY" as const,
          state: currentState ?? routed.state,
          reason: "workflow proposal is awaiting an explicit approval or denial",
        }
      : routed
    if (isDeniedProposal)
      yield* Effect.try({
        try: () => deps.store.clearWorkflowProposal(input.sessionID),
        catch: (error) => error,
      }).pipe(Effect.ignore)
    const selected = route.state
    const definition = Workflow.get(selected.workflow)
    if (!definition) throw new Error(`workflow preset is not available: ${selected.workflow}`)
    const sameWorkflow = currentState?.workflow === definition.name || canonicalStored === definition.name
    const intentRevision =
      isApprovedProposal
        ? (stored?.intentRevision ?? 0) + 1
        : !stored || (!continuation && IntentRevision.isMaterialChange(stored.objective ?? "", prompt))
        ? (stored?.intentRevision ?? 0) + 1
        : stored.intentRevision ?? 0
    const requestOperation = OperationClassifier.classifyRequest(prompt)
    const effectiveWorkflowName = definition.name
    const effectivePhaseName =
      continuation && sameWorkflow && !isApprovedProposal ? canonicalPhase(definition.name, stored?.phase) ?? selected.phase : selected.phase
    const workflow: WorkflowState = {
      name: effectiveWorkflowName,
      ...(selected.variant ? { variant: selected.variant } : {}),
      phase: effectivePhaseName,
      phases: definition.phases,
      objective: isApprovedProposal ? storedProposal?.objective ?? storedProposal?.reason ?? selected.objective : selected.objective,
      status: selected.status,
      revision: selected.revision,
      intentRevision,
      ...(requestOperation ? { operation: requestOperation } : {}),
      ...(sameWorkflow && continuation && stored?.workstream ? { workstream: stored.workstream } : {}),
    }
    const strategies = Strategy.resolveStrategies({
      workflow: workflow.name,
      variant: workflow.variant,
      operation: requestOperation,
      stack,
      baseStrategies: semantic.strategies,
    })
    if (isApprovedProposal) {
      yield* Effect.try({
        try: () => {
          deps.store.set(input.sessionID, {
            workflow: workflow.name,
            phase: workflow.phase,
            phases: workflow.phases,
            ...(workflow.variant ? { variant: workflow.variant } : {}),
            ...(workflow.objective ? { objective: workflow.objective } : {}),
            status: "active",
            revision: workflow.revision,
            intentRevision,
            done: false,
            requirements: [],
          })
          deps.store.clearWorkflowProposal(input.sessionID)
        },
        catch: (error) => error,
      }).pipe(Effect.ignore)
    } else if (!isPendingProposal && !isDeniedProposal && (
      !stored ||
      !continuation ||
      stored.phase !== workflow.phase ||
      stored.workflow !== workflow.name ||
      stored.variant !== workflow.variant ||
      stored.stack !== stack ||
      JSON.stringify(stored.requirements ?? []) !== JSON.stringify(requirements)
    ))
      yield* Effect.try({
        try: () => {
          const carryExecutionState = stored && continuation && sameWorkflow ? stored : undefined
          deps.store.set(input.sessionID, {
            ...(carryExecutionState ?? {}),
            workflow: workflow.name,
            phase: workflow.phase,
            phases: workflow.phases,
            ...(workflow.variant ? { variant: workflow.variant } : {}),
            ...(workflow.objective ? { objective: workflow.objective } : {}),
            status: workflow.status,
            revision: workflow.revision,
            intentRevision,
            ...(continuation ? {} : { done: false }),
            ...(workflow.workstream ? { workstream: workflow.workstream } : {}),
            ...(stack ? { stack } : {}),
            requirements,
          })
        },
        catch: (error) => error,
      }).pipe(Effect.ignore)
    const result: Result = {
      changed: isApprovedProposal,
      polished: input.prompt,
      orientation: formatCapabilityOrientation({
        workflow: workflow.name,
        phase: workflow.phase,
        owner: workflow.name,
        verification: ["run the selected acceptance checks before terminal completion"],
        recovery: ["preserve failed or unresolved work instead of claiming done"],
        constraints: ["tool and path gates remain authoritative"],
      }),
      strategies,
      ...(stack ? { stack } : {}),
      workflow,
      ...(isPendingProposal && proposal ? { proposal } : {}),
      notice: isPendingProposal ? `Workflow proposal pending approval: ${proposal?.workflow}.` : undefined,
      ...(storedTodos.length > 0 ? { todos: storedTodos } : {}),
      ...(requirements.length > 0 ? { requirements } : {}),
    }
    return result
  })
})

export function directiveBlocks(
  result: Result,
  opts: { includeBodies?: boolean; includeCatalog?: boolean } = {},
): PromptBlock[] {
  const includeBodies = opts.includeBodies === true
  const includeCatalog = opts.includeCatalog === true
  const blocks: PromptBlock[] = []
  const add = (source: InjectorSource, content: string, id: string, trimPolicy?: PromptBlock["trimPolicy"]) => {
    if (!content.trim()) return
    blocks.push({
      id,
      source,
      content,
      tokens: Math.ceil(content.length / 4),
      ...(trimPolicy ? { trimPolicy } : {}),
    })
  }
  if (includeBodies) {
    const docs = result.strategies
      .map((name) => ({ name, content: Strategy.load(name)?.trim() }))
      .filter((doc) => doc.content !== undefined)
    if (docs.length > 0)
      add(
        "playbook",
        ["=== OCX SELECTED STRATEGIES ===", ...docs.map((doc) => [`--- ${doc.name} ---`, doc.content].join("\n"))].join("\n\n"),
        "strategies:bodies",
        "bounded",
      )
  } else if (includeCatalog && result.strategies.length > 0) {
    add(
      "playbook",
      `Selected playbooks: ${result.strategies.join(", ")}. Bodies are injected only when the active pass requires them.`,
      "strategies:catalog",
    )
  }
  const workflowBlock = Workflow.render(
    {
      ...Workflow.fromPhases(result.workflow.name, result.workflow.phases),
      ...(result.workflow.variant ? { variant: result.workflow.variant } : {}),
    },
    result.workflow.phase,
    result.workflow.reminder,
    result.workflow.workstream,
    result.workflow.operation,
  )
  add("workflow", workflowBlock, "workflow")
  const capabilityBlock = WorkflowV2.Gate.renderPromptContext(result.workflow)
  if (capabilityBlock) add("hard_constraint", capabilityBlock, "workflow:capabilities", "never")
  add("workflow", result.orientation ?? formatCapabilityOrientation({ workflow: result.workflow.name, phase: result.workflow.phase }), "orientation", "bounded")
  if (result.todos && result.todos.length > 0) {
    add(
      "current_step",
      [
        "=== OCX TODO STATE ===",
        ...result.todos.map(
          (item) =>
            `[${item.status === "completed" ? "\u2713" : item.status === "in_progress" ? "\u2022" : " "}] ${item.content}`,
        ),
      ].join("\n"),
      "todo",
    )
  }
  const requirements = result.requirements ? Requirements.render(result.requirements) : ""
  if (requirements) add("hard_constraint", requirements, "requirements", "never")
  if (result.notice) add("recovery", ["=== OCX GUARD NOTE ===", result.notice].join("\n"), "notice")
  return blocks
}

function canonicalPhase(workflow: string, requested: string | undefined): string | undefined {
  if (!requested) return undefined
  const phases = Workflow.preset(workflow as Workflow.WorkflowId).phases
  const normalized = requested.trim().toLocaleLowerCase().replaceAll("_", "-")
  const direct = phases.find((phase) => phase.id === normalized)
  if (direct) return direct.id
  const aliases: Readonly<Record<string, readonly string[]>> = {
    act: ["build", "edit", "implement", "implementation", "change"],
    audit: ["review"],
    discover: ["explore", "inspect"],
    understand: ["context"],
    validate: ["check", "test", "verify"],
  }
  return phases.find((phase) => aliases[phase.family]?.includes(normalized))?.id
}

export function directives(result: Result, opts: { includeBodies?: boolean } = {}): string[] {
  return directiveBlocks(result, opts).map((block) => block.content)
}

export function applyToMessages(messages: readonly SessionV1.WithParts[], result: Result): void {
  if (!result.changed) return
  const userMessage = messages.findLast((msg) => msg.info.role === "user")
  if (!userMessage) return
  const part = userMessage.parts.findLast((candidate) => candidate.type === "text" && !candidate.synthetic)
  if (part?.type === "text") part.text = result.polished
}

export function promptText(messages: readonly SessionV1.WithParts[]): string | undefined {
  const userMessage = messages.findLast(
    (msg) =>
      msg.info.role === "user" && msg.parts.some((candidate) => candidate.type === "text" && !candidate.synthetic),
  )
  const part = userMessage?.parts.findLast((candidate) => candidate.type === "text" && !candidate.synthetic)
  return part?.type === "text" ? part.text : undefined
}

export * as OCXPipeline from "./ocx-pipeline"
