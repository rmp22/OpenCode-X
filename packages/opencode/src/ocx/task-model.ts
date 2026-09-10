import { Workflow, type PhaseFamily, type WorkflowId } from "./workflow"

export type WorkflowContext = {
  readonly workflow?: string
  readonly phase?: string
}

export type TaskKind = WorkflowId | "mixed" | "general" | "automation"
export type StageKind = PhaseFamily | "wait" | "blocked" | "other"

const UNDERSTAND = new Set(["understand", "context", "explore", "inspect", "read", "diagnose", "gather", "discover", "evidence", "baseline", "frame", "scope", "triage", "preflight", "orient"])
const PLAN = new Set(["plan", "contract", "design", "define", "spec", "hypothesize"])
const ACT = new Set(["act", "apply", "canary", "change", "cleanup", "codegen", "code", "execute", "expand", "fix", "green", "implement", "prepare", "red", "repair", "repeat", "scaffold", "write", "migrate", "optimize", "promote", "mutate"])
const REVIEW = new Set(["selfreview", "review", "check", "feedback", "resolve", "audit", "challenge", "diagnose", "verify_findings", "converge"])
const VALIDATE = new Set(["validate", "verify", "test", "fullcheck", "measure", "confirm", "observe", "remeasure", "recover", "evaluate"])
const DELIVER = new Set(["commit", "merge", "push", "rebase", "ship", "stage", "publish", "sync", "deliver", "report", "retire", "signoff"])
const WAIT = new Set(["wait", "waiting", "needs_input", "input"])
const BLOCKED = new Set(["blocked", "failed", "error"])

export function taskKind(workflow: string | undefined): TaskKind {
  if (!workflow) return "general"
  const canonical = Workflow.canonicalID(workflow)
  if (canonical) return canonical
  if (workflow.toLowerCase() === "mixed") return "mixed"
  if (workflow.toLowerCase() === "automation") return "automation"
  return "general"
}

export function stageKind(phase: string | undefined, workflow?: string): StageKind {
  if (!phase) return "other"
  if (workflow && Workflow.isWorkflowId(workflow)) {
    const def = Workflow.phaseDefinition(workflow, phase)
    if (def) return def.family
  }
  const value = phase.toLowerCase()
  if (UNDERSTAND.has(value)) return "understand"
  if (PLAN.has(value)) return "plan"
  if (ACT.has(value)) return "act"
  if (REVIEW.has(value)) return "review"
  if (VALIDATE.has(value)) return "validate"
  if (DELIVER.has(value)) return "deliver"
  if (WAIT.has(value)) return "wait"
  if (BLOCKED.has(value)) return "blocked"
  return "other"
}

export function profile(context: WorkflowContext | undefined): { readonly task: TaskKind; readonly stage: StageKind } {
  return {
    task: taskKind(context?.workflow),
    stage: stageKind(context?.phase, context?.workflow),
  }
}

export function isActionStage(stage: StageKind): boolean {
  return stage === "act" || stage === "deliver"
}

export function requiresExecutionPlan(
  workflow: string | undefined,
  input: { readonly explicitPlan?: boolean; readonly complexity?: string; readonly risk?: string } = {},
): boolean {
  if (input.explicitPlan === true) return true
  const task = taskKind(workflow)
  if (task === "coding" || task === "debugging" || task === "migration" || task === "incident") return true
  return input.complexity === "high" || input.complexity === "systemic" || input.risk === "high" || input.risk === "destructive"
}

export function isCanonicalWorkflow(value: unknown): value is WorkflowId {
  return Workflow.isWorkflowId(value)
}

export * as TaskModel from "./task-model"
