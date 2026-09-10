export * as Workflow from "./workflow"

export const WORKFLOW_IDS = [
  "coding",
  "debugging",
  "review",
  "research",
  "documentation",
  "design",
  "performance",
  "environment",
  "git",
  "release",
  "migration",
  "incident",
  "hybrid",
  "freeform",
] as const

export type WorkflowId = (typeof WORKFLOW_IDS)[number]
export type WorkflowVariant =
  | "feature"
  | "greenfield"
  | "refactor"
  | "cleanup"
  | "tdd"
  | "analysis"
  | "fix"
  | "audit"
  | "security"
  | "accessibility"
  | "dependency"
  | "architecture"
  | (string & {})
export type PhaseFamily = "understand" | "plan" | "act" | "validate" | "review" | "deliver"
export type WorkflowStatus = "active" | "waiting" | "blocked" | "complete"
export type WorkSurface =
  | "code"
  | "test"
  | "documentation"
  | "config"
  | "build"
  | "dependency"
  | "schema"
  | "data"
  | "ui"
  | "git"
  | "environment"
  | "research"
  | "design"
  | "release"
export type WorkAction =
  | "inspect"
  | "create"
  | "edit"
  | "refactor"
  | "delete"
  | "move"
  | "generate"
  | "review"
  | "measure"
  | "run"
  | "download"
  | "commit"
  | "sync"
  | "deploy"
  | "rollback"

export type Operation = {
  readonly surface: WorkSurface
  readonly action: WorkAction
  readonly targets?: readonly string[]
  readonly intent?: string
  readonly required?: boolean
}

export type ConditionalRule = {
  readonly any?: readonly string[]
  readonly all?: readonly string[]
  readonly when?: string
}

export type OperationPattern = {
  readonly surface: WorkSurface
  readonly action: WorkAction
}

export type PhaseCondition = string

export type PhaseDefinition = {
  readonly id: string
  readonly family: PhaseFamily
  readonly goal: string
  readonly required: true | false | ConditionalRule
  readonly operations?: readonly OperationPattern[]
  readonly preferred?: readonly OperationPattern[]
  readonly related?: readonly OperationPattern[]
  readonly incompatible?: readonly OperationPattern[]
  readonly entry?: readonly PhaseCondition[]
  readonly completion?: readonly PhaseCondition[]
  readonly preferredNext?: readonly string[]
  readonly returnTo?: readonly string[]
}

export type WorkflowPreset = {
  readonly id: WorkflowId
  readonly variants: readonly WorkflowVariant[]
  readonly phases: readonly PhaseDefinition[]
}

export type WorkflowState = {
  readonly workflow: WorkflowId
  readonly variant?: WorkflowVariant
  readonly phase: string
  readonly objective: string
  readonly status: WorkflowStatus
  readonly revision: number
}

export type Phase = {
  readonly id: string
  readonly goal: string
  readonly gate?: string
}

export type Workstream = {
  readonly id: string
  readonly goal: string
}

/** Legacy phase-shaped view retained for session/prompt migration. */
export type Workflow = {
  readonly name: string
  readonly description: string
  readonly phases: readonly Phase[]
  readonly id?: WorkflowId
  readonly variant?: WorkflowVariant
}

const operation = (surface: WorkSurface, action: WorkAction): OperationPattern => ({ surface, action })
const phase = (
  id: string,
  family: PhaseFamily,
  goal: string,
  required: PhaseDefinition["required"],
  operations?: readonly OperationPattern[],
  completion?: readonly PhaseCondition[],
  preferredNext?: readonly string[],
  returnTo?: readonly string[],
): PhaseDefinition => ({
  id,
  family,
  goal,
  required,
  ...(operations ? { operations } : {}),
  ...(completion ? { completion } : {}),
  ...(preferredNext ? { preferredNext } : {}),
  ...(returnTo ? { returnTo } : {}),
})

export const AGENTIC_WORKFLOW: WorkflowPreset = {
  id: "freeform",
  variants: ["standard", "agentic", "dynamic"],
  phases: [
    phase("execute", "act", "execute agentic task dynamically across inspection, mutation, and verification", true, [
      operation("code", "create"),
      operation("code", "edit"),
      operation("code", "refactor"),
      operation("code", "inspect"),
      operation("code", "review"),
      operation("test", "create"),
      operation("test", "edit"),
      operation("test", "run"),
      operation("test", "inspect"),
      operation("documentation", "create"),
      operation("documentation", "edit"),
      operation("documentation", "inspect"),
      operation("research", "inspect"),
      operation("git", "inspect"),
      operation("git", "edit"),
      operation("git", "commit"),
      operation("git", "sync"),
      operation("environment", "inspect"),
      operation("environment", "edit"),
      operation("environment", "run"),
      operation("config", "inspect"),
      operation("config", "edit"),
      operation("ui", "inspect"),
      operation("ui", "create"),
      operation("ui", "edit"),
    ]),
    phase("validate", "validate", "verify behavior, run tests, and check quality", true, [
      operation("test", "run"),
      operation("code", "inspect"),
    ]),
    phase("audit", "review", "review changes and confirm readiness", true, [
      operation("code", "review"),
      operation("test", "inspect"),
    ]),
    phase("deliver", "deliver", "summarize deliverable, review outcomes, and finalize", true, [
      operation("code", "inspect"),
      operation("git", "inspect"),
    ]),
  ],
}

/** @deprecated Linear workflow presets are deprecated in favor of dynamic agentic capability graphs. */
const CANONICAL_PRESETS: Record<WorkflowId, WorkflowPreset> = {
  coding: {
    id: "coding",
    variants: ["feature", "greenfield", "refactor", "cleanup", "tdd", "dependency", "architecture"],
    phases: [
      phase("plan", "plan", "choose the smallest safe implementation plan", { any: ["complexity>=medium", "risk>=moderate", "user_requested_plan"] }, [operation("documentation", "create")]),
      phase("change", "act", "make the requested source, test, or supporting change", true, [operation("code", "create"), operation("code", "edit"), operation("code", "refactor"), operation("test", "create"), operation("test", "edit"), operation("documentation", "edit"), operation("config", "edit")]),
      phase("validate", "validate", "validate the changed behavior with relevant evidence", { when: "mutation_performed" }, [operation("test", "run"), operation("build", "run"), operation("code", "inspect")], ["validation passed"], ["change"], ["change"]),
      phase("audit", "review", "audit the changed code, design, and verification evidence", true, [operation("code", "review"), operation("documentation", "review")]),
      phase("deliver", "deliver", "deliver the requested result", true, [operation("git", "commit"), operation("documentation", "edit")]),
    ],
  },
  debugging: {
    id: "debugging",
    variants: ["analysis", "fix", "incident-lite"],
    phases: [
      phase("reproduce", "understand", "reproduce the failure when possible", false, [operation("test", "run"), operation("code", "inspect"), operation("environment", "inspect")]),
      phase("investigate", "understand", "narrow the failure and inspect its causal context", true, [operation("code", "inspect"), operation("test", "inspect"), operation("research", "inspect")]),
      phase("diagnose", "review", "state a falsifiable diagnosis supported by evidence", true, [operation("code", "review"), operation("research", "review")]),
      phase("repair", "act", "repair the root cause only when the user requests a fix", { when: "user_wants_fix" }, [operation("code", "edit"), operation("code", "refactor"), operation("test", "create"), operation("test", "edit")]),
      phase("validate", "validate", "validate recovery or the diagnosis", { when: "repair_performed" }, [operation("test", "run"), operation("build", "run")], ["validation passed"], ["repair"], ["repair"]),
      phase("audit", "review", "audit the repair, diagnostics, and root-cause evidence", true, [operation("code", "review"), operation("test", "inspect")]),
      phase("deliver", "deliver", "report the diagnosis or delivered repair", true, [operation("documentation", "edit")]),
    ],
  },
  review: {
    id: "review",
    variants: ["audit", "security", "architecture", "correctness", "performance", "accessibility"],
    phases: [
      phase("context", "understand", "understand intent, scope, and related code", false, [operation("code", "inspect"), operation("documentation", "inspect")]),
      phase("read", "understand", "read every line of the diff and touched files", true, [operation("code", "inspect"), operation("documentation", "inspect")]),
      phase("check", "review", "check design, correctness, security, complexity, and tests", true, [operation("code", "review"), operation("documentation", "review")]),
      phase("verify_findings", "validate", "ground each finding in evidence", true, [operation("test", "run"), operation("code", "inspect")]),
      phase("repair", "act", "repair accepted findings only when requested", { when: "user_wants_fix" }, [operation("code", "edit"), operation("test", "edit")]),
      phase("audit", "review", "audit findings and evidence completeness before delivery", true, [operation("code", "review"), operation("documentation", "review")]),
      phase("deliver", "deliver", "deliver tiered findings and limitations", true),
    ],
  },
  research: {
    id: "research",
    variants: ["analysis", "security", "architecture"],
    phases: [
      phase("frame", "understand", "define the question, decision, audience, and evidence bar", true),
      phase("gather", "understand", "collect relevant primary and repository sources", true, [operation("research", "inspect"), operation("research", "review")]),
      phase("analyze", "review", "turn sources into atomic claims and comparisons", true, [operation("research", "review"), operation("research", "measure")]),
      phase("challenge", "validate", "search contradictions, gaps, and source limitations", true, [operation("research", "review")]),
      phase("audit", "review", "audit findings, claims, and source evidence before delivery", true, [operation("research", "review")]),
      phase("deliver", "deliver", "write a cited synthesis with limitations", true, [operation("documentation", "create")]),
    ],
  },
  documentation: {
    id: "documentation",
    variants: ["tutorial", "howto", "reference", "explanation", "changelog", "readme"],
    phases: [
      phase("edit", "act", "create or edit documentation without source-code mutation privilege", true, [operation("documentation", "create"), operation("documentation", "edit")]),
      phase("validate", "validate", "check source fidelity, links, examples, and relevant docs tooling", { when: "documentation_changed" }, [operation("documentation", "review"), operation("test", "run")], ["documentation validated"], ["edit"], ["edit"]),
      phase("audit", "review", "audit documentation quality, fidelity, and clarity", true, [operation("documentation", "review")]),
      phase("deliver", "deliver", "deliver the requested documentation result", true),
    ],
  },
  design: {
    id: "design",
    variants: ["ui", "ux", "architecture", "visual", "interaction"],
    phases: [
      phase("discover", "understand", "discover user need and existing product context", true, [operation("design", "inspect"), operation("ui", "inspect")]),
      phase("plan", "plan", "define constraints, hierarchy, design tokens, and workstream plan", false, [operation("design", "review")]),
      phase("act", "act", "explore candidate directions and implement components or markup", true, [operation("design", "create"), operation("ui", "create"), operation("ui", "edit")]),
      phase("validate", "validate", "validate structure, accessibility, and rendered behavior", { when: "implementation_performed" }, [operation("ui", "review"), operation("test", "run")]),
      phase("audit", "review", "audit design quality, typography, accessibility, and visual fit", true, [operation("ui", "review"), operation("design", "review")]),
      phase("deliver", "deliver", "deliver the design or implementation result", true),
    ],
  },
  performance: {
    id: "performance",
    variants: ["analysis", "optimization"],
    phases: [
      phase("baseline", "understand", "define the symptom and record comparable baseline measurements", true, [operation("code", "inspect"), operation("test", "run")]),
      phase("measure", "understand", "measure utilization, saturation, errors, or other relevant signals", true, [operation("code", "measure"), operation("test", "run")]),
      phase("diagnose", "review", "identify a bottleneck supported by evidence", true, [operation("code", "review")]),
      phase("optimize", "act", "apply an optimization only when requested and justified", { when: "user_wants_optimization" }, [operation("code", "edit"), operation("config", "edit")]),
      phase("remeasure", "validate", "rerun the same measurement and compare conditions", { when: "optimization_performed" }, [operation("code", "measure"), operation("test", "run")], ["comparable measurement recorded"], ["optimize"], ["optimize"]),
      phase("audit", "review", "audit performance measurements, tradeoffs, and limits", true, [operation("code", "review")]),
      phase("deliver", "deliver", "report measurements, tradeoffs, and limitations", true),
    ],
  },
  environment: {
    id: "environment",
    variants: ["dependency", "toolchain", "runtime"],
    phases: [
      phase("inspect", "understand", "inspect host, runtime, and toolchain state", true, [operation("environment", "inspect"), operation("config", "inspect")]),
      phase("plan", "plan", "choose the smallest compatible environment change", false),
      phase("apply", "act", "apply a bounded environment or configuration change", { when: "user_wants_change" }, [operation("environment", "edit"), operation("config", "edit"), operation("dependency", "edit")]),
      phase("validate", "validate", "run the relevant launch or smoke check", { when: "change_performed" }, [operation("environment", "run"), operation("test", "run")]),
      phase("audit", "review", "audit environment configuration, security bounds, and state", true, [operation("environment", "inspect"), operation("config", "inspect")]),
      phase("deliver", "deliver", "report environment state and any remaining blocker", true),
    ],
  },
  git: {
    id: "git",
    variants: ["prepare", "commit", "sync", "release"],
    phases: [
      phase("inspect", "understand", "inspect status, diff, history, and change topics", true, [operation("git", "inspect")]),
      phase("prepare", "act", "group and prepare only the requested changes", { when: "user_wants_stage" }, [operation("git", "edit")]),
      phase("audit", "review", "audit staged changes and git status against intent", true, [operation("git", "inspect")]),
      phase("commit", "deliver", "create the requested conventional commit", { when: "user_wants_commit" }, [operation("git", "commit")]),
      phase("sync", "deliver", "sync or rebase only when requested", { when: "user_wants_sync" }, [operation("git", "sync")]),
      phase("deliver", "deliver", "report the resulting repository state", true),
    ],
  },
  release: {
    id: "release",
    variants: ["canary", "rollback", "production"],
    phases: [
      phase("preflight", "understand", "inspect release inputs, checks, and rollback readiness", true),
      phase("prepare", "plan", "prepare a bounded release candidate", true),
      phase("canary", "act", "deploy to the requested canary ring", { when: "canary_requested" }, [operation("release", "deploy")]),
      phase("observe", "validate", "observe health and error-budget signals", { when: "release_started" }, [operation("release", "inspect")], undefined, ["promote"]),
      phase("promote", "act", "promote only after release evidence is healthy", { when: "promotion_requested" }, [operation("release", "deploy")], undefined, ["deliver"], ["observe"]),
      phase("audit", "review", "audit release health metrics and rollback readiness", true, [operation("release", "inspect")]),
      phase("deliver", "deliver", "report release state and rollback status", true),
    ],
  },
  migration: {
    id: "migration",
    variants: ["schema", "api", "data", "compatibility"],
    phases: [
      phase("inspect", "understand", "inspect current state, consumers, and compatibility constraints", true),
      phase("plan", "plan", "define compatibility, rollback, and observability steps", true),
      phase("expand", "act", "add compatible structure before destructive change", false),
      phase("migrate", "act", "move data or consumers in bounded batches", true),
      phase("validate", "validate", "validate compatibility and data integrity", true),
      phase("contract", "act", "remove old structure only after compatibility evidence", false),
      phase("audit", "review", "audit migration completeness and data integrity", true, [operation("schema", "inspect"), operation("data", "inspect")]),
      phase("deliver", "deliver", "report migration state and remaining overlap", true),
    ],
  },
  incident: {
    id: "incident",
    variants: ["analysis", "mitigation", "postmortem"],
    phases: [
      phase("triage", "understand", "prioritize impact and establish the incident boundary", true),
      phase("mitigate", "act", "stop the bleeding with the safest reversible action", false),
      phase("investigate", "understand", "preserve evidence and investigate contributing causes", true),
      phase("repair", "act", "repair the cause when safe and authorized", false),
      phase("recover", "validate", "verify user recovery and service health", true),
      phase("audit", "review", "audit evidence and unresolved risk", true),
      phase("postmortem", "deliver", "record learning when requested or policy requires it", false),
      phase("deliver", "deliver", "report current incident state and next action", true),
    ],
  },
  hybrid: {
    id: "hybrid",
    variants: ["standard", "analysis", "feature", "refactor", "architecture", "custom"],
    phases: [
      phase("explore", "understand", "explore the problem space, inspect source, and research relevant context", true, [
        operation("code", "inspect"),
        operation("research", "inspect"),
        operation("documentation", "inspect"),
      ]),
      phase("plan", "plan", "synthesize findings and plan implementation architecture", true, [
        operation("code", "inspect"),
        operation("research", "inspect"),
      ]),
      phase("execute", "act", "implement changes across code, tests, and documentation", true, [
        operation("code", "create"),
        operation("code", "edit"),
        operation("test", "create"),
        operation("test", "edit"),
        operation("documentation", "create"),
        operation("documentation", "edit"),
      ]),
      phase("validate", "validate", "verify behavior, run tests, and check quality", true, [
        operation("test", "run"),
        operation("code", "inspect"),
      ]),
      phase("audit", "review", "review changes and confirm readiness", true, [
        operation("code", "review"),
        operation("test", "inspect"),
      ]),
      phase("deliver", "deliver", "summarize deliverable, review outcomes, and finalize", true, [
        operation("code", "inspect"),
        operation("git", "inspect"),
      ]),
    ],
  },
  freeform: {
    id: "freeform",
    variants: ["standard", "custom"],
    phases: [
      phase("execute", "act", "execute freeform task without rigid phase constraints", true, [
        operation("code", "create"),
        operation("code", "edit"),
        operation("code", "refactor"),
        operation("code", "inspect"),
        operation("code", "review"),
        operation("test", "create"),
        operation("test", "edit"),
        operation("test", "run"),
        operation("test", "inspect"),
        operation("documentation", "create"),
        operation("documentation", "edit"),
        operation("documentation", "inspect"),
        operation("research", "inspect"),
        operation("git", "inspect"),
        operation("git", "edit"),
        operation("git", "commit"),
        operation("git", "sync"),
        operation("environment", "inspect"),
        operation("environment", "edit"),
        operation("environment", "run"),
        operation("config", "inspect"),
        operation("config", "edit"),
        operation("ui", "inspect"),
        operation("ui", "create"),
        operation("ui", "edit"),
      ]),
      phase("audit", "review", "review freeform changes", true, [
        operation("code", "review"),
      ]),
      phase("deliver", "deliver", "summarize freeform work and complete deliverable", true, [
        operation("code", "inspect"),
        operation("git", "inspect"),
      ]),
    ],
  },
}

export const PRESETS = CANONICAL_PRESETS

export function isWorkflowId(value: unknown): value is WorkflowId {
  return typeof value === "string" && WORKFLOW_IDS.includes(value as WorkflowId)
}

export function preset(id: WorkflowId): WorkflowPreset {
  return CANONICAL_PRESETS[id]
}

const ALIASES: Record<string, WorkflowId> = {
  codegen: "coding",
  code: "coding",
  feature: "coding",
  fix: "debugging",
  bug: "debugging",
  doc: "documentation",
  docs: "documentation",
  hybrid: "hybrid",
  mixed: "hybrid",
  compound: "hybrid",
  freeform: "freeform",
  adhoc: "freeform",
  direct: "freeform",
  open: "freeform",
  unconstrained: "freeform",
}

export function canonicalID(value: unknown): WorkflowId | undefined {
  if (typeof value !== "string") return undefined
  const stripped = value.replace(/\[[^\]]*\]/g, "").trim()
  const normalized = normalizeID(stripped)
  if (!normalized) return undefined
  if (isWorkflowId(normalized)) return normalized
  if (ALIASES[normalized]) return ALIASES[normalized]
  const base = normalized.split("-")[0]
  if (base && isWorkflowId(base)) return base
  if (base && ALIASES[base]) return ALIASES[base]
  return undefined
}

export function actionPhase(workflowId: string): string | undefined {
  const canonical = canonicalID(workflowId)
  if (!canonical) return undefined
  const presetDef = CANONICAL_PRESETS[canonical]
  if (!presetDef) return undefined
  const actPhase = presetDef.phases.find((phase) => phase.family === "act")
  return actPhase?.id
}

export function validatePhase(workflowId: string): string | undefined {
  const canonical = canonicalID(workflowId)
  if (!canonical) return undefined
  const presetDef = CANONICAL_PRESETS[canonical]
  if (!presetDef) return undefined
  const valPhase = presetDef.phases.find((phase) => phase.family === "validate")
  return valPhase?.id
}

export function workflowState(workflow: WorkflowId, phase: string, input: { variant?: WorkflowVariant; objective?: string; status?: WorkflowStatus; revision?: number } = {}): WorkflowState {
  const definition = preset(workflow)
  const phaseDefinition = definition.phases.find((item) => item.id === phase) ?? definition.phases[0]!
  return {
    workflow,
    ...(input.variant ? { variant: input.variant } : {}),
    phase: phaseDefinition.id,
    objective: input.objective ?? phaseDefinition.goal,
    status: input.status ?? "active",
    revision: input.revision ?? 0,
  }
}

function legacyPreset(value: WorkflowPreset): Workflow {
  return {
    id: value.id,
    name: value.id,
    description: descriptionFor(value.id),
    phases: value.phases.map((item) => ({
      id: item.id,
      goal: item.goal,
      ...(item.completion?.[0] ? { gate: item.completion[0] } : {}),
    })),
  }
}

function descriptionFor(id: WorkflowId): string {
  const descriptions: Record<WorkflowId, string> = {
    coding: "create or change source behavior when requested",
    debugging: "find and explain or repair a failure by evidence",
    review: "evaluate a change or artifact and report grounded findings",
    research: "investigate a question and report sourced findings",
    documentation: "create or update documentation from source-of-truth material",
    design: "explore and validate a product or system design",
    performance: "measure and improve performance when requested",
    environment: "inspect or change a host, runtime, or toolchain safely",
    git: "inspect and perform requested repository delivery operations",
    release: "prepare, observe, and deliver a release safely",
    migration: "move data, schema, or consumers through compatibility steps",
    incident: "triage, mitigate, recover, and learn from an incident",
    hybrid: "investigate, plan, execute, and deliver compound research and code tasks",
    freeform: "execute direct user requests with standard capabilities",
  }
  return descriptions[id]
}

export function fromPhases(name: string, phases: readonly Phase[]): Workflow {
  return { name, description: "", phases }
}

export function get(name: string): Workflow | undefined {
  const id = normalizeID(name)
  return id && isWorkflowId(id) ? legacyPreset(CANONICAL_PRESETS[id]) : undefined
}

export function catalog(): string {
  return WORKFLOW_IDS.map((id) => {
    const value = CANONICAL_PRESETS[id]
    return `- ${id}: ${descriptionFor(id)} (variants: ${value.variants.join(", ") || "none"}; phases: ${value.phases.map((item) => item.id).join(" -> ")})`
  }).join("\n")
}

const maxPhases = 8
const minPhases = 2

export function normalizeID(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const id = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
  return id.length > 0 ? id : undefined
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

export function sanitizeLine(value: unknown): string | undefined {
  if (!nonEmpty(value)) return undefined
  const line = value.replace(/\s+/g, " ").trim()
  if (line.length === 0 || line.includes("===")) return undefined
  return line
}

export function note(value: unknown): string | undefined {
  return sanitizeLine(value)
}

function parsePhases(value: unknown): Phase[] | undefined {
  if (!Array.isArray(value) || value.length < minPhases || value.length > maxPhases) return undefined
  const phases: Phase[] = []
  const seen = new Set<string>()
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return undefined
    const record = item as Record<string, unknown>
    const id = normalizeID(record.id)
    const goal = sanitizeLine(record.goal)
    if (!id || seen.has(id) || !goal) return undefined
    seen.add(id)
    phases.push({ id, goal })
  }
  return phases
}

export function parseWorkstreams(value: unknown): Workstream[] | undefined {
  if (!Array.isArray(value) || value.length < 1) return undefined
  const streams: Workstream[] = []
  const seen = new Set<string>()
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return undefined
    const record = item as Record<string, unknown>
    const id = normalizeID(record.id)
    const goal = sanitizeLine(record.goal)
    if (!id || seen.has(id) || !goal) return undefined
    seen.add(id)
    streams.push({ id, goal })
  }
  return streams
}

export type Selection =
  | { readonly kind: "preset"; readonly workflow: Workflow }
  | { readonly kind: "custom"; readonly workflow: Workflow }

export function resolveSelection(parsed: Record<string, unknown> | undefined): Selection | undefined {
  const requested = nonEmpty(parsed?.name) ? parsed.name : parsed?.workflow
  if (!nonEmpty(requested)) return undefined
  const normalized = normalizeID(requested)
  if (!normalized) return undefined
  const canonical = canonicalID(normalized)
  if (canonical) {
    const selected = legacyPreset(CANONICAL_PRESETS[canonical])
    return { kind: "preset", workflow: selected }
  }
  const phases = parsePhases(parsed?.phases)
  if (!phases) return undefined
  return {
    kind: "custom",
    workflow: { name: normalized, description: "custom workflow submitted by the model", phases },
  }
}

export function resolvePhase(parsed: Record<string, unknown> | undefined, workflow: Workflow): string | undefined {
  const id = normalizeID(parsed?.phase)
  if (!id) return undefined
  if (workflow.phases.some((phaseItem) => phaseItem.id === id)) return id
  if (["isolate", "verify", "commit", "check", "explore", "context"].includes(id)) return id
  return undefined
}

export function render(workflow: Workflow, currentPhase: string, reminder?: string, workstream?: readonly Workstream[], currentOperation?: Operation): string {
  const canonical = isWorkflowId(workflow.name) ? CANONICAL_PRESETS[workflow.name] : undefined
  const current = canonical?.phases.find((item) => item.id === currentPhase)
  const currentOperations = current?.operations?.map((item) => `${item.surface}:${item.action}`) ?? []
  const related = canonical?.phases
    .filter((item) => item.id !== currentPhase && item.family === current?.family)
    .flatMap((item) => item.operations ?? [])
    .map((item) => `${item.surface}:${item.action}`) ?? []
  return [
    "=== OCX WORKFLOW ===",
    `WORKFLOW: ${workflow.name}`,
    ...(workflow.variant ? [`VARIANT: ${workflow.variant}`] : []),
    `PHASE: ${currentPhase}`,
    `Current phase: ${currentPhase}`,
    `GOAL: ${current?.goal ?? workflow.phases.find((item) => item.id === currentPhase)?.goal ?? "complete the current requested work"}`,
    ...(currentOperation ? [`OPERATION: ${currentOperation.surface}:${currentOperation.action}`] : []),
    `CURRENT ACTIONS: ${[...new Set(currentOperations)].join(", ") || "choose the next safe action from the request"}`,
    `RELATED ACTIONS: ${[...new Set(related)].join(", ") || "none"}`,
    "POLICY: Workflow guides sequencing. User scope, protected paths, approvals, dependencies, and destructive-action policy decide whether an operation is allowed.",
    ...(reminder ? [`NOTE: ${reminder}`] : []),
    ...(workstream && workstream.length > 0 ? [`WORKSTREAMS: ${workstream.map((item) => `${item.id} - ${item.goal}`).join("; ")}`] : []),
    "=== END OCX WORKFLOW ===",
  ].join("\n")
}

export function entryPhase(workflow: Workflow): string {
  const first = workflow?.phases?.[0]
  if (first) return first.id
  if (workflow?.name && isWorkflowId(workflow.name as WorkflowId)) {
    const p = preset(workflow.name as WorkflowId).phases[0]
    if (p) return p.id
  }
  throw new Error(`workflow "${workflow?.name ?? "unknown"}" has no phases`)
}

export function selectPhase(input: {
  readonly workflow: Workflow
  readonly requested?: string
  readonly previousWorkflow?: string
  readonly previousPhase?: string
}): string {
  const { workflow, requested, previousWorkflow, previousPhase } = input
  const phases = workflow?.phases ?? (workflow?.name && isWorkflowId(workflow.name as WorkflowId) ? preset(workflow.name as WorkflowId).phases : [])
  const phaseIds = new Set(phases.map((phase) => phase.id))
  if (requested && phaseIds.has(requested)) return requested
  const prevWf = previousWorkflow ? canonicalID(previousWorkflow) ?? previousWorkflow : undefined
  const currWf = workflow?.name ? canonicalID(workflow.name) ?? workflow.name : undefined
  if (prevWf && currWf && prevWf === currWf && previousPhase && phaseIds.has(previousPhase)) return previousPhase
  return entryPhase(workflow)
}

export function phaseDefinition(workflow: WorkflowId, phaseID: string): PhaseDefinition | undefined {
  const direct = CANONICAL_PRESETS[workflow].phases.find((phaseItem) => phaseItem.id === phaseID)
  if (direct) return direct
  const legacyAliases: Record<string, string> = {
    understand: "discover",
    define: "plan",
    explore: "act",
    implement: "act",
    decide: "audit",
  }
  const targetID = legacyAliases[phaseID]
  return targetID ? CANONICAL_PRESETS[workflow].phases.find((phaseItem) => phaseItem.id === targetID) : undefined
}
