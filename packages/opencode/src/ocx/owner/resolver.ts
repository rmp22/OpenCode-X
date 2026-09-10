import type { ConcreteOwner, OwnerID, WorkspaceIdentity } from "./types"
import { createWorkspaceIdentity, toWorkdirRelative, VirtualOwnerTreeManager } from "./workspace-tree"

export type ResolveTarget = {
  readonly pinnedOwnerId?: OwnerID
  readonly paths?: readonly string[]
  readonly symbols?: readonly string[]
  readonly prompt?: string
  readonly tool?: string
}

export type OwnerResolution = {
  readonly owner: ConcreteOwner
  readonly matchType: "pinned" | "longest_path_prefix" | "module_root" | "symbol" | "semantic_fallback" | "default"
  readonly matchedPath?: string
  readonly matchedPrefix?: string
  readonly score: number
  readonly reasons: readonly string[]
  readonly reviewConcerns?: readonly string[]
}

export type InterceptionResult = {
  readonly intercepted: boolean
  readonly requiredOwnerId?: OwnerID
  readonly reason?: string
  readonly isCrossBoundary?: boolean
  readonly affectedOwners?: readonly OwnerID[]
  readonly partitions?: Readonly<Record<OwnerID, readonly string[]>>
  readonly reviewConcerns?: readonly string[]
}

function normalizePath(rawPath: string): string {
  return rawPath.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/+$/, "")
}

function pathMatchesPrefix(filePath: string, prefix: string): boolean {
  const normFile = normalizePath(filePath)
  const normPrefix = normalizePath(prefix)
  if (!normPrefix || normPrefix === ".") return true
  return normFile === normPrefix || normFile.startsWith(`${normPrefix}/`)
}

function longestPrefixMatch(filePath: string, prefixes: readonly string[]): string | undefined {
  const normFile = normalizePath(filePath)
  const matching = prefixes
    .map(normalizePath)
    .filter((prefix) => pathMatchesPrefix(normFile, prefix))
    .sort((a, b) => b.length - a.length)
  return matching[0]
}

const KNOWN_REVIEW_CONCERNS: readonly string[] = [
  "security",
  "auth",
  "ui",
  "performance",
  "perf",
  "networking",
  "database",
  "accessibility",
  "i18n",
]

export class OwnershipResolver {
  private readonly owners = new Map<OwnerID, ConcreteOwner>()
  readonly workspace: WorkspaceIdentity

  constructor(initialOwners: readonly ConcreteOwner[] = [], workspace?: WorkspaceIdentity) {
    this.workspace = workspace ?? createWorkspaceIdentity(process.cwd())
    for (const owner of initialOwners) {
      this.owners.set(owner.id, owner)
    }
  }

  register(owner: ConcreteOwner): void {
    this.owners.set(owner.id, owner)
  }

  unregister(ownerId: OwnerID): boolean {
    return this.owners.delete(ownerId)
  }

  get(ownerId: OwnerID): ConcreteOwner | undefined {
    return this.owners.get(ownerId)
  }

  list(): readonly ConcreteOwner[] {
    return Array.from(this.owners.values())
  }

  detectReviewConcerns(paths: readonly string[] = [], prompt?: string): readonly string[] {
    const concerns = new Set<string>()
    const textToCheck = `${paths.join(" ")} ${prompt ?? ""}`.toLocaleLowerCase()

    for (const c of KNOWN_REVIEW_CONCERNS) {
      if (textToCheck.includes(c)) {
        concerns.add(c)
      }
    }

    const concernsList = Array.from(concerns)
    return concernsList
  }

  resolveOwnerForPath(filePath: string): { owner: ConcreteOwner; matchedPrefix: string } | undefined {
    const relativeFile = toWorkdirRelative(this.workspace.workspaceRoot, filePath)
    const normFile = normalizePath(relativeFile)
    let bestMatch: { owner: ConcreteOwner; matchedPrefix: string } | undefined

    for (const owner of this.owners.values()) {
      const allPrefixes = owner.scopes.flatMap((s) => [
        ...s.pathPrefixes,
        ...(s.moduleRoot ? [s.moduleRoot] : []),
        ...(owner.rootDir ? [owner.rootDir] : []),
      ])
      const matchedPrefix = longestPrefixMatch(normFile, allPrefixes)
      if (!matchedPrefix) continue

      if (!bestMatch || matchedPrefix.length > bestMatch.matchedPrefix.length) {
        bestMatch = { owner, matchedPrefix }
      }
    }

    return bestMatch
  }

  resolve(target: ResolveTarget): OwnerResolution {
    const reviewConcerns = this.detectReviewConcerns(target.paths, target.prompt)

    if (target.pinnedOwnerId) {
      const pinned = this.owners.get(target.pinnedOwnerId)
      if (pinned) {
        const resolution: OwnerResolution = {
          owner: pinned,
          matchType: "pinned",
          score: 1000,
          reasons: [`Pinned owner: ${target.pinnedOwnerId}`],
          reviewConcerns,
        }
        return resolution
      }
    }

    const paths = target.paths?.map((p) => toWorkdirRelative(this.workspace.workspaceRoot, p)).filter(Boolean) ?? []
    if (paths.length > 0) {
      let bestPathMatch: { owner: ConcreteOwner; prefix: string; path: string } | undefined
      for (const p of paths) {
        const found = this.resolveOwnerForPath(p)
        if (found && (!bestPathMatch || found.matchedPrefix.length > bestPathMatch.prefix.length)) {
          bestPathMatch = { owner: found.owner, prefix: found.matchedPrefix, path: p }
        }
      }

      if (bestPathMatch) {
        const resolution: OwnerResolution = {
          owner: bestPathMatch.owner,
          matchType: "longest_path_prefix",
          matchedPath: bestPathMatch.path,
          matchedPrefix: bestPathMatch.prefix,
          score: 100 + bestPathMatch.prefix.length,
          reasons: [`Longest prefix match on path: ${bestPathMatch.path} with prefix ${bestPathMatch.prefix}`],
          reviewConcerns,
        }
        return resolution
      }
    }

    if (target.symbols && target.symbols.length > 0) {
      const symbolTokens = new Set(target.symbols.map((s) => s.toLocaleLowerCase()))
      for (const owner of this.owners.values()) {
        const ownerNameTokens = owner.name.toLocaleLowerCase().split(/[^a-z0-9]+/g)
        const ownerTopicTokens = owner.topic.toLocaleLowerCase().split(/[^a-z0-9]+/g)
        const matches = [...ownerNameTokens, ...ownerTopicTokens].filter((t) => symbolTokens.has(t))
        if (matches.length > 0) {
          const resolution: OwnerResolution = {
            owner,
            matchType: "symbol",
            score: 50 + matches.length * 10,
            reasons: [`Matched symbols: ${matches.join(", ")}`],
            reviewConcerns,
          }
          return resolution
        }
      }
    }

    if (target.prompt) {
      const promptLower = target.prompt.toLocaleLowerCase()
      for (const owner of this.owners.values()) {
        if (promptLower.includes(owner.id.toLocaleLowerCase()) || promptLower.includes(owner.topic.toLocaleLowerCase())) {
          const resolution: OwnerResolution = {
            owner,
            matchType: "semantic_fallback",
            score: 30,
            reasons: [`Topic match in prompt: ${owner.topic}`],
            reviewConcerns,
          }
          return resolution
        }
      }
    }

    const first = this.owners.values().next().value
    if (first) {
      const resolution: OwnerResolution = {
        owner: first,
        matchType: "default",
        score: 1,
        reasons: ["Default registered owner"],
        reviewConcerns,
      }
      return resolution
    }

    const defaultOwner: ConcreteOwner = {
      id: "root",
      name: `${this.workspace.name} Root`,
      topic: ".",
      kind: "directory",
      scopes: [
        {
          id: "scope-root",
          ownerId: "root",
          kind: "DIRECTORY",
          pathPrefixes: ["."],
        },
      ],
      readiness: "ready",
      modelTier: "primary",
    }
    const resolution: OwnerResolution = {
      owner: defaultOwner,
      matchType: "default",
      score: 0,
      reasons: ["Synthetic fallback root owner"],
      reviewConcerns,
    }
    return resolution
  }

  resolveOwnersForPaths(paths: readonly string[]): Map<OwnerID, { owner: ConcreteOwner; paths: string[] }> {
    const partitions = new Map<OwnerID, { owner: ConcreteOwner; paths: string[] }>()
    for (const p of paths) {
      const match = this.resolveOwnerForPath(p)
      if (!match) continue
      const existing = partitions.get(match.owner.id)
      if (existing) {
        existing.paths.push(p)
      } else {
        partitions.set(match.owner.id, { owner: match.owner, paths: [p] })
      }
    }
    return partitions
  }

  detectCrossBoundary(paths: readonly string[]): {
    readonly isCrossBoundary: boolean
    readonly owners: readonly ConcreteOwner[]
    readonly partitions: Readonly<Record<OwnerID, readonly string[]>>
  } {
    const mapped = this.resolveOwnersForPaths(paths)
    const owners = Array.from(mapped.values()).map((v) => v.owner)
    const partitions: Record<OwnerID, string[]> = {}
    for (const [id, val] of mapped.entries()) {
      partitions[id] = val.paths
    }
    const boundary = {
      isCrossBoundary: mapped.size > 1,
      owners,
      partitions,
    }
    return boundary
  }

  interceptOperation(targetPaths: readonly string[], currentOwnerId?: OwnerID): InterceptionResult {
    const reviewConcerns = this.detectReviewConcerns(targetPaths)
    if (targetPaths.length === 0) {
      const empty: InterceptionResult = { intercepted: false, reviewConcerns }
      return empty
    }

    const boundary = this.detectCrossBoundary(targetPaths)
    if (boundary.isCrossBoundary) {
      const crossResult: InterceptionResult = {
        intercepted: true,
        reason: `Operation spans multiple owners: ${boundary.owners.map((o) => o.id).join(", ")}`,
        isCrossBoundary: true,
        affectedOwners: boundary.owners.map((o) => o.id),
        partitions: boundary.partitions,
        reviewConcerns,
      }
      return crossResult
    }

    if (boundary.owners.length === 1) {
      const targetOwner = boundary.owners[0]
      if (currentOwnerId && currentOwnerId !== targetOwner.id) {
        const delegateResult: InterceptionResult = {
          intercepted: true,
          requiredOwnerId: targetOwner.id,
          reason: `Target path belongs to owner ${targetOwner.id}, but active owner is ${currentOwnerId}`,
          isCrossBoundary: false,
          affectedOwners: [targetOwner.id],
          partitions: boundary.partitions,
          reviewConcerns,
        }
        return delegateResult
      }
      const selfResult: InterceptionResult = {
        intercepted: false,
        requiredOwnerId: targetOwner.id,
        affectedOwners: [targetOwner.id],
        partitions: boundary.partitions,
        reviewConcerns,
      }
      return selfResult
    }

    const noopResult: InterceptionResult = { intercepted: false, reviewConcerns }
    return noopResult
  }

  static forWorkspace(workspace: WorkspaceIdentity): OwnershipResolver {
    const treeManager = new VirtualOwnerTreeManager()
    const tree = treeManager.discoverTree(workspace)
    const concreteOwners = treeManager.convertToConcreteOwners(tree)
    return new OwnershipResolver(concreteOwners, workspace)
  }

  static forWorkdir(workdir: string): OwnershipResolver {
    const workspace = createWorkspaceIdentity(workdir)
    return OwnershipResolver.forWorkspace(workspace)
  }

  static createDefault(): OwnershipResolver {
    return OwnershipResolver.forWorkdir(process.cwd())
  }
}

export * as OwnerResolver from "./resolver"
