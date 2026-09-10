import { execFileSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { Effect } from "effect"
import { OwnerMemory } from "./memory"
import { OwnerRegistry } from "./registry"
import { OwnerRouter } from "./router"
import { Provenance } from "../provenance"

export type RouteInput = OwnerRouter.Input & {
  readonly workdir: string
  readonly sessionID: string
}

export type RouteResult = {
  readonly repositoryID: string
  readonly owners: readonly OwnerRegistry.Owner[]
  readonly created: readonly string[]
  readonly refreshRequired: readonly string[]
  readonly instructions: string
}

export function repositoryRevision(workdir: string): string | undefined {
  try {
    const value = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: workdir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
    return value.trim() || undefined
  } catch {
    return undefined
  }
}

export function isDirtyWorktree(workdir: string): boolean {
  try {
    const value = execFileSync("git", ["status", "--porcelain"], {
      cwd: workdir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
    return value.trim().length > 0
  } catch {
    return false
  }
}

export function isOwnerFresh(owner: OwnerRegistry.Owner, currentRevision?: string, dirty?: boolean): boolean {
  if (dirty) return false
  if (!currentRevision || !owner.lastSeenRevision) return false
  return owner.lastSeenRevision === currentRevision && owner.lastVerifiedRevision === currentRevision
}

export function isRepositoryTask(prompt: string): boolean {
  return /\b(?:add|analyze|build|change|check|debug|discover|explore|find|fix|implement|inspect|investigate|map|migrate|refactor|remove|rename|repair|search|test|trace|update|write)\b/i.test(prompt) &&
    /(?:\.(?:ts|tsx|js|jsx|py|go|rs|java|kt|swift|css|html?)\b|\b(?:code|file|module|package|repository|repo|test|bug|implementation|function|class|api)\b)/i.test(prompt)
}

function rolePrompt(
  owner: OwnerRegistry.Owner,
  memory: string | undefined,
  refresh: boolean,
): string {
  return [
    `You are the persistent ${owner.name} for this repository.`,
    `Your stable owner ID is ${owner.id}.`,
    `Maintain responsibility for ${owner.topic} across unrelated tasks.`,
    "Stay within this domain. Report dependencies to the primary orchestrator instead of silently taking over another domain.",
    "Do not trust remembered facts blindly. Verify relevant files when the repository changed.",
    refresh ? "The repository revision changed since this owner was last used. Refresh only facts affected by this task before editing." : undefined,
    memory,
    "After meaningful work, report changed files, verification results, unresolved issues, and durable domain knowledge worth keeping.",
  ].filter(Boolean).join("\n")
}

export function route(input: RouteInput): Effect.Effect<RouteResult, unknown> {
  return Effect.gen(function* () {
    const store = yield* OwnerRegistry.open(input.workdir, input.sessionID)
    const repositoryID = OwnerRegistry.repositoryID(input.workdir)
    const revision = repositoryRevision(input.workdir)
    const existing = store.list(repositoryID)
    const repositoryMemory = store.repositoryKnowledge(repositoryID)
    const selected: OwnerRegistry.Owner[] = []
    const created: string[] = []
    const refreshRequired: string[] = []

    for (const domain of OwnerRouter.domains(input)) {
      const matches = OwnerRouter.rank(existing, {
        prompt: [domain.topic, ...domain.aliases].join(" "),
        paths: input.paths,
        symbols: input.symbols,
      })
      const match = matches.find((item) => item.score >= 4)
      if (match && !selected.some((owner) => owner.id === match.owner.id)) {
        selected.push(match.owner)
        if (revision && match.owner.lastSeenRevision && match.owner.lastSeenRevision !== revision)
          refreshRequired.push(match.owner.id)
        store.touch(repositoryID, match.owner.id, revision)
        continue
      }
      const owner = store.create({
        repositoryID,
        name: domain.name,
        topic: domain.topic,
        description: `Persistent repository owner for ${domain.topic} work.`,
        scopes: OwnerRouter.scopes(domain, input.paths),
        revision,
      })
      selected.push(owner)
      created.push(owner.id)
    }

    const instructions = selected
      .map((owner) => {
        const ownerMemory = store.knowledge(repositoryID, owner.id)
        const query = { prompt: input.prompt, paths: input.paths, symbols: input.symbols }
        return rolePrompt(
          owner,
          OwnerMemory.render({
            repository: OwnerMemory.select(repositoryMemory, query),
            owner: OwnerMemory.select(ownerMemory, query),
            staleOwner: OwnerMemory.stale(OwnerMemory.select(ownerMemory, query), revision),
          }),
          refreshRequired.includes(owner.id),
        )
      })
      .join("\n\n")
    return { repositoryID, owners: selected, created, refreshRequired, instructions }
  })
}

export function sessionMetadata(ownerID: string, repositoryID: string) {
  return { ocx: { sessionKind: "owner", ownerID, repositoryID } }
}

export function leaseID(prefix = "owner-task"): string {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`
}

export function acquire(input: { workdir: string; sessionID: string; ownerID: string; leaseID: string; ttlMs?: number }): Effect.Effect<boolean, unknown> {
  return OwnerRegistry.open(input.workdir, input.sessionID).pipe(Effect.map((store) => store.acquire(input.ownerID, input.leaseID, input.ttlMs ?? 15 * 60_000)))
}

export function release(input: { workdir: string; sessionID: string; ownerID: string; leaseID: string }): Effect.Effect<void, unknown> {
  return OwnerRegistry.open(input.workdir, input.sessionID).pipe(Effect.map((store) => store.release(input.ownerID, input.leaseID)), Effect.asVoid)
}

export function attachSession(input: {
  workdir: string
  repositoryID: string
  ownerID: string
  sessionID: string
  registrySessionID: string
}): Effect.Effect<void, unknown> {
  return OwnerRegistry.open(input.workdir, input.registrySessionID).pipe(Effect.map((store) => store.attachSession(input.repositoryID, input.ownerID, input.sessionID)), Effect.asVoid)
}

export function recordTask(input: Omit<OwnerRegistry.OwnerTask, "id"> & { id?: string; workdir: string }): Effect.Effect<OwnerRegistry.OwnerTask, unknown> {
  return OwnerRegistry.open(input.workdir, input.primarySessionID).pipe(Effect.map((store) => {
    const { workdir: _, ...task } = input
    return store.recordTask(task)
  }))
}

export function recordKnowledge(input: {
  readonly workdir: string
  readonly sessionID: string
  readonly repositoryID: string
  readonly ownerID: string
  readonly category: string
  readonly key: string
  readonly value: string
  readonly sourceRevision?: string
  readonly source?: Provenance.Source
  readonly sourceRef?: string
  readonly verifiedAt?: number
}): Effect.Effect<void, unknown> {
  return OwnerRegistry.open(input.workdir, input.sessionID).pipe(
    Effect.map((store) =>
      store.setKnowledge({
        repositoryID: input.repositoryID,
        ownerID: input.ownerID,
        category: input.category,
        key: input.key,
         value: input.value,
         ...(input.sourceRevision ? { sourceRevision: input.sourceRevision } : {}),
         ...(input.source ? { source: input.source } : {}),
         ...(input.sourceRef ? { sourceRef: input.sourceRef } : {}),
         ...(input.verifiedAt !== undefined ? { verifiedAt: input.verifiedAt } : {}),
      }),
    ),
    Effect.asVoid,
  )
}

export * as OwnerLifecycle from "./lifecycle"
