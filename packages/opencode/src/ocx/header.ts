import type { GateTier } from "./exit-gate"
import type { StrategyName } from "@/ocx/strategy"
import { Strategy } from "@/ocx/strategy"
import { Workflow } from "@/ocx/workflow"
import { KNOWN_INTENTS, type Intent } from "@/ocx/heuristics"
import { Wrapper, type WrapperError } from "./tool-input/wrapper"

export type PlanStep = { readonly do: string; readonly expect: string }

export type HeaderInput = {
  readonly topic: string
  readonly reason?: unknown
  readonly strategies: readonly string[]
  readonly workflow?: string
  readonly variant?: string
  readonly phase?: string
  readonly operation?: unknown
  readonly risks: readonly string[]
  readonly intents?: readonly string[]
  readonly plan?: readonly { do?: unknown; expect?: unknown }[]
  readonly workstreams?: readonly { id?: unknown; goal?: unknown }[]
}

export type Header = {
  readonly topic: string
  readonly workflowReason?: string
  readonly strategies: StrategyName[]
  readonly unknownStrategies: string[]
  readonly workflowName?: string
  readonly variant?: string
  readonly phase?: string
  readonly operation?: Workflow.Operation
  readonly risks: string[]
  readonly intents: Intent[]
  readonly plan: PlanStep[]
  readonly workstreams: Workflow.Workstream[]
}

export type HeaderWrapperResult = {
  readonly header?: Header
  readonly errors: readonly WrapperError[]
}

const maxTopicWords = 6
const maxTopicChars = 48
const labelPrefix = /^(?:thought|thinking|reasoning|title|summary)\s*[:：\-–—]\s*/i
const unavailableContextTopic =
  /(?:\b(?:no|missing|unavailable|availability|unknown|absent|without)\b.{0,32}\b(?:request|prompt|context)\b|\b(?:request|prompt|context)\b.{0,32}\b(?:missing|unavailable|availability|unknown|absent|not\s+(?:provided|given|included|available|supplied))\b|\b(?:cannot|can't|unable)\b.{0,32}\b(?:request|prompt|context)\b)/i
const vagueTopicWords = new Set([
  "a",
  "an",
  "answer",
  "the",
  "change",
  "check",
  "checking",
  "code",
  "context",
  "continue",
  "continuing",
  "current",
  "draft",
  "file",
  "files",
  "handle",
  "handling",
  "inspect",
  "inspecting",
  "issue",
  "missing",
  "next",
  "output",
  "plan",
  "problem",
  "progress",
  "prompt",
  "read",
  "reading",
  "reasoning",
  "request",
  "response",
  "result",
  "review",
  "reviewing",
  "source",
  "step",
  "summary",
  "task",
  "thing",
  "thinking",
  "title",
  "unavailable",
  "update",
  "updating",
  "work",
  "working",
  "no",
  "thought",
])

function cleanTopic(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const clean = value.replace(/\s+/g, " ").trim()
  if (!clean) return undefined
  const words = clean.split(" ").slice(0, maxTopicWords).join(" ")
  return words.length > maxTopicChars ? `${words.slice(0, maxTopicChars).trimEnd()}...` : words
}

export function isValidTopic(value: unknown): value is string {
  if (typeof value !== "string") return false
  const clean = value.replace(/\s+/g, " ").trim()
  if (!clean) return false
  return isConcreteTopic(clean)
}

function isConcreteTopic(value: string): boolean {
  const words = value.toLocaleLowerCase().match(/\p{L}[\p{L}\p{N}]*/gu) ?? []
  return (
    words.length >= 2 &&
    !words.every((word) => vagueTopicWords.has(word)) &&
    !labelPrefix.test(value) &&
    !unavailableContextTopic.test(value)
  )
}

function cleanIntents(value: unknown): Intent[] {
  if (!Array.isArray(value)) return []
  const out = new Set<Intent>()
  for (const item of value) {
    if (typeof item !== "string") continue
    const match = KNOWN_INTENTS.find((intent) => intent === (item as Intent))
    if (match) out.add(match)
  }
  return [...out]
}

function cleanPlan(value: unknown): PlanStep[] {
  if (!Array.isArray(value)) return []
  const steps: PlanStep[] = []
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue
    const record = raw as Record<string, unknown>
    const doText = typeof record.do === "string" ? record.do.replace(/\s+/g, " ").trim() : ""
    const expectText = typeof record.expect === "string" ? record.expect.replace(/\s+/g, " ").trim() : ""
    if (doText.length < 5 || doText.length > 200) continue
    if (expectText.length < 3 || expectText.length > 200) continue
    steps.push({ do: doText, expect: expectText })
    if (steps.length === 7) break
  }
  return steps
}

function cleanRisks(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const item of value) {
    if (typeof item !== "string") continue
    const line = item.replace(/\s+/g, " ").trim()
    if (line.length < 8 || line.length > 200) continue
    out.push(line)
    if (out.length === 3) break
  }
  return out
}

function cleanWorkstreams(value: unknown): Workflow.Workstream[] {
  return Workflow.parseWorkstreams(value) ?? []
}

const PLAN_WORKFLOWS = new Set(["coding", "debugging", "migration", "incident"])
const PLAN_INTENTS = new Set<Intent>(["code", "debug", "refactor", "plan"])

export function requiresExecutionPlan(input: {
  readonly workflowName?: string
  readonly intents?: readonly Intent[]
  readonly strategies?: readonly StrategyName[]
}): boolean {
  return (
    (input.workflowName !== undefined && PLAN_WORKFLOWS.has(input.workflowName)) ||
    (input.intents ?? []).some((intent) => PLAN_INTENTS.has(intent)) ||
    (input.strategies ?? []).some((strategy) => strategy === "write" || strategy === "structure")
  )
}

export function executionPlanGaps(
  header: Pick<Header, "workflowName" | "intents" | "strategies" | "plan" | "workstreams">,
): string[] {
  if (!requiresExecutionPlan(header)) return []
  const gaps: string[] = []
  if (header.plan.length < 2) gaps.push("at least two plan steps")
  if (header.workstreams.length < 1) gaps.push("at least one workstream")
  return gaps
}

export function parseHeader(
  value: unknown,
  context: { storedWorkflow?: string; storedPhases?: readonly Workflow.Phase[] } = {},
): Header {
  const record = (value && typeof value === "object" && !Array.isArray(value) ? value : {}) as Record<string, unknown>
  const known = new Set<string>(Strategy.STRATEGY_NAMES)
  const unknownStrategies: string[] = []
  const strategies: StrategyName[] = []
  for (const raw of Array.isArray(record.strategies) ? record.strategies : []) {
    if (typeof raw !== "string" || !known.has(raw)) {
      if (typeof raw === "string" && raw.length > 0) unknownStrategies.push(raw)
      continue
    }
    if (!strategies.includes(raw as StrategyName)) strategies.push(raw as StrategyName)
  }

  const workflowName =
    typeof record.workflow === "string" ? (Workflow.canonicalID(record.workflow) ?? undefined) : undefined
  const variant = typeof record.variant === "string" ? Workflow.normalizeID(record.variant) : undefined
  let phase = typeof record.phase === "string" ? (Workflow.normalizeID(record.phase) ?? undefined) : undefined
  const phases =
    workflowName && context.storedWorkflow === workflowName
      ? context.storedPhases
      : Workflow.get(workflowName ?? "")?.phases
  if (phase && phases && !phases.some((phaseItem) => phaseItem.id === phase)) phase = undefined

  const topic = cleanTopic(record.topic)
  const workflowReason = Workflow.sanitizeLine(record.reason)
  const operation = cleanOperation(record.operation)
  return {
    topic: topic && isConcreteTopic(topic) ? topic : "",
    ...(workflowReason ? { workflowReason } : {}),
    strategies,
    unknownStrategies,
    ...(workflowName ? { workflowName } : {}),
    ...(variant ? { variant } : {}),
    ...(phase ? { phase } : {}),
    ...(operation ? { operation } : {}),
    risks: cleanRisks(record.risks),
    intents: cleanIntents(record.intents),
    plan: cleanPlan(record.plan),
    workstreams: cleanWorkstreams(record.workstreams),
  }
}

function cleanOperation(value: unknown): Workflow.Operation | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const surface = record.surface
  const action = record.action
  const surfaces = ["code", "test", "documentation", "config", "build", "dependency", "schema", "data", "ui", "git", "environment", "research", "design", "release"] as const
  const actions = ["inspect", "create", "edit", "refactor", "delete", "move", "generate", "review", "measure", "run", "download", "commit", "sync", "deploy", "rollback"] as const
  if (!surfaces.includes(surface as (typeof surfaces)[number]) || !actions.includes(action as (typeof actions)[number])) return undefined
  const targets = record.targets === undefined ? undefined : cleanTargets(record.targets)
  if (record.targets !== undefined && !targets) return undefined
   const intent = typeof record.intent === "string" ? Workflow.sanitizeLine(record.intent) : undefined
  const required = record.required === undefined ? undefined : typeof record.required === "boolean" ? record.required : undefined
  if (record.intent !== undefined && !intent || record.required !== undefined && required === undefined) return undefined
  return {
    surface: surface as Workflow.WorkSurface,
    action: action as Workflow.WorkAction,
    ...(targets ? { targets } : {}),
    ...(intent ? { intent } : {}),
    ...(required !== undefined ? { required } : {}),
  }
}

function parseOperationValue(value: unknown): Workflow.Operation | undefined {
  if (typeof value !== "string") return undefined
  const [surface, action] = value.split(":", 2)
  return cleanOperation({ surface, action })
}

function cleanTargets(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length > 16) return undefined
  const targets = value.flatMap((item) => (typeof item === "string" && item.trim() ? [item.trim()] : []))
  return targets.length === value.length ? [...new Set(targets)] : undefined
}

export function parseHeaderWrapper(
  input: string,
  context: { storedWorkflow?: string; storedPhases?: readonly Workflow.Phase[] } = {},
): HeaderWrapperResult {
  const document = Wrapper.parseWrapper(input)
  const required = Wrapper.requireKeys(document, ["topic", "workflow"])
  if (required.length > 0) return { errors: required }

  const header = parseHeader(
    {
      topic: Wrapper.value(document, "topic"),
      strategies: Wrapper.values(document, "playbook"),
      risks: Wrapper.values(document, "risk"),
      intents: Wrapper.values(document, "intent"),
      workflow: Wrapper.value(document, "workflow"),
      variant: Wrapper.value(document, "variant"),
      phase: Wrapper.value(document, "phase"),
      reason: Wrapper.value(document, "reason"),
      operation: parseOperationValue(Wrapper.value(document, "operation")),
    },
    context,
  )
  const errors: WrapperError[] = []
  if (!header.topic)
    errors.push({ key: "topic", message: "topic must be a concrete two to six word label" })
  if (!header.workflowName)
    errors.push({ key: "workflow", message: "workflow must name a known workflow" })
  return errors.length > 0 ? { errors } : { header, errors: [] }
}

export function stageRows(header: Header): ("topic" | "optimize" | "thinking" | "workflow" | "guard")[] {
  const rows: ("topic" | "optimize" | "thinking" | "workflow" | "guard")[] = ["topic", "optimize", "thinking"]
  if (header.workflowName || header.phase) rows.push("workflow")
  rows.push("guard")
  return rows
}

export type TierPick = { readonly tier: GateTier }

export function tierFor(phases: number): GateTier {
  return phases >= 5 ? "full" : "standard"
}

export * as Header from "./header"
