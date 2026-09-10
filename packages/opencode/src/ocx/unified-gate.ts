import { ScopePermit } from "./scope-permit"
export const EFFECTS = [
  "NONE",
  "FILESYSTEM_READ",
  "FILESYSTEM_WRITE",
  "REPOSITORY_MUTATION",
  "PROCESS_EXECUTION",
  "NETWORK_READ",
  "NETWORK_WRITE",
  "BUILD_MUTATION",
  "PACKAGE_INSTALL",
  "read_file",
  "search_repo",
  "search_web",
  "delegate",
  "mutate_source",
  "mutate_test",
  "mutate_document",
  "mutate_config",
  "mutate_schema",
  "mutate_data",
  "mutate_build",
  "mutate_dependency",
  "mutate_environment",
  "mutate_infrastructure",
  "run_lint",
  "run_typecheck",
  "run_test",
  "run_build",
  "run_benchmark",
  "git_stage",
  "git_commit",
  "git_sync",
  "deploy",
  "rollback",
] as const

export type Effect = (typeof EFFECTS)[number]

export type WorkflowContext = {
  readonly workflow?: string
  readonly phase?: string
  readonly phases?: ReadonlyArray<{ readonly id: string; readonly gate?: string }>
  readonly epoch?: string | number
  readonly toolsetVersion?: number
}

export type AuthRequest = {
  readonly tool?: string
  readonly capability?: string
  readonly effects: readonly Effect[]
  readonly paths: readonly string[]
  readonly ambiguous?: boolean
  readonly command?: string
  readonly cwd?: string
}

export type SanctionedFix = {
  readonly tool: string
  readonly args: string
  readonly target?: string
}

export type AuthDecision =
  | { readonly allowed: true; readonly scopeAuthorized: boolean }
  | {
      readonly allowed: false
      readonly code: "OUT_OF_SCOPE" | "PHASE_GATED"
      readonly reason: string
      readonly fix: SanctionedFix
      readonly advance: string | undefined
    }

function cwdOf(request: AuthRequest): string {
  return request.cwd ?? process.cwd()
}

function pathsInScope(paths: readonly string[], permit: ScopePermit | undefined, cwd: string): boolean {
  if (paths.length === 0) return false
  if (!permit) return false
  return paths.every((candidate) => ScopePermit.isPathAllowed(candidate, permit, cwd))
}

function pathsTmpOnly(paths: readonly string[]): boolean {
  if (paths.length === 0) return false
  return paths.every((candidate) => ScopePermit.isTmpOutput(candidate))
}

function writeEffectsOnly(effects: readonly Effect[]): boolean {
  return effects.every((effect) => effect === "FILESYSTEM_WRITE" || effect === "NONE" || effect === "FILESYSTEM_READ" || effect === "NETWORK_READ")
}

function effectAllowed(_context: WorkflowContext | undefined, _effect: Effect): boolean {
  return true
}

function advanceHint(_context: WorkflowContext | undefined): string | undefined {
  return undefined
}

export function authorize(
  request: AuthRequest,
  context: WorkflowContext | undefined,
  permit: ScopePermit | undefined,
): AuthDecision {
  const cwd = cwdOf(request)
  if (!context) return { allowed: true, scopeAuthorized: false }
  if (context.workflow === "freeform") return { allowed: true, scopeAuthorized: true }
  if (pathsTmpOnly(request.paths)) return { allowed: true, scopeAuthorized: false }
  if (writeEffectsOnly(request.effects) && pathsInScope(request.paths, permit, cwd))
    return { allowed: true, scopeAuthorized: true }
  const outOfScope =
    permit !== undefined &&
    request.paths.length > 0 &&
    request.paths.some((candidate) => !ScopePermit.isPathAllowed(candidate, permit, cwd))
  const denied = request.effects.filter((effect) => !effectAllowed(context, effect))
  const ambiguousDenied = false
  if (denied.length === 0 && !ambiguousDenied && !outOfScope) return { allowed: true, scopeAuthorized: false }
  const firstPath = request.paths[0]
  const isDir = request.command ? /\b(?:mkdir|md)\b/.test(request.command) : false
  const fix: SanctionedFix =
    firstPath !== undefined
      ? isDir
        ? {
            tool: "ocx_plan",
            args: `advance to execution phase with ocx_plan to authorize directory creation for ${firstPath}`,
            target: firstPath,
          }
        : {
            tool: "write",
            args: `${firstPath} with the intended content (in-scope file writes are authorized; shell redirects are not)`,
            target: firstPath,
          }
      : {
          tool: "read",
          args: "continue with a read-only action (read, glob, grep) until the plan is accepted",
        }
  return {
    allowed: false,
    code: outOfScope ? "OUT_OF_SCOPE" : "PHASE_GATED",
    reason: outOfScope
      ? `Write target is outside the permitted scope (${permit?.roots.join(", ") ?? "none"}).`
      : "The requested write is not covered by an in-scope permit for the current task stage.",
    fix,
    advance: advanceHint(context),
  }
}

export function validateCompletion(
  checks: readonly { readonly status: string; readonly command?: string }[],
): { readonly allowed: boolean; readonly reason?: string } {
  if (checks.length === 0) {
    const res = {
      allowed: false,
      reason: "Cannot emit STATE: done without required verification checks",
    }
    return res
  }
  const pendingOrFailed = checks.filter((c) => c.status !== "PASS")
  if (pendingOrFailed.length > 0) {
    const res = {
      allowed: false,
      reason: `${pendingOrFailed.length} check(s) not passed: ${pendingOrFailed.map((c) => c.command ?? c.status).join(", ")}`,
    }
    return res
  }
  const passRes = { allowed: true }
  return passRes
}

export * as UnifiedGate from "./unified-gate"
