export * as ContextFreshnessTracker from "./freshness"

import { createHash } from "node:crypto"
import { ContextGraph } from "./graph"
import type {
  ContextEntryID,
  EvidenceID,
  FreshnessReport,
  RepositoryContext,
  RepositoryID,
  RepositorySnapshot,
} from "./types"
import { normalizeRelativePath } from "./types"

export type SnapshotInput = {
  readonly repositoryID: RepositoryID
  readonly revision?: string
  readonly complete?: boolean
  readonly files: Readonly<Record<string, string | { readonly contentHash: string; readonly symbol?: string }>>
}

export function fingerprint(content: string | Uint8Array): string {
  return createHash("sha256").update(content).digest("hex")
}

export function snapshot(input: SnapshotInput): RepositorySnapshot {
  return {
    repositoryID: input.repositoryID,
    ...(input.revision ? { revision: input.revision } : {}),
    ...(input.complete !== undefined ? { complete: input.complete } : {}),
    files: Object.fromEntries(
      Object.entries(input.files).flatMap(([file, value]) => {
        try {
          const normalized = normalizeRelativePath(file)
          return [[normalized, typeof value === "string" ? { contentHash: fingerprint(value) } : { ...value }] as const]
        } catch {
          return []
        }
      }),
    ),
  }
}

export function check(context: RepositoryContext, current: RepositorySnapshot): FreshnessReport {
  if (context.manifest.repositoryID !== current.repositoryID) return unknownReport()
  const filesByHash = new Map<string, string[]>()
  for (const [file, value] of Object.entries(current.files)) {
    const paths = filesByHash.get(value.contentHash) ?? []
    paths.push(file)
    filesByHash.set(value.contentHash, paths)
  }
  const unchangedEvidenceIDs: EvidenceID[] = []
  const changedEvidenceIDs: EvidenceID[] = []
  const movedEvidenceIDs: EvidenceID[] = []
  const missingEvidenceIDs: EvidenceID[] = []
  const affectedFiles = new Set<string>()
  for (const evidence of context.evidence) {
    const currentFile = current.files[evidence.file]
    if (currentFile?.contentHash === evidence.contentHash) {
      unchangedEvidenceIDs.push(evidence.id)
      continue
    }
    const moved = filesByHash.get(evidence.contentHash)?.find((file) => file !== evidence.file)
    if (
      moved &&
      (!evidence.symbol || !current.files[moved]?.symbol || current.files[moved]?.symbol === evidence.symbol)
    ) {
      movedEvidenceIDs.push(evidence.id)
      continue
    }
    if (!currentFile) {
      if (current.complete === false) continue
      missingEvidenceIDs.push(evidence.id)
    } else changedEvidenceIDs.push(evidence.id)
    affectedFiles.add(evidence.file)
  }
  const affectedEntryIDs = affectedEntries(context, [...affectedFiles])
  const state =
    context.evidence.length === 0
      ? "unknown"
      : changedEvidenceIDs.length > 0 || missingEvidenceIDs.length > 0
        ? "stale"
        : current.complete === false ||
            movedEvidenceIDs.length > 0 ||
            (current.revision !== undefined && current.revision !== context.manifest.lastSeenRevision)
          ? "partial"
          : "current"
  return {
    state,
    unchangedEvidenceIDs: sortIDs(unchangedEvidenceIDs),
    changedEvidenceIDs: sortIDs(changedEvidenceIDs),
    movedEvidenceIDs: sortIDs(movedEvidenceIDs),
    missingEvidenceIDs: sortIDs(missingEvidenceIDs),
    affectedEntryIDs: sortIDs(affectedEntryIDs),
  }
}

export function affectedByFiles(context: RepositoryContext, changedFiles: readonly string[]): ContextEntryID[] {
  return affectedEntries(
    context,
    changedFiles.flatMap((file) => {
      try {
        return [normalizeRelativePath(file)]
      } catch {
        return []
      }
    }),
  )
}

export function markStale(context: RepositoryContext, report: FreshnessReport): RepositoryContext {
  const wantedEvidence = new Set([...report.changedEvidenceIDs, ...report.missingEvidenceIDs])
  const affected = new Set(report.affectedEntryIDs)
  const graph = ContextGraph.fromContext(context)
  return ContextGraph.toContext(
    {
      ...graph,
      nodes: graph.nodes.map((node) =>
        affected.has(node.id) || node.evidenceIDs.some((id) => wantedEvidence.has(id))
          ? { ...node, confidence: "STALE", status: "stale" }
          : node,
      ),
      edges: graph.edges.map((edge) =>
        affected.has(edge.id) || edge.evidenceIDs.some((id) => wantedEvidence.has(id))
          ? { ...edge, confidence: "STALE", status: "stale" }
          : edge,
      ),
      pipelines: graph.pipelines.map((pipeline) =>
        affected.has(pipeline.id) || pipeline.evidenceIDs.some((id) => wantedEvidence.has(id))
          ? { ...pipeline, confidence: "STALE", status: "stale" }
          : pipeline,
      ),
      components: graph.components.map((component) =>
        affected.has(component.id) || component.evidenceIDs.some((id) => wantedEvidence.has(id))
          ? { ...component, confidence: "STALE", status: "stale" }
          : component,
      ),
    },
    context,
  )
}

export function refresh(
  context: RepositoryContext,
  current: RepositorySnapshot,
): {
  readonly context: RepositoryContext
  readonly report: FreshnessReport
} {
  const report = check(context, current)
  const moved = movedEvidence(context, report, current)
  const updated = {
    ...context,
    evidence: context.evidence.map((evidence) => {
      const nextFile = moved.get(evidence.id)
      return nextFile
        ? { ...evidence, file: nextFile, ...(current.revision ? { repositoryRevision: current.revision } : {}) }
        : evidence
    }),
    manifest: {
      ...context.manifest,
      ...(current.revision ? { lastSeenRevision: current.revision } : {}),
      updatedAt: Date.now(),
    },
  }
  return { context: markStale(updated, report), report }
}

export function changedFiles(
  before: Readonly<Record<string, { readonly contentHash: string }>>,
  after: Readonly<Record<string, { readonly contentHash: string }>>,
): string[] {
  return [
    ...new Set([
      ...Object.keys(before).filter((file) => before[file]?.contentHash !== after[file]?.contentHash),
      ...Object.keys(after).filter((file) => before[file] === undefined),
    ]),
  ].sort()
}

function affectedEntries(context: RepositoryContext, files: readonly string[]): ContextEntryID[] {
  const graph = ContextGraph.fromContext(context)
  const byFile = files.flatMap((file) => ContextGraph.entriesForFile(graph, file))
  const byEvidence = context.evidence
    .filter((evidence) => files.includes(evidence.file))
    .flatMap((evidence) => entriesForEvidence(context, evidence.id))
  return [...new Set([...byFile, ...byEvidence])].sort()
}

function entriesForEvidence(context: RepositoryContext, evidenceID: EvidenceID): ContextEntryID[] {
  return [
    ...context.nodes.filter((node) => node.evidenceIDs.includes(evidenceID)).map((node) => node.id),
    ...context.edges.filter((edge) => edge.evidenceIDs.includes(evidenceID)).map((edge) => edge.id),
    ...context.pipelines
      .filter(
        (pipeline) =>
          pipeline.evidenceIDs.includes(evidenceID) ||
          pipeline.constraints.some((claim) => claim.evidenceIDs.includes(evidenceID)),
      )
      .map((pipeline) => pipeline.id),
    ...context.components
      .filter((component) => component.evidenceIDs.includes(evidenceID))
      .map((component) => component.id),
  ]
}

function movedEvidence(
  context: RepositoryContext,
  report: FreshnessReport,
  current: RepositorySnapshot,
): Map<EvidenceID, string> {
  const moved = new Map<EvidenceID, string>()
  const hashes = new Map<string, string[]>()
  for (const [file, value] of Object.entries(current.files))
    hashes.set(value.contentHash, [...(hashes.get(value.contentHash) ?? []), file])
  for (const id of report.movedEvidenceIDs) {
    const evidence = context.evidence.find((item) => item.id === id)
    const file = evidence
      ? hashes
          .get(evidence.contentHash)
          ?.find(
            (value) =>
              value !== evidence.file &&
              (!evidence.symbol || !current.files[value]?.symbol || current.files[value]?.symbol === evidence.symbol),
          )
      : undefined
    if (file) moved.set(id, file)
  }
  return moved
}

function unknownReport(): FreshnessReport {
  return {
    state: "unknown",
    unchangedEvidenceIDs: [],
    changedEvidenceIDs: [],
    movedEvidenceIDs: [],
    missingEvidenceIDs: [],
    affectedEntryIDs: [],
  }
}

function sortIDs<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].toSorted()
}
