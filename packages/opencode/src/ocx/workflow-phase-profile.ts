import { Workflow, type PhaseFamily } from "./workflow"
import { TaskModel, type TaskKind } from "./task-model"
import type { Capability, Effect, WorkflowContext } from "./workflow-gate/types"

export type PhaseProfile = {
  readonly kind: PhaseFamily | "other"
  readonly task: TaskKind
  readonly purpose: string
  readonly tools: readonly string[]
  readonly related: readonly string[]
  readonly blocked: readonly string[]
  readonly nextAction: string
  readonly playbookNote?: string
}

export type PhaseDirectives = {
  readonly mode: string
  readonly allowed: string
  readonly forbidden: string
  readonly whenToWrite: string
  readonly howToAdvance: string
}

export function phaseDirectives(kind: PhaseProfile["kind"], phaseName: string): PhaseDirectives {
  void phaseName
  if (kind === "understand")
    return {
      mode: "OCX_DISCOVER [Read-Only Context Exploration]",
      allowed: "Read, search, and inspect files (read, glob, grep), explore dependencies and environment, clarify requirements with question. Batch all context reads in one turn.",
      forbidden: "DO NOT create, write, or edit files or directories yet. DO NOT execute shell writes or file mutations.",
      whenToWrite: "DO NOT create or edit files/directories in OCX_DISCOVER. File and directory creation begins in OCX_EXECUTE after a plan is accepted.",
      howToAdvance: "Collect all needed context in one turn, check requirements, then use ocx_plan to record your execution plan and advance to OCX_EXECUTE.",
    }
  if (kind === "plan")
    return {
      mode: "OCX_PLAN [Plan & Workstream Design]",
      allowed: "Author execution plan with ocx_plan (workstreams, target paths, verifiable checks) and initialize tasks with todowrite.",
      forbidden: "DO NOT create or edit files or directories yet. Planning precedes code changes.",
      whenToWrite: "DO NOT create or edit files/directories yet. File and directory creation begins in OCX_EXECUTE once the plan is accepted.",
      howToAdvance: "Submit plan via ocx_plan and initialize todowrite in this turn. When accepted, the runtime activates the first step and advances to OCX_EXECUTE.",
    }
  if (kind === "act")
    return {
      mode: "OCX_EXECUTE [Active Implementation & Mutations Allowed]",
      allowed: "Create directories (mkdir), write new files (write), edit code/assets (edit, apply_patch), download assets, run build commands. BATCH ALL IMPLEMENTATION FOR THIS STEP AT ONCE.",
      forbidden: "DO NOT make out-of-scope modifications outside the active work targets. DO NOT ping-pong with one micro-action per turn.",
      whenToWrite: "You are authorized to create directories (mkdir) and create/edit files for the active work item targets. Batch directory setup and asset downloads into a single shell call.",
      howToAdvance: "Implement active step targets in full, run checks to verify, then update progress with ocx_progress (st=completed, ck=<check>, ev=<evidence>) and update todowrite.",
    }
  if (kind === "validate")
    return {
      mode: "OCX_VERIFY [Quality & Evidence Verification]",
      allowed: "Run test suites, linters, typechecks, build commands, and browser verification in ONE comprehensive check pass to collect proof of correctness.",
      forbidden: "DO NOT add new unverified features during verification. Fix only failing checks or regressions.",
      whenToWrite: "Only apply targeted fixes for failing checks or verified regressions.",
      howToAdvance: "Ensure tests pass and evidence is collected, then proceed to OCX_AUDIT and OCX_DELIVER.",
    }
  if (kind === "review")
    return {
      mode: "OCX_REVIEW [Review & Audit]",
      allowed: "Audit diffs against requirements, run anti-slop checks, verify test evidence, and close all todos before delivery.",
      forbidden: "DO NOT perform unrequested broad refactoring. DO NOT leave open todos or unverified claims.",
      whenToWrite: "Only targeted corrections for accepted review findings.",
      howToAdvance: "Confirm all acceptance criteria, anti-slop rules, and todos are satisfied, then proceed to OCX_DELIVER.",
    }
  if (kind === "deliver")
    return {
      mode: "OCX_DELIVER [Completion & Finalization]",
      allowed: "Verify all TODOs and plan items are complete, present clean summary of changes, output final response (STATE: done).",
      forbidden: "DO NOT leave incomplete TODOs or unverified claims.",
      whenToWrite: "No further code mutations.",
      howToAdvance: "Deliver the completed result and emit STATE: done.",
    }
  return {
    mode: "OCX_PIPELINE",
    allowed: "Inspect context, check requirements, and follow the active objective.",
    forbidden: "Operations contradictory to user constraints.",
    whenToWrite: "Mutations follow approved plan and active workstream targets.",
    howToAdvance: "Advance through the workflow phases as work progresses.",
  }
}

function taskTools(task: TaskKind, kind: PhaseProfile["kind"]): readonly string[] {
  if (task === "freeform") return ["read", "glob", "grep", "write", "edit", "apply_patch", "bash", "ocx_plan", "ocx_progress", "ocx_session", "question", "websearch", "webfetch"]
  if (kind === "understand") return task === "research" || task === "hybrid" ? ["read", "glob", "grep", "ocx_context", "websearch", "webfetch", "question"] : ["read", "glob", "grep", "ocx_context", "websearch", "webfetch", "question"]
  if (kind === "plan") return ["ocx_plan", "design", "read", "glob", "grep", "websearch", "webfetch", "ocx_context", "ocx_session", "question"]
  if (kind === "act") return ["read", "glob", "grep", "write", "edit", "apply_patch", "bash", "ocx_plan", "ocx_progress", "ocx_session", "question", ...(task === "hybrid" ? ["websearch", "webfetch"] : [])]
  if (kind === "review") return ["read", "glob", "grep", "bash", "audit", "websearch", "webfetch", "ocx_progress", "ocx_session", "question"]
  if (kind === "validate") return ["read", "glob", "grep", "bash", "audit", "ocx_progress", "ocx_session", "question"]
  if (kind === "deliver") return ["read", "bash", "question"]
  return ["read", "glob", "grep", "question"]
}

function defaultProfile(task: TaskKind, kind: PhaseProfile["kind"]): Omit<PhaseProfile, "kind" | "task" | "purpose" | "related"> {
  if (task === "freeform")
    return {
      tools: taskTools(task, kind),
      blocked: ["destructive operations without approval"],
      nextAction: "Execute user request directly without workflow restrictions.",
      playbookNote: "Freeform execution operates with all standard tools available.",
    }
  if (kind === "understand")
    return {
      tools: taskTools(task, kind),
      blocked: ["operations outside the user scope", "destructive operations without approval"],
      nextAction: "Inspect only the requested scope and collect enough evidence for the next useful operation.",
      playbookNote: "Selected playbooks are runtime guidance and never authorize an operation.",
    }
  if (kind === "plan")
    return {
      tools: taskTools(task, kind),
      blocked: ["unrelated scope expansion", "treating a plan as permission"],
      nextAction: "Record a concrete plan only when the task benefits from one. Structure is an optional playbook, not a filesystem-unlock requirement.",
      playbookNote: "Plans describe work; scope, approval, and effect policy decide whether it is allowed.",
    }
  if (kind === "act")
    return {
      tools: taskTools(task, kind),
      blocked: ["outside-scope mutations", "protected or destructive operations without approval"],
      nextAction: "Perform the requested operation and record the resulting evidence.",
      playbookNote: "Use the operation that matches the artifact surface; do not infer a code workflow from repository presence.",
    }
  if (kind === "review")
    return {
      tools: taskTools(task, kind),
      blocked: ["unrelated scope expansion", "unrequested destructive repair"],
      nextAction: "Evaluate the requested material against its acceptance criteria and evidence.",
      playbookNote: "Review guidance does not make safe related work illegal.",
    }
  if (kind === "validate")
    return {
      tools: taskTools(task, kind),
      blocked: ["claiming success without evidence", "missing required approval"],
      nextAction: "Run the narrowest meaningful validator and keep failures visible.",
    }
  if (kind === "deliver")
    return {
      tools: taskTools(task, kind),
      blocked: ["broad reset or unrelated changes", "destructive delivery without approval"],
      nextAction: "Deliver only the requested result and report the resulting state.",
    }
  return {
    tools: taskTools(task, kind),
    blocked: ["operations contradicted by explicit user policy"],
    nextAction: "Choose the next operation from the objective and observed evidence.",
  }
}

function patterns(context: WorkflowContext): { current: readonly string[]; related: readonly string[] } {
  if (!Workflow.isWorkflowId(context.workflow)) return { current: [], related: [] }
  const current = Workflow.phaseDefinition(context.workflow, context.phase)?.operations ?? []
  const family = Workflow.phaseDefinition(context.workflow, context.phase)?.family
  const related = family
    ? Workflow.preset(context.workflow).phases
        .filter((phase) => phase.id !== context.phase && phase.family === family)
        .flatMap((phase) => phase.operations ?? [])
    : []
  return {
    current: current.map((item) => `${item.surface}:${item.action}`),
    related: related.map((item) => `${item.surface}:${item.action}`),
  }
}

export function profile(context: WorkflowContext): PhaseProfile {
  const task = TaskModel.taskKind(context.workflow)
  const stage = TaskModel.stageKind(context.phase, context.workflow)
  const kind: PhaseProfile["kind"] = stage === "wait" || stage === "blocked" ? "other" : stage
  const base = defaultProfile(task, kind)
  const phase = Workflow.isWorkflowId(context.workflow) ? Workflow.phaseDefinition(context.workflow, context.phase) : undefined
  const operationPatterns = patterns(context)
  return {
    kind,
    task,
    purpose: phase?.goal ?? context.phases.find((item) => item.id === context.phase)?.goal ?? `Complete ${context.phase}.`,
    related: [...new Set(operationPatterns.related)],
    ...base,
    tools: phase?.operations ? taskTools(task, kind) : base.tools,
  }
}

export function capabilityAllowed(context: WorkflowContext | undefined, capability: Capability): boolean {
  return true
}

export function effectAllowed(context: WorkflowContext | undefined, effect: Effect): boolean {
  return true
}

export function isExplicitReadOnly(context: WorkflowContext | undefined): boolean {
  if (!context) return false
  const kind = profile(context).kind
  return kind === "understand" || kind === "plan" || kind === "review"
}

export function nextPhase(context: WorkflowContext): string | undefined {
  if (Workflow.isWorkflowId(context.workflow)) {
    const phases = Workflow.preset(context.workflow).phases
    const index = phases.findIndex((phase) => phase.id === context.phase)
    return index >= 0 ? phases[index + 1]?.id : undefined
  }
  const index = context.phases.findIndex((phase) => phase.id === context.phase)
  return index >= 0 ? context.phases[index + 1]?.id : undefined
}

export function renderPhaseCard(
  context: WorkflowContext,
  options: {
    readonly planRecorded?: boolean
    readonly structureRecorded?: boolean
    readonly activeStep?: string
    readonly hasFailure?: boolean
  } = {},
): string {
  return ""
}

export function recoveryLines(context: WorkflowContext): string[] {
  const current = context.phases.find((phase) => phase.id === context.phase)
  const phase = profile(context)
  const directives = phaseDirectives(phase.kind, context.phase)
  return [
    `state: ${phase.task}/${context.workflow}/${context.phase}`,
    `workflow: ${context.workflow}`,
    `phase: ${context.phase}`,
    `mode: ${directives.mode}`,
    `purpose: ${phase.purpose}`,
    `when to write/create files: ${directives.whenToWrite}`,
    `available now: ${phase.tools.join(", ")} (when present)`,
    `avoid now: ${phase.blocked.join("; ")}`,
    ...(current?.gate ? [`exit: ${current.gate}`] : []),
    ...(nextPhase(context) ? [`next stage: ${nextPhase(context)}`] : []),
    `next action: ${phase.nextAction}`,
    "retry rule: change the semantic action after a policy/tool failure; retrying with the sanctioned fix from the denial is a correction and is exempt",
  ]
}

export * as WorkflowPhaseProfile from "./workflow-phase-profile"
