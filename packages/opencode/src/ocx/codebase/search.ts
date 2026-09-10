import path from "node:path"
import { familyForCommand, familyForTool, equivalentFailure } from "./history"
import { rankCandidates } from "./working-set"
import type {
  CodebaseConfig,
  GuardAction,
  RepositoryMap,
  RepositoryProfile,
  SearchCandidate,
  SearchFamily,
  SearchGuardDecision,
  SearchIntent,
  SearchPlan,
  SearchRequest,
  SearchRoute,
  WorkingSet,
} from "./types"
import type { SearchRecord } from "./types"
import { classifyPath } from "./profile"

export type PlanInput = {
  readonly root: string
  readonly request: SearchRequest
  readonly profile: RepositoryProfile
  readonly map: RepositoryMap
  readonly workingSet?: WorkingSet
  readonly pathIndexAvailable?: boolean
}

export type GuardInput = {
  readonly route: SearchRoute
  readonly profile: RepositoryProfile
  readonly config: CodebaseConfig
  readonly recommendedScopes?: readonly string[]
}

export type ShellSearch = {
  readonly family: SearchFamily
  readonly recursive: boolean
  readonly scope?: string
  readonly explicitRepositoryWide: boolean
}

const INTENT_WORDS: ReadonlyArray<readonly [SearchIntent, RegExp]> = [
  ["DEFINITION", /\b(?:where|find)\b.*\b(?:defined|declared|definition)\b|\bdefinition\b|\bdeclared\b/i],
  ["REFERENCE", /\breferences?\b|\busages?\b|\bcallers?\b|\bimporters?\b/i],
  ["IMPLEMENTATION", /\bimplementation\b|\bimplemented\b|\bsource for\b/i],
  ["CONFIG", /\bconfig(?:uration)?\b|\bsettings?\b|\benvironment\b|\.(?:json|yaml|yml|toml|ini)\b/i],
  ["BUILD_TARGET", /\b(?:build target|bazel|buck|gradle|maven|cargo|cmake|make target)\b/i],
  ["DEPENDENCY", /\bdependenc(?:y|ies)\b|\bvendor(?:ed)?\b|\bthird[_ -]?party\b|\bimport\b/i],
  ["TEST", /\btests?\b|\bspecs?\b|\bfixtures?\b|\bregression\b/i],
  ["OWNERSHIP", /\bowner(?:ship)?\b|\bmaintainer\b|\bwho owns\b/i],
  ["HISTORY", /\bhistory\b|\bintroduced\b|\bblame\b|\bcommit\b/i],
  ["PATH", /\bpath\b|\bfilename\b|\bdirectory\b|\bfolder\b|\bwhere is\b/i],
  ["FILE", /\bfile\b|\.(?:c|cc|cpp|go|h|java|js|json|kt|md|py|rs|sh|sql|ts|tsx|xml|yaml|yml)\b/i],
]

const INDEX_INTENTS = new Set<SearchIntent>(["FILE", "PATH", "DEFINITION", "REFERENCE", "TEST", "BUILD_TARGET"])
const EXCLUDED_CLASSES = new Set([
  "GENERATED",
  "BUILD_OUTPUT",
  "DEPENDENCY",
  "VENDOR",
  "PREBUILT",
  "CACHE",
  "VCS_METADATA",
])

export function classifyIntent(input: {
  readonly query: string
  readonly intent?: SearchRequest["intent"]
}): SearchIntent[] {
  const explicit = Array.isArray(input.intent) ? input.intent : input.intent ? [input.intent] : []
  if (explicit.length > 0) return [...new Set(explicit)]
  const found = INTENT_WORDS.flatMap(([intent, pattern]) => (pattern.test(input.query) ? [intent] : []))
  if (found.length > 0) return found
  if (/\b[A-Z][A-Za-z0-9_]*\b/.test(input.query)) return ["SYMBOL"]
  return ["TEXT"]
}

export function planSearch(input: PlanInput): SearchPlan {
  const root = path.resolve(input.root)
  const intent = classifyIntent(input.request)
  const candidates: SearchCandidate[] = []
  const add = (candidate: SearchCandidate) => {
    const scope = normalizeScope(root, candidate.scope)
    if (!scope || (EXCLUDED_CLASSES.has(candidate.pathClass) && !allowsExcluded(input.request, candidate.pathClass)))
      return
    if (candidates.some((item) => item.scope === scope)) return
    candidates.push({ ...candidate, scope })
  }

  if (input.request.currentFile) {
    add({
      scope: input.request.currentFile,
      level: 0,
      relevance: 1.2,
      estimatedCost: 1,
      pathClass: classifyPath(input.request.currentFile),
      reason: "current file was already identified",
      recursive: false,
    })
  }
  if (input.request.requestedScope) {
    add({
      scope: input.request.requestedScope,
      level: 1,
      relevance: 1.1,
      estimatedCost: costFor(input.request.requestedScope, 1),
      pathClass: classifyPath(input.request.requestedScope),
      reason: "the request supplied a search scope",
      recursive: !isFileScope(input.request.requestedScope),
    })
  }
  for (const item of input.workingSet?.directories ?? []) {
    add({
      scope: item.path,
      level: 1,
      relevance: 0.9 + item.confidence,
      estimatedCost: costFor(item.path, 1),
      pathClass: classifyPath(item.path),
      reason: `working set: ${item.reason}`,
      recursive: true,
    })
  }
  for (const item of input.workingSet?.modules ?? []) {
    add({
      scope: item.path,
      level: 2,
      relevance: 0.8 + item.confidence,
      estimatedCost: costFor(item.path, 2),
      pathClass: classifyPath(item.path),
      reason: `working module: ${item.reason}`,
      recursive: true,
    })
  }
  const terms = input.request.query
    .toLocaleLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((item) => item.length >= 3)
  for (const module of input.map.modules) {
    if (module.path === ".") continue
    const relevance = terms.some(
      (term) => module.path.toLocaleLowerCase().includes(term) || module.name.toLocaleLowerCase().includes(term),
    )
      ? 1.1
      : 0
    if (relevance === 0) continue
    add({
      scope: module.path,
      level: 2,
      relevance,
      estimatedCost: costFor(module.path, 2),
      pathClass: classifyPath(module.path),
      reason: "module name or path matches the request",
      recursive: true,
    })
  }
  for (const rootPath of input.profile.sourceRoots) {
    add({
      scope: rootPath,
      level: 3,
      relevance: intent.includes("TEST") ? 0.45 : 0.75,
      estimatedCost: costFor(rootPath, 3),
      pathClass: classifyPath(rootPath),
      reason: "profiled source root",
      recursive: true,
    })
  }
  for (const rootPath of input.map.testRoots) {
    if (!intent.includes("TEST")) continue
    add({
      scope: rootPath,
      level: 3,
      relevance: 0.8,
      estimatedCost: costFor(rootPath, 3),
      pathClass: "TEST",
      reason: "profiled test root matches test intent",
      recursive: true,
    })
  }
  if (input.request.explicitRepositoryWide) {
    add({
      scope: root,
      level: 5,
      relevance: 2,
      estimatedCost: input.profile.estimatedFileCount,
      pathClass: "SOURCE",
      reason: "explicit repository-wide request",
      recursive: true,
    })
  }
  if (candidates.length === 0) {
    add({
      scope: root,
      level: 5,
      relevance: 0.1,
      estimatedCost: input.profile.estimatedFileCount,
      pathClass: "SOURCE",
      reason: "conservative repository fallback",
      recursive: true,
    })
  }
  const ranked = input.workingSet
    ? rankCandidates(input.workingSet, candidates)
    : candidates.toSorted(compareCandidates)
  const selected = ranked[0] ?? candidates[0]
  return {
    intent,
    candidates: ranked,
    selected,
    likelyRoots: [
      ...new Set([
        ...input.profile.sourceRoots,
        ...input.map.sourceRoots,
        ...(input.workingSet?.directories.map((item) => item.path) ?? []),
      ]),
    ].slice(0, 32),
    excludedByDefault: [
      ...new Set([
        ...input.profile.generatedRoots,
        ...input.profile.dependencyRoots,
        "build",
        "dist",
        "target",
        "node_modules",
      ]),
    ].slice(0, 32),
  }
}

export function routeFor(
  plan: SearchPlan,
  input: {
    readonly family: SearchFamily
    readonly explicitRepositoryWide?: boolean
    readonly include?: string
    readonly pathIndexAvailable?: boolean
  },
): SearchRoute {
  const useIndex = input.pathIndexAvailable === true && plan.intent.some((intent) => INDEX_INTENTS.has(intent))
  return {
    family: useIndex ? "path_index" : input.family,
    scope: plan.selected.scope,
    recursive: useIndex ? false : plan.selected.recursive,
    intent: plan.intent,
    ...(input.include ? { include: input.include } : {}),
    explicitRepositoryWide: input.explicitRepositoryWide === true,
  }
}

export function guardSearch(input: GuardInput): SearchGuardDecision {
  const budget = input.config.budgets[input.profile.scale.toLocaleLowerCase() as keyof typeof input.config.budgets]
  const recommendedScopes = [...(input.recommendedScopes ?? [])].filter((scope) => scope.length > 0)
  if (!input.config.enabled || !input.route.recursive) return decision("ALLOW", budget, input.route, recommendedScopes)
  if (!isRepositoryRoot(input.route.scope, input.profile.root))
    return decision("ALLOW_WITH_BUDGET", budget, input.route, recommendedScopes)
  if (input.route.explicitRepositoryWide) return decision("ALLOW_WITH_BUDGET", budget, input.route, recommendedScopes)
  if (input.profile.scale === "SMALL") return decision("ALLOW_WITH_BUDGET", budget, input.route, recommendedScopes)
  if (input.profile.scale === "MEDIUM") return decision("ALLOW_WITH_BUDGET", budget, input.route, recommendedScopes)
  if (input.route.include && isNarrowInclude(input.route.include))
    return decision("ALLOW_WITH_BUDGET", budget, input.route, recommendedScopes)
  const replacement = recommendedScopes.find((scope) => !isRepositoryRoot(scope, input.profile.root))
  if (input.config.rewriteBroadSearches && replacement) {
    return {
      ...decision("REWRITE", budget, input.route, recommendedScopes),
      rewrittenScope: replacement,
      reason:
        input.profile.scale === "MASSIVE"
          ? "root recursive search narrowed on a massive repository"
          : "root recursive search narrowed to a likely scope",
    }
  }
  if (input.profile.scale === "MASSIVE" && input.config.blockMassiveRootRecursiveSearch)
    return {
      ...decision("BLOCK", budget, input.route, recommendedScopes),
      reason: "unrestricted root recursive search is blocked on a massive repository",
    }
  return {
    ...decision("BLOCK", budget, input.route, recommendedScopes),
    reason: "root recursive search requires a narrower scope on a large repository",
  }
}

export function searchCommand(command: string): ShellSearch | undefined {
  const value = command.trim()
  const family = familyForCommand(value)
  if (!family) return undefined
  const recursive = family === "recursive_path_scan" || /\b(?:rg|grep|egrep|fgrep)\b/.test(value)
  const paths = value
    .split(/\s+/)
    .filter(
      (item) =>
        item && !item.startsWith("-") && !/^(?:rg|grep|egrep|fgrep|find|fd)$/.test(item) && !/^['"].*['"]$/.test(item),
    )
  const scope = paths.length > 1 ? paths.at(-1) : undefined
  return {
    family,
    recursive,
    ...(scope ? { scope } : {}),
    explicitRepositoryWide: explicitFullSearch(value),
  }
}

export function explicitFullSearch(text: string): boolean {
  return /\b(?:entire|whole|full|all)\s+(?:repository|repo|codebase)\b|\brepository[- ]wide\b|\bfrom\s+repo(?:sitory)?\s+root\b/i.test(
    text,
  )
}

export function guardFailure(
  records: readonly SearchRecord[],
  input: {
    readonly query: string
    readonly scope: string
    readonly family: SearchFamily
    readonly repositoryRevision?: string
  },
): SearchRecord | undefined {
  return equivalentFailure(records, input)
}

export function renderBlocked(decision: SearchGuardDecision, failure?: SearchRecord): string {
  return [
    "SEARCH_BLOCKED",
    `reason: ${failure ? "EQUIVALENT_FAILED_SEARCH" : (decision.reason ?? "SEARCH_SCOPE_NOT_ALLOWED")}`,
    `recommended_scope: ${decision.recommendedScopes.length > 0 ? decision.recommendedScopes.join(", ") : "none"}`,
    "suggested_routes: path_index, working_set, scoped_search",
  ].join("\n")
}

export class SearchBlockedError extends Error {
  readonly decision: SearchGuardDecision
  readonly failure?: SearchRecord

  constructor(decision: SearchGuardDecision, failure?: SearchRecord) {
    super(renderBlocked(decision, failure))
    this.name = "SearchBlockedError"
    this.decision = decision
    this.failure = failure
  }
}

export class SearchTimeoutError extends Error {
  readonly timeoutMs: number

  constructor(timeoutMs: number) {
    super(`search exceeded hard timeout ${timeoutMs} ms`)
    this.name = "SearchTimeoutError"
    this.timeoutMs = timeoutMs
  }
}

function decision(
  action: GuardAction,
  budget: SearchGuardDecision["budget"],
  route: SearchRoute,
  recommendedScopes: readonly string[],
): SearchGuardDecision {
  return { action, budget, route, recommendedScopes }
}

function normalizeScope(root: string, value: string): string {
  const cleaned = value.trim().replaceAll("\\", "/")
  if (!cleaned) return ""
  if (cleaned === "." || cleaned === "/") return root
  const resolved = path.resolve(root, cleaned)
  return resolved === root ? root : resolved
}

function isRepositoryRoot(scope: string, root: string): boolean {
  return path.resolve(scope) === path.resolve(root) || scope === "repo_root" || scope === "."
}

function isFileScope(scope: string): boolean {
  return path.posix.basename(scope).includes(".")
}

function isNarrowInclude(include: string): boolean {
  const value = include.trim()
  return value.length > 0 && value !== "*" && value !== "**" && value !== "*.*" && !value.includes("**/")
}

function allowsExcluded(request: SearchRequest, pathClass: SearchCandidate["pathClass"]): boolean {
  if (pathClass !== "GENERATED" && pathClass !== "DEPENDENCY" && pathClass !== "VENDOR") return true
  if (request.explicitRepositoryWide) return true
  const query = request.query.toLocaleLowerCase()
  return ["generated", "vendor", "third_party", "dependency", "node_modules", "dist", "build"].some((term) =>
    query.includes(term),
  )
}

function costFor(scope: string, level: number): number {
  const depth = scope.split(/[\\/]/).filter(Boolean).length
  return Math.max(1, (depth + 1) * (level + 1) * 10)
}

function compareCandidates(a: SearchCandidate, b: SearchCandidate): number {
  return (
    b.relevance - a.relevance ||
    a.estimatedCost - b.estimatedCost ||
    a.level - b.level ||
    a.scope.localeCompare(b.scope)
  )
}

export { familyForTool }

export * as CodebaseSearch from "./search"
