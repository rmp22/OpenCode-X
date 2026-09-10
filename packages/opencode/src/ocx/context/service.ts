export * as ContextService from "./service"

import { execFileSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { existsSync, readFileSync, realpathSync } from "node:fs"
import path from "node:path"
import { ContextGraph } from "./graph"
import { ContextFreshnessTracker } from "./freshness"
import { ContextStore } from "./store"
import { ContextTransactionManager } from "./transaction"
import { RepositoryIdentityResolver } from "./identity"
import type { IndexSnapshot, Store } from "./store"
import type {
  ContextHistoryRecord,
  ContextUpdateTransaction,
  Finding,
  RepositoryContext,
  RepositoryID,
  RepositoryManifest,
  RepositorySnapshot,
} from "./types"
import { CONTEXT_SCHEMA_VERSION } from "./types"

export type Handle = {
  readonly root: string
  readonly repositoryID: RepositoryID
  readonly store: Store
  readonly context: RepositoryContext
}

export type ApplyOutput = ContextTransactionManager.ApplyResult & {
  readonly handle: Handle
}

export function open(input: {
  readonly root: string
  readonly store?: Store
  readonly dataDir?: string
  readonly projectID?: string
  readonly workspaceNamespace?: string
  readonly revision?: string
}): Handle {
  const repository = RepositoryIdentityResolver.fromDirectory(input.root, {
    ...(input.projectID ? { projectID: input.projectID } : {}),
    ...(input.workspaceNamespace ? { workspaceNamespace: input.workspaceNamespace } : {}),
  })
  const store = input.store ?? ContextStore.open({ dataDir: input.dataDir })
  const stored = store.load(repository.id)
  const context =
    stored ??
    emptyContext({
      id: repository.id,
      displayName: repository.displayName,
      identity: repository.identity,
      root: repository.root,
      revision: input.revision,
    })
  return { root: repository.root, repositoryID: repository.id, store, context }
}

export function emptyContext(input: {
  readonly id: RepositoryID
  readonly displayName: string
  readonly identity: RepositoryContext["manifest"]["identity"]
  readonly root: string
  readonly revision?: string
  readonly now?: number
}): RepositoryContext {
  const now = input.now ?? Date.now()
  const manifest: RepositoryManifest = {
    schemaVersion: CONTEXT_SCHEMA_VERSION,
    repositoryID: input.id,
    displayName: input.displayName,
    identity: input.identity,
    lastSeenPath: input.root,
    ...(input.revision ? { lastSeenRevision: input.revision } : {}),
    createdAt: now,
    updatedAt: now,
  }
  return {
    schemaVersion: CONTEXT_SCHEMA_VERSION,
    manifest,
    nodes: [],
    edges: [],
    pipelines: [],
    components: [],
    evidence: [],
  }
}

export function apply(handle: Handle, transaction: ContextUpdateTransaction): ApplyOutput {
  const current = handle.store.load(handle.repositoryID) ?? handle.context
  const result = ContextTransactionManager.apply(current, transaction)
  const context = {
    ...result.context,
    manifest: {
      ...result.context.manifest,
      lastSeenPath: handle.root,
      updatedAt: Date.now(),
    },
  }
  handle.store.save(context)
  const history: ContextHistoryRecord = {
    id: `ctx_history_${randomUUID().replaceAll("-", "")}`,
    schemaVersion: CONTEXT_SCHEMA_VERSION,
    transactionID: transaction.id,
    repositoryID: context.manifest.repositoryID,
    time: Date.now(),
    origin: transaction.origin,
    reason: transaction.reason,
    oldSummary: result.history.oldSummary,
    newSummary: result.history.newSummary,
    evidenceIDs: result.history.evidenceIDs,
  }
  handle.store.recordHistory(history)
  handle.store.recordTransaction({ ...transaction, status: result.status })
  handle.store.rebuildIndexes(context.manifest.repositoryID, indexSnapshot(context))
  return { ...result, context, handle: { ...handle, context } }
}

export function freshness(handle: Handle, snapshot: RepositorySnapshot) {
  return ContextFreshnessTracker.check(handle.context, snapshot)
}

export function refresh(
  handle: Handle,
  snapshot: RepositorySnapshot,
): {
  readonly handle: Handle
  readonly report: ReturnType<typeof ContextFreshnessTracker.check>
  readonly changed: boolean
} {
  const current = handle.store.load(handle.repositoryID) ?? handle.context
  const currentHandle = { ...handle, context: current }
  const refreshed = ContextFreshnessTracker.refresh(current, snapshot)
  const priorFiles = new Map(current.evidence.map((evidence) => [evidence.id, evidence.file]))
  const moved = refreshed.context.evidence.filter((evidence) => evidence.file !== priorFiles.get(evidence.id))
  const verifiedEvidenceIDs = new Set([...refreshed.report.unchangedEvidenceIDs, ...refreshed.report.movedEvidenceIDs])
  const revisionChanged = snapshot.revision !== undefined && snapshot.revision !== current.manifest.lastSeenRevision
  const revisionUpdates = revisionChanged
    ? refreshed.context.evidence
        .filter((evidence) => verifiedEvidenceIDs.has(evidence.id))
        .map((evidence) => ({
          ...evidence,
          repositoryRevision: snapshot.revision,
        }))
    : []
  const operations = [
    ...[...new Map([...moved, ...revisionUpdates].map((evidence) => [evidence.id, evidence])).values()].map(
      (evidence) => ({
        op: "upsert_evidence" as const,
        evidence,
      }),
    ),
    ...(refreshed.report.affectedEntryIDs.length > 0
      ? [{ op: "mark_stale" as const, entryIDs: refreshed.report.affectedEntryIDs }]
      : []),
  ]
  if (operations.length === 0)
    return { handle: { ...handle, context: refreshed.context }, report: refreshed.report, changed: false }
  const transaction = ContextTransactionManager.create({
    repositoryID: handle.repositoryID,
    baseRevision: current.manifest.lastSeenRevision,
    ...(snapshot.revision ? { sourceRevision: snapshot.revision } : {}),
    origin: { taskID: "context-refresh" },
    reason: "refresh source evidence and mark dependent context stale",
    operations,
  })
  const applied = apply(currentHandle, transaction)
  return { handle: applied.handle, report: refreshed.report, changed: true }
}

export function sourceSnapshot(handle: Handle, files?: readonly string[]): RepositorySnapshot {
  const scopes = (files ?? []).map((file) => file.trim().replaceAll("\\", "/").replace(/^\.\//, "")).filter(Boolean)
  const wanted = new Set(
    files === undefined
      ? handle.context.evidence.map((evidence) => evidence.file)
      : [
          ...scopes,
          ...handle.context.evidence
            .map((evidence) => evidence.file)
            .filter((file) => scopes.some((scope) => file === scope || file.startsWith(`${scope}/`))),
        ],
  )
  const values = Object.fromEntries(
    [...wanted].flatMap((file) => {
      const absolute = path.resolve(handle.root, file)
      if (!inside(handle.root, absolute) || !existsSync(absolute)) return []
      try {
        const content = readFileSync(absolute)
        return [[file, { contentHash: ContextFreshnessTracker.fingerprint(content) }] as const]
      } catch {
        return []
      }
    }),
  )
  const revision = repositoryRevision(handle.root)
  return ContextFreshnessTracker.snapshot({
    repositoryID: handle.repositoryID,
    ...(revision ? { revision } : {}),
    complete: files === undefined,
    files: values,
  })
}

export function verifyFindings(handle: Handle, findings: readonly Finding[]): Finding[] {
  const files = [...new Set(findings.flatMap((finding) => finding.evidence.map((evidence) => evidence.file)))]
  const snapshot = sourceSnapshot(handle, files)
  return findings.flatMap((finding) => {
    const evidence = finding.evidence.flatMap((item) => {
      const current = snapshot.files[item.file]
      if (!current || (item.contentHash !== undefined && item.contentHash !== current.contentHash)) return []
      return [{ ...item, contentHash: current.contentHash }]
    })
    return evidence.length === finding.evidence.length && evidence.length > 0 ? [{ ...finding, evidence }] : []
  })
}

export function forget(handle: Handle): void {
  handle.store.remove(handle.repositoryID)
}

function indexSnapshot(context: RepositoryContext): IndexSnapshot {
  const indexes = ContextGraph.buildIndexes(ContextGraph.fromContext(context))
  return {
    nodeByName: [...indexes.nodeByName.entries()].map(([key, value]) => `${key}=${value}`),
    aliases: [...indexes.aliasToNode.entries()].map(([key, value]) => `${key}=${value}`),
    files: [...indexes.fileToNodes.entries()].map(([key, value]) => `${key}=${value.join(",")}`),
    symbols: [...indexes.symbolToNodes.entries()].map(([key, value]) => `${key}=${value.join(",")}`),
    pipelines: [...indexes.pipelineToNodes.entries()].map(([key, value]) => `${key}=${value.join(",")}`),
    relations: [...indexes.relationToEdges.entries()].map(
      ([key, value]) => `${key}=${value.map((edge) => edge.id).join(",")}`,
    ),
    owners: [...indexes.ownerToEntries.entries()].map(([key, value]) => `${key}=${value.join(",")}`),
    stale: indexes.staleEntries,
  }
}

function repositoryRevision(root: string): string | undefined {
  try {
    return (
      execFileSync("git", ["rev-parse", "--verify", "HEAD"], {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim() || undefined
    )
  } catch {
    return undefined
  }
}

function inside(root: string, file: string): boolean {
  const base = realPath(root)
  const candidate = realPath(file)
  return candidate === base || candidate.startsWith(`${base}${path.sep}`)
}

function realPath(value: string): string {
  try {
    return realpathSync(value)
  } catch {
    return path.resolve(value)
  }
}
