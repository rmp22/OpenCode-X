export type SearchSourceKind = "CANONICAL" | "WORKTREE" | "MIRROR" | "INDEX" | "SNAPSHOT"

export type SearchSource = {
  readonly repositoryId: string
  readonly requestedRoot: string
  readonly effectiveRoot: string
  readonly revision: string
  readonly dirtyStateFingerprint: string
  readonly sourceKind: SearchSourceKind
  readonly freshness: "FRESH" | "STALE"
  readonly pathMapping?: string
}

export type SearchCapability = {
  readonly id: string
  readonly callable: string
  readonly supportedRoots: readonly string[]
  readonly rootPolicy: "EXACT" | "PREFIX" | "ANY"
  readonly supportsExactFiles: boolean
  readonly supportsDirectories: boolean
  readonly supportsRecursive: boolean
  readonly supportsGlobs: boolean
  readonly supportsRegex: boolean
  readonly supportsStdinFilter: boolean
  readonly sourceIdentityMode: "EXACT" | "MIRROR_ALLOWED"
  readonly freshnessMode: "FRESH_ONLY" | "STALE_OK"
  readonly maxScopeCost: ScopeCost
}

export type ScopeCost = "EXACT_FILE" | "SMALL_SCOPE" | "WORKING_SET" | "MODULE_SCOPE" | "LARGE_SCOPE" | "REPOSITORY_ROOT" | "CROSS_REPOSITORY"

export type SearchIntent =
  | "SEARCH_EXACT_FILES"
  | "SEARCH_DIRECTORY_RECURSIVE"
  | "SEARCH_WORKING_SET"
  | "SEARCH_INDEX"
  | "SEARCH_PATH_NAMES"
  | "FILTER_STREAM_TEXT"
  | "COMMAND_INTROSPECTION"
  | "READ_KNOWN_FILE"

export type ShellEffect = "READ" | "FILESYSTEM_WRITE" | "PROCESS_READ_ONLY" | "UNKNOWN" | "POTENTIALLY_EXPENSIVE_SEARCH"

export type SearchRoutingDecision = {
  readonly route: "DEDICATED" | "SHELL_RG" | "READ" | "INDEX" | "BLOCKED"
  readonly reason: string
  readonly requestedScope: string
  readonly effectiveScope: string
  readonly scopeWasRemapped: boolean
  readonly capability?: string
  readonly fallback?: string
}

export type SourceRegistryEntry = {
  readonly id: string
  readonly path: string
  readonly repositoryIdentity: string
  readonly revision: string
  readonly kind: SearchSourceKind
  readonly authoritativeFor: readonly string[]
  readonly searchableBy: readonly string[]
  readonly sizeProfile: "SMALL" | "MEDIUM" | "LARGE" | "HUGE"
}

const SOURCE_REGISTRY = new Map<string, SourceRegistryEntry>()

export function registerSource(entry: SourceRegistryEntry): void {
  SOURCE_REGISTRY.set(entry.id, entry)
}

export function getSource(id: string): SourceRegistryEntry | undefined {
  return SOURCE_REGISTRY.get(id)
}

export function clearRegistry(): void {
  SOURCE_REGISTRY.clear()
}

export function isGitGrepHistoricalOrIndex(command: string): boolean {
  const trimmed = command.trim()
  if (!/\bgit\s+grep\b/.test(trimmed)) return false
  if (/--cached|--staged/.test(trimmed)) return true

  const tokens = trimmed.split(/\s+/).filter(Boolean)
  const grepIdx = tokens.findIndex((t, idx) => t === "grep" && idx > 0 && tokens[idx - 1] === "git")
  if (grepIdx === -1) return false

  const args = tokens.slice(grepIdx + 1)
  const dashDashIdx = args.indexOf("--")
  const revCandidates = dashDashIdx !== -1
    ? args.slice(1, dashDashIdx).filter((a) => !a.startsWith("-"))
    : args.filter((a) => !a.startsWith("-")).slice(1)

  for (const candidate of revCandidates) {
    if (
      candidate === "HEAD" ||
      candidate.startsWith("HEAD~") ||
      candidate.startsWith("HEAD^") ||
      candidate.startsWith("origin/") ||
      candidate.includes("..") ||
      candidate.includes("~") ||
      candidate.includes("^") ||
      /^[0-9a-f]{7,40}$/i.test(candidate)
    ) {
      return true
    }
  }
  return false
}

export function isGenuineGitSearch(command: string): boolean {
  const trimmed = command.trim()
  if (/^\s*git\s+(diff|show|log\s+-[SG]|log\b)/.test(trimmed)) return true
  if (isGitGrepHistoricalOrIndex(trimmed)) return true
  return false
}

export function isWorkspaceSearchCommand(command: string): boolean {
  const trimmed = command.trim()
  if (isGenuineGitSearch(trimmed)) return false
  if (/\bgit\s+grep\b/.test(trimmed)) return true
  if (/\bgrep\s+(-[a-zA-Z]*[rR][a-zA-Z]*|--recursive)\b/.test(trimmed)) return true
  if (/\bfind\b/.test(trimmed) && (/(-exec\s+grep\b|xargs\s+(grep|rg)\b)/.test(trimmed))) return true
  if (/^\s*rg\b/.test(trimmed)) {
    if (/--version|--help/.test(trimmed)) return false
    return true
  }
  return false
}

export function classifySearchIntent(input: { command: string; args: string[]; hasPipe: boolean; pipeSource?: string }): SearchIntent {
  const cmd = input.command.trim()

  if (isGenuineGitSearch(cmd)) {
    return "SEARCH_EXACT_FILES"
  }

  if (input.hasPipe) {
    if (cmd.includes("rg ") && (input.pipeSource?.startsWith("git ") || input.pipeSource?.startsWith("ls ") || input.pipeSource?.includes("diff"))) {
      return "FILTER_STREAM_TEXT"
    }
    if (/rg/.test(cmd) && input.pipeSource) return "FILTER_STREAM_TEXT"
  }

  if (/rg\s+--version/.test(cmd) || /rg\s+--help/.test(cmd)) return "COMMAND_INTROSPECTION"

  const rgArgs = parseRgArgs(cmd)
  if (rgArgs.explicitFiles.length > 0 && rgArgs.directories.length === 0) return "SEARCH_EXACT_FILES"
  if (rgArgs.directories.length > 0) return "SEARCH_DIRECTORY_RECURSIVE"
  if (/^(grep|rg)\s/.test(cmd) && !input.hasPipe) {
    if (rgArgs.explicitFiles.length === 0 && rgArgs.directories.length === 0) return "SEARCH_WORKING_SET"
  }

  return "SEARCH_DIRECTORY_RECURSIVE"
}

export function classifyShellEffect(command: string): readonly ShellEffect[] {
  const trimmed = command.trim()

  if (/rg\s+--version/.test(trimmed) || /rg\s+--help/.test(trimmed)) return ["PROCESS_READ_ONLY"]
  if (/^\s*rg\s+/.test(trimmed) && !/[><]/.test(trimmed) && !/tee\s/.test(trimmed) && !/sed\s+-i/.test(trimmed)) {
    if (/\|\s*rg/.test(trimmed) || /git\s+diff\s*\|/.test(trimmed) || /ls\s*\|/.test(trimmed)) return ["READ"]
    return ["READ"]
  }
  if (/git\s+diff\s*\|/.test(trimmed) && /rg/.test(trimmed)) return ["READ"]
  if (/ls\s*\|/.test(trimmed) && /rg/.test(trimmed)) return ["READ"]
  if (/[>]{1,2}\s*\//.test(trimmed) || /\btee\b/.test(trimmed) || /\bsed\s+-i/.test(trimmed) || /\bperl\s+-pi/.test(trimmed)) return ["FILESYSTEM_WRITE"]
  if (/\bmv\b|\bcp\b|\brm\b|\binstall\b|\btruncate\b/.test(trimmed)) return ["FILESYSTEM_WRITE"]
  if (trimmed.includes("|") && !/rg/.test(trimmed)) {
    const hasWrite = /[>]{1,2}/.test(trimmed) || /\btee\b/.test(trimmed)
    if (hasWrite) return ["FILESYSTEM_WRITE"]
    return ["READ"]
  }
  if (trimmed.includes("|")) return ["READ"]
  if (/^rg\s/.test(trimmed)) return ["READ"]

  return ["UNKNOWN"]
}

export function parseRgArgs(command: string): { patterns: string[]; explicitFiles: string[]; directories: string[]; globs: string[]; maxDepth?: number } {
  const patterns: string[] = []
  const explicitFiles: string[] = []
  const directories: string[] = []
  const globs: string[] = []

  const parts = command.split(/\s+/).filter(Boolean)
  let i = 0
  while (i < parts.length) {
    const part = parts[i]
    if (part === "rg" || part === "grep") {
      i++
      continue
    }
    if (part.startsWith("-")) {
      if (part === "-g" || part === "--glob") {
        const next = parts[i + 1]
        if (next) globs.push(next)
        i += 2
        continue
      }
      if (part.startsWith("--max-depth")) {
        i += 2
        continue
      }
      i++
      continue
    }
    if (patterns.length === 0 && !part.includes("/") && !part.includes(".")) {
      patterns.push(part)
    } else if (part.includes(".")) {
      explicitFiles.push(part)
    } else {
      directories.push(part)
    }
    i++
  }

  return { patterns, explicitFiles, directories, globs }
}

export function estimateScopeCost(input: { roots: readonly string[]; explicitFiles: readonly string[]; directories: readonly string[]; repositorySize: "SMALL" | "MEDIUM" | "LARGE" | "HUGE" }): ScopeCost {
  if (input.explicitFiles.length > 0 && input.directories.length === 0) return "EXACT_FILE"
  if (input.roots.length === 0) return "SMALL_SCOPE"
  if (input.directories.length > 0 && input.repositorySize === "HUGE") return "LARGE_SCOPE"
  if (input.directories.length > 0) return "MODULE_SCOPE"
  return "SMALL_SCOPE"
}

export function canDedicatedSearchSource(requestedRoot: string, capability: SearchCapability): boolean {
  if (capability.supportedRoots.length === 0) return false
  if (capability.rootPolicy === "ANY") return true
  if (capability.rootPolicy === "EXACT") return capability.supportedRoots.includes(requestedRoot)
  if (capability.rootPolicy === "PREFIX") return capability.supportedRoots.some((r) => requestedRoot.startsWith(r))
  return false
}

export function routeSearch(input: {
  requestedScope: string
  intent: SearchIntent
  dedicatedCapability?: SearchCapability
  source: SearchSource
  shellAllowed: boolean
}): SearchRoutingDecision {
  if (input.intent === "COMMAND_INTROSPECTION") {
    return {
      route: "SHELL_RG",
      reason: "`rg --version` is command introspection, not repository search.",
      requestedScope: input.requestedScope,
      effectiveScope: input.requestedScope,
      scopeWasRemapped: false,
    }
  }

  if (input.intent === "FILTER_STREAM_TEXT") {
    return {
      route: "SHELL_RG",
      reason: "`rg` is filtering existing command output, not scanning the repository.",
      requestedScope: input.requestedScope,
      effectiveScope: input.requestedScope,
      scopeWasRemapped: false,
    }
  }

  if (input.intent === "SEARCH_EXACT_FILES") {
    if (input.dedicatedCapability?.supportsExactFiles) {
      const canSearch = canDedicatedSearchSource(input.requestedScope, input.dedicatedCapability)
      if (canSearch) {
        return {
          route: "DEDICATED",
          reason: "Exact-file search is read-only and bounded.",
          requestedScope: input.requestedScope,
          effectiveScope: input.requestedScope,
          scopeWasRemapped: false,
          capability: input.dedicatedCapability.id,
        }
      }
      if (input.shellAllowed) {
        return {
          route: "SHELL_RG",
          reason: "Dedicated repository search cannot access the requested authoritative root.",
          requestedScope: input.requestedScope,
          effectiveScope: input.requestedScope,
          scopeWasRemapped: false,
          fallback: "shell rg is the only faithful safe route",
        }
      }
      return {
        route: "BLOCKED",
        reason: "SEARCH_SCOPE_UNSUPPORTED",
        requestedScope: input.requestedScope,
        effectiveScope: input.requestedScope,
        scopeWasRemapped: false,
      }
    }
    if (input.shellAllowed) {
      return {
        route: "SHELL_RG",
        reason: "Exact-file search is read-only and bounded. Search allowed.",
        requestedScope: input.requestedScope,
        effectiveScope: input.requestedScope,
        scopeWasRemapped: false,
      }
    }
  }

  if (input.dedicatedCapability && canDedicatedSearchSource(input.requestedScope, input.dedicatedCapability)) {
    if (input.source.freshness === "STALE" && input.dedicatedCapability.freshnessMode === "FRESH_ONLY") {
      return {
        route: "BLOCKED",
        reason: "SEARCH_INDEX_STALE",
        requestedScope: input.requestedScope,
        effectiveScope: input.requestedScope,
        scopeWasRemapped: false,
      }
    }
    return {
      route: "DEDICATED",
      reason: "Dedicated search can faithfully search requested source",
      requestedScope: input.requestedScope,
      effectiveScope: input.requestedScope,
      scopeWasRemapped: false,
      capability: input.dedicatedCapability.id,
    }
  }

  if (input.dedicatedCapability && !canDedicatedSearchSource(input.requestedScope, input.dedicatedCapability)) {
    if (input.shellAllowed) {
      return {
        route: "SHELL_RG",
        reason: "Dedicated repository search cannot access the requested authoritative root. Use source-faithful fallback.",
        requestedScope: input.requestedScope,
        effectiveScope: input.requestedScope,
        scopeWasRemapped: false,
        fallback: "shell rg",
      }
    }
    return {
      route: "BLOCKED",
      reason: "SEARCH_SCOPE_UNSUPPORTED",
      requestedScope: input.requestedScope,
      effectiveScope: input.requestedScope,
      scopeWasRemapped: false,
    }
  }

  if (input.shellAllowed) {
    return {
      route: "SHELL_RG",
      reason: "No dedicated route; shell rg is the faithful safe route",
      requestedScope: input.requestedScope,
      effectiveScope: input.requestedScope,
      scopeWasRemapped: false,
    }
  }

  return {
    route: "BLOCKED",
    reason: "CAPABILITY_UNAVAILABLE",
    requestedScope: input.requestedScope,
    effectiveScope: input.requestedScope,
    scopeWasRemapped: false,
  }
}

export function isSilentRemap(requested: string, effective: string): boolean {
  return requested !== effective
}

export function searchResultMetadata(input: {
  requestedScope: string
  effectiveScope: string
  repositoryId: string
  revision: string
  matchCount: number
  truncation?: boolean
  freshness: string
}): { requestedScope: string; effectiveScope: string; scopeWasRemapped: boolean; warning?: string } {
  const remapped = input.requestedScope !== input.effectiveScope
  return {
    requestedScope: input.requestedScope,
    effectiveScope: input.effectiveScope,
    scopeWasRemapped: remapped,
    ...(remapped ? { warning: `Search was remapped from ${input.requestedScope} to ${input.effectiveScope}` } : {}),
  }
}

export function noFilesFoundSemantics(input: { requestedWasSearched: boolean }): "NO_FILES" | "SEARCH_SCOPE_UNSUPPORTED" {
  if (!input.requestedWasSearched) return "SEARCH_SCOPE_UNSUPPORTED"
  return "NO_FILES"
}

export function isSemanticRetry(previous: string, current: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/--no-messages/g, "").replace(/\s+/g, " ").trim().replace(/\brg\b/g, "grep")
  return norm(previous) === norm(current)
}

export function normalizeRgCommand(command: string): string {
  return command.replace(/\s+/g, " ").trim().replace(/--no-messages\s*/g, "").replace(/\brg\b/g, "grep")
}

export * as SearchRouting from "./search-routing"