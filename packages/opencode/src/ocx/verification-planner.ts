import type { CheckKind } from "./ledger"
import { matchExpect } from "./ledger"
import { Requirements } from "./requirements"
import { TaskGraph } from "./task-graph"

export type PlannerInput = {
  readonly changedPaths: readonly string[]
  readonly commandByKind?: Partial<Record<CheckKind, string>>
  readonly testEvidence?: boolean
  readonly graph?: TaskGraph.Graph
  readonly requirements?: readonly Requirements.Record[]
  readonly priorFailures?: readonly CheckKind[]
}

export type PlannedCheck = {
  readonly kind: CheckKind
  readonly command?: string
  readonly reasons: readonly string[]
}

export type Plan = {
  readonly checks: readonly PlannedCheck[]
  readonly pendingRequirementIDs: readonly string[]
  readonly visualCheck?: { readonly reason: string; readonly guidance: string }
}

const WEB_ARTIFACT = /\.(?:html?|css)$/i

const ORDER: readonly CheckKind[] = ["lint", "typecheck", "test", "build"]
const SOURCE_PATH = /\.(?:c|cc|cpp|css|go|html?|java|js|jsx|kt|mjs|py|rs|swift|ts|tsx)$/i
const TEST_PATH = /(?:^|\/)(?:tests?|__tests__)(?:\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$|_test\.(?:go|py)$/i
const BUILD_PATH = /(?:^|\/)(?:package\.json|(?:bun|pnpm|yarn|package-lock)\.lock(?:b)?|Cargo\.toml|go\.mod|pom\.xml|build\.gradle(?:\.kts)?|Makefile)$/i
const LINT_PATH = /(?:^|\/)(?:\.eslintrc(?:\.[^/]+)?|biome\.json|ruff\.toml|pyproject\.toml|\.golangci\.ya?ml)$/i
const MAX_REASON = 200
const MAX_REQUIREMENTS = 24

function clean(value: string): string {
  return value.replaceAll("===", "").replaceAll(/\s+/g, " ").trim().slice(0, MAX_REASON)
}

function addReason(reasons: Map<CheckKind, string[]>, kind: CheckKind, reason: string): void {
  const value = clean(reason)
  if (!value) return
  const current = reasons.get(kind) ?? []
  if (!current.includes(value)) reasons.set(kind, [...current, value].slice(0, 4))
}

function sourceChanged(paths: readonly string[]): boolean {
  return paths.some((path) => SOURCE_PATH.test(path))
}

function testChanged(paths: readonly string[]): boolean {
  return paths.some((path) => TEST_PATH.test(path))
}

function addAcceptanceReasons(reasons: Map<CheckKind, string[]>, graph: TaskGraph.Graph | undefined): void {
  for (const node of graph?.nodes ?? []) {
    if (node.kind !== "task" || node.status === "completed" || node.status === "cancelled" || node.status === "superseded") continue
    for (const acceptance of node.acceptanceCriteria) {
      const kind = matchExpect(acceptance)
      if (kind) addReason(reasons, kind, `task ${node.id} accepts ${kind}: ${acceptance}`)
    }
  }
}

export function plan(input: PlannerInput): Plan {
  const reasons = new Map<CheckKind, string[]>()
  const paths = input.changedPaths.map(clean).filter(Boolean)
  const hasSource = sourceChanged(paths)
  if (hasSource) {
    addReason(reasons, "lint", "source files changed")
    addReason(reasons, "typecheck", "source files changed")
  }
  if (input.testEvidence === true || testChanged(paths)) addReason(reasons, "test", "test evidence changed or was discovered")
  if (paths.some((path) => BUILD_PATH.test(path))) addReason(reasons, "build", "build configuration or dependency metadata changed")
  if (paths.some((path) => LINT_PATH.test(path))) addReason(reasons, "lint", "lint configuration changed")
  addAcceptanceReasons(reasons, input.graph)
  for (const kind of input.priorFailures ?? []) addReason(reasons, kind, `previous ${kind} check failed`)

  const checks = ORDER.flatMap((kind) => {
    const values = reasons.get(kind)
    if (!values) return []
    const command = input.commandByKind?.[kind]
    return [{ kind, ...(command ? { command } : {}), reasons: values }]
  })
  const pendingRequirementIDs = Requirements.pendingVerification(input.requirements ?? [])
    .map((item) => item.id)
    .slice(0, MAX_REQUIREMENTS)
  const visualCheck = paths.some((path) => WEB_ARTIFACT.test(path))
    ? {
        reason: "web artifact changed",
        guidance:
          "Batch asset downloads in one shell loop, fix all dead links in one multi-edit, then capture screenshot or browser evidence before claiming visual success",
      }
    : undefined
  return { checks, pendingRequirementIDs, ...(visualCheck ? { visualCheck } : {}) }
}

export function render(planValue: Plan, maxChars = 1_600): string {
  if (planValue.checks.length === 0 && planValue.pendingRequirementIDs.length === 0 && !planValue.visualCheck) return ""
  const lines = [
    "=== OCX VERIFICATION PLAN ===",
    ...planValue.checks.map((check) => `- ${check.kind}${check.command ? `: ${clean(check.command)}` : ""} - ${check.reasons.join("; ")}`),
    ...(planValue.pendingRequirementIDs.length > 0
      ? [`Unverified requirements: ${planValue.pendingRequirementIDs.join(", ")}`]
      : []),
    ...(planValue.visualCheck ? [`- visual - ${planValue.visualCheck.reason}: ${planValue.visualCheck.guidance}`] : []),
    "Run the cheapest listed checks that are available, then record the result before claiming completion.",
    "=== END OCX VERIFICATION PLAN ===",
  ]
  return lines.join("\n").slice(0, maxChars)
}

export * as VerificationPlanner from "./verification-planner"
