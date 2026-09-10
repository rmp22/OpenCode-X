import { describe, expect, test } from "bun:test"
import { classifySearchIntent, classifyShellEffect, parseRgArgs, estimateScopeCost, routeSearch, isSilentRemap, searchResultMetadata, noFilesFoundSemantics, isSemanticRetry, isGitGrepHistoricalOrIndex, isGenuineGitSearch, isWorkspaceSearchCommand } from "../../src/ocx/search-routing"

describe("Search Routing & Source Integrity", () => {
  test("exact file rg is classified read-only", () => {
    const eff = classifyShellEffect("rg -n foo file.ts")
    expect(eff).toContain("READ")
    expect(eff).not.toContain("FILESYSTEM_WRITE")
  })

  test("exact file in massive repo is not classified root recursive", () => {
    const cost = estimateScopeCost({ roots: ["/repo"], explicitFiles: ["src/file.ts"], directories: [], repositorySize: "HUGE" })
    expect(cost).toBe("EXACT_FILE")
  })

  test("directory rg receives scope-cost classification", () => {
    const cost = estimateScopeCost({ roots: ["/repo"], explicitFiles: [], directories: ["src/"], repositorySize: "HUGE" })
    expect(cost).toBe("LARGE_SCOPE")
  })

  test("rg --version is introspection", () => {
    const intent = classifySearchIntent({ command: "rg --version", args: [], hasPipe: false })
    expect(intent).toBe("COMMAND_INTROSPECTION")
    const eff = classifyShellEffect("rg --version")
    expect(eff).toContain("PROCESS_READ_ONLY")
  })

  test("git diff | rg is stream filtering", () => {
    const intent = classifySearchIntent({ command: "rg pattern", args: ["pattern"], hasPipe: true, pipeSource: "git diff" })
    expect(intent).toBe("FILTER_STREAM_TEXT")
    const eff = classifyShellEffect("git diff | rg pattern")
    expect(eff).toContain("READ")
  })

  test("ls | rg is stream filtering", () => {
    const intent = classifySearchIntent({ command: "rg pattern", args: ["pattern"], hasPipe: true, pipeSource: "ls dir" })
    expect(intent).toBe("FILTER_STREAM_TEXT")
  })

  test("pipe alone does not imply write", () => {
    const eff = classifyShellEffect("ls | rg foo")
    expect(eff).not.toContain("FILESYSTEM_WRITE")
    expect(eff).toContain("READ")
  })

  test("uncertain effect does not become FILESYSTEM_WRITE", () => {
    const eff = classifyShellEffect("rg pattern file1 file2")
    expect(eff).not.toContain("FILESYSTEM_WRITE")
    expect(eff).toContain("READ")
  })

  test("requested ROM path cannot silently return worktree matches", () => {
    expect(isSilentRemap("/workspace/external-repo/frameworks/base", "/workspace/target-project/.research-worktrees/base")).toBe(true)
    const meta = searchResultMetadata({
      requestedScope: "/workspace/external-repo",
      effectiveScope: "/workspace/.research-worktrees",
      repositoryId: "aosp",
      revision: "v1",
      matchCount: 5,
      freshness: "STALE",
    })
    expect(meta.scopeWasRemapped).toBe(true)
    expect(meta.warning).toBeDefined()
  })

  test("unsupported dedicated root returns SEARCH_SCOPE_UNSUPPORTED", () => {
    const decision = routeSearch({
      requestedScope: "/workspace/external-repo",
      intent: "SEARCH_EXACT_FILES",
      dedicatedCapability: {
        id: "search.text",
        callable: "grep",
        supportedRoots: ["/workspace/.research-worktrees"],
        rootPolicy: "EXACT",
        supportsExactFiles: true,
        supportsDirectories: true,
        supportsRecursive: true,
        supportsGlobs: true,
        supportsRegex: true,
        supportsStdinFilter: false,
        sourceIdentityMode: "EXACT",
        freshnessMode: "FRESH_ONLY",
        maxScopeCost: "LARGE_SCOPE",
      },
      source: { repositoryId: "aosp", requestedRoot: "/workspace/external-repo", effectiveRoot: "/workspace/external-repo", revision: "r1", dirtyStateFingerprint: "x", sourceKind: "CANONICAL", freshness: "FRESH" },
      shellAllowed: false,
    })
    expect(decision.reason).toBe("SEARCH_SCOPE_UNSUPPORTED")
    expect(decision.route).toBe("BLOCKED")
  })

  test("no-files-found only when requested root was searched", () => {
    expect(noFilesFoundSemantics({ requestedWasSearched: true })).toBe("NO_FILES")
    expect(noFilesFoundSemantics({ requestedWasSearched: false })).toBe("SEARCH_SCOPE_UNSUPPORTED")
  })

  test("stale mirror cannot satisfy current-WIP evidence", () => {
    const decision = routeSearch({
      requestedScope: "/workspace/external-repo",
      intent: "SEARCH_DIRECTORY_RECURSIVE",
      dedicatedCapability: {
        id: "search.text",
        callable: "grep",
        supportedRoots: ["/workspace/external-repo"],
        rootPolicy: "PREFIX",
        supportsExactFiles: true,
        supportsDirectories: true,
        supportsRecursive: true,
        supportsGlobs: true,
        supportsRegex: true,
        supportsStdinFilter: false,
        sourceIdentityMode: "EXACT",
        freshnessMode: "FRESH_ONLY",
        maxScopeCost: "LARGE_SCOPE",
      },
      source: { repositoryId: "aosp", requestedRoot: "/workspace/external-repo", effectiveRoot: "/workspace/external-repo", revision: "r1-stale", dirtyStateFingerprint: "dirty", sourceKind: "MIRROR", freshness: "STALE" },
      shellAllowed: true,
    })
    expect(decision.reason).toBe("SEARCH_INDEX_STALE")
  })

  test("source identity is included in search evidence", () => {
    const meta = searchResultMetadata({
      requestedScope: "/src",
      effectiveScope: "/src",
      repositoryId: "my-repo",
      revision: "abc123",
      matchCount: 3,
      freshness: "FRESH",
    })
    expect(meta.scopeWasRemapped).toBe(false)
  })

  test("dedicated search preferred only when source-faithful", () => {
    const decision = routeSearch({
      requestedScope: "/workspace/external-repo",
      intent: "SEARCH_EXACT_FILES",
      dedicatedCapability: {
        id: "search.text",
        callable: "grep",
        supportedRoots: ["/workspace/external-repo"],
        rootPolicy: "EXACT",
        supportsExactFiles: true,
        supportsDirectories: true,
        supportsRecursive: true,
        supportsGlobs: true,
        supportsRegex: true,
        supportsStdinFilter: false,
        sourceIdentityMode: "EXACT",
        freshnessMode: "FRESH_ONLY",
        maxScopeCost: "LARGE_SCOPE",
      },
      source: { repositoryId: "aosp", requestedRoot: "/workspace/external-repo", effectiveRoot: "/workspace/external-repo", revision: "r1", dirtyStateFingerprint: "clean", sourceKind: "CANONICAL", freshness: "FRESH" },
      shellAllowed: true,
    })
    expect(decision.route).toBe("DEDICATED")
  })

  test("shell rg fallback allowed when it is the only faithful safe route", () => {
    const decision = routeSearch({
      requestedScope: "/workspace/external-repo",
      intent: "SEARCH_EXACT_FILES",
      dedicatedCapability: {
        id: "search.text",
        callable: "grep",
        supportedRoots: ["/other"],
        rootPolicy: "EXACT",
        supportsExactFiles: true,
        supportsDirectories: true,
        supportsRecursive: true,
        supportsGlobs: true,
        supportsRegex: true,
        supportsStdinFilter: false,
        sourceIdentityMode: "EXACT",
        freshnessMode: "FRESH_ONLY",
        maxScopeCost: "LARGE_SCOPE",
      },
      source: { repositoryId: "aosp", requestedRoot: "/workspace/external-repo", effectiveRoot: "/workspace/external-repo", revision: "r1", dirtyStateFingerprint: "clean", sourceKind: "CANONICAL", freshness: "FRESH" },
      shellAllowed: true,
    })
    expect(decision.route).toBe("SHELL_RG")
  })

  test("large directory search gets narrowed without losing query", () => {
    const rg = parseRgArgs("rg AxUiDemandWindow frameworks/base")
    expect(rg.patterns).toContain("AxUiDemandWindow")
    expect(rg.directories).toContain("frameworks/base")
  })

  test("repeated rg syntax probes trigger one recovery route", () => {
    expect(isSemanticRetry("rg --no-messages pattern dir", "rg pattern dir")).toBe(true)
    expect(isSemanticRetry("rg pattern dir | rg other", "rg pattern dir")).toBe(false)
  })

  test("routing decision is stable for equivalent state", () => {
    const input = {
      requestedScope: "/src",
      intent: "SEARCH_EXACT_FILES" as const,
      dedicatedCapability: {
        id: "search.text",
        callable: "grep",
        supportedRoots: ["/src"],
        rootPolicy: "EXACT" as const,
        supportsExactFiles: true,
        supportsDirectories: true,
        supportsRecursive: true,
        supportsGlobs: true,
        supportsRegex: true,
        supportsStdinFilter: false,
        sourceIdentityMode: "EXACT" as const,
        freshnessMode: "FRESH_ONLY" as const,
        maxScopeCost: "LARGE_SCOPE" as const,
      },
      source: { repositoryId: "r", requestedRoot: "/src", effectiveRoot: "/src", revision: "v1", dirtyStateFingerprint: "x", sourceKind: "CANONICAL" as const, freshness: "FRESH" as const },
      shellAllowed: true,
    }
    const a = routeSearch(input)
    const b = routeSearch(input)
    expect(a.route).toBe(b.route)
  })

  test("phase changes do not change read-only effect classification", () => {
    const eff = classifyShellEffect("rg pattern file.ts")
    expect(eff).toContain("READ")
  })

  test("read-only rg is never mislabeled FILESYSTEM_WRITE", () => {
    const cmds = ["rg -n foo file", "rg -n foo dir", "rg --version", "git diff | rg foo", "ls path | rg foo"]
    for (const cmd of cmds) {
      const eff = classifyShellEffect(cmd)
      if (cmd === "rg --version") {
        expect(eff).toContain("PROCESS_READ_ONLY")
      } else {
        expect(eff).toContain("READ")
      }
    }
  })

  test("bash search canonicalization detects raw searches and preserves genuine git commands", () => {
    expect(isWorkspaceSearchCommand("grep -r foo .")).toBe(true)
    expect(isWorkspaceSearchCommand("grep -rn bar src/")).toBe(true)
    expect(isWorkspaceSearchCommand("rg foo src/")).toBe(true)
    expect(isWorkspaceSearchCommand("find . -name '*.ts' -exec grep foo {} +")).toBe(true)
    expect(isWorkspaceSearchCommand("find src -type f | xargs grep bar")).toBe(true)
    expect(isWorkspaceSearchCommand("git grep search_term")).toBe(true)
    expect(isWorkspaceSearchCommand("git grep pattern -- packages/")).toBe(true)

    expect(isGitGrepHistoricalOrIndex("git grep foo HEAD")).toBe(true)
    expect(isGitGrepHistoricalOrIndex("git grep --cached foo")).toBe(true)
    expect(isGitGrepHistoricalOrIndex("git grep foo")).toBe(false)
    expect(isGenuineGitSearch("git grep foo HEAD")).toBe(true)
    expect(isGenuineGitSearch("git grep foo HEAD~1")).toBe(true)
    expect(isGenuineGitSearch("git grep foo origin/main")).toBe(true)
    expect(isGenuineGitSearch("git grep --cached foo")).toBe(true)
    expect(isGenuineGitSearch("git grep --staged foo")).toBe(true)
    expect(isGenuineGitSearch("git log -S foo")).toBe(true)
    expect(isGenuineGitSearch("git log -G bar")).toBe(true)
    expect(isGenuineGitSearch("git diff")).toBe(true)
    expect(isGenuineGitSearch("git show HEAD")).toBe(true)

    expect(isWorkspaceSearchCommand("git grep foo HEAD")).toBe(false)
    expect(isWorkspaceSearchCommand("git grep --cached foo")).toBe(false)

    expect(classifySearchIntent({
      command: "rg foo",
      args: ["foo"],
      hasPipe: true,
      pipeSource: "git diff",
    })).toBe("FILTER_STREAM_TEXT")
  })
})
