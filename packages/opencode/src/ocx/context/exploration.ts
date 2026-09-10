export * as ContextExploration from "./exploration"

import path from "node:path"
import { createHash } from "node:crypto"
import { ContextGraph } from "./graph"
import { ContextTransactionManager } from "./transaction"
import type { RepositoryMap, RepositoryProfile } from "../codebase/types"
import type {
  ComponentContext,
  ContextEdge,
  ContextEdgeID,
  ContextClaim,
  ContextNodeID,
  ContextNode,
  ContextUpdateTransaction,
  EdgeRelation,
  EvidenceID,
  EvidenceRef,
  Finding,
  FindingEvidence,
  PipelineContext,
  RepositoryContext,
  RepositoryID,
} from "./types"
import {
  CONTEXT_SCHEMA_VERSION,
  componentID,
  evidenceID,
  isConfidence,
  isEdgeRelation,
  nodeID,
  normalizeName,
  normalizeRelativePath,
  pipelineID,
} from "./types"

export const EXPLORATION_DEPTH_VALUES = ["L0", "L1", "L2", "L3", "L4", "L5"] as const
export type ExplorationDepth = (typeof EXPLORATION_DEPTH_VALUES)[number]

export const SCOPE_TYPE_VALUES = [
  "file",
  "directory",
  "module",
  "subsystem",
  "feature",
  "api",
  "runtime_pipeline",
  "build_pipeline",
  "architecture_slice",
  "whole_repository",
] as const
export type ScopeType = (typeof SCOPE_TYPE_VALUES)[number]

export type ResolvedScope = {
  readonly type: ScopeType
  readonly value: string
  readonly depth: ExplorationDepth
  readonly reusedContext: boolean
}

export type ExplorationUnit = {
  readonly id: string
  readonly scope: string
  readonly reason: string
  readonly depth: ExplorationDepth
  readonly broadSearch: boolean
}

export type ExplorationPlan = {
  readonly resolved: ResolvedScope
  readonly units: readonly ExplorationUnit[]
  readonly excludedPaths: readonly string[]
  readonly unknowns: readonly string[]
}

export type FindingValidation =
  | { readonly valid: true; readonly finding: Finding }
  | { readonly valid: false; readonly errors: readonly string[] }

export type BuilderResult = {
  readonly transaction: ContextUpdateTransaction | undefined
  readonly accepted: readonly Finding[]
  readonly unknowns: readonly string[]
}

export type StructuralInput = {
  readonly repositoryID: RepositoryID
  readonly profile: RepositoryProfile
  readonly map: RepositoryMap
  readonly revision?: string
  readonly scope?: string
}

export type SourceFile = {
  readonly file: string
  readonly content: string
}

export type CoordinatorInput = {
  readonly repositoryID: RepositoryID
  readonly root: string
  readonly userScope: string
  readonly existing: RepositoryContext
  readonly profile?: RepositoryProfile
  readonly map?: RepositoryMap
  readonly requestedDepth?: ExplorationDepth
  readonly findings?: readonly Finding[]
  readonly taskID: string
  readonly ownerID?: string
  readonly baseRevision?: string
  readonly sourceRevision?: string
  readonly sources?: readonly SourceFile[]
  readonly reason?: string
}

export type CoordinatorResult = {
  readonly scope: ResolvedScope
  readonly plan: ExplorationPlan
  readonly builder: BuilderResult
}

export function resolveScope(input: {
  readonly root: string
  readonly userScope: string
  readonly profile?: RepositoryProfile
  readonly map?: RepositoryMap
  readonly existing?: RepositoryContext
}): ResolvedScope {
  const value = input.userScope.trim().replace(/^['"]|['"]$/g, "")
  const lower = value.toLocaleLowerCase()
  if (!value || lower === "full" || lower === "whole repository" || lower === "repository")
    return { type: "whole_repository", value: input.root, depth: "L5", reusedContext: false }
  const existing = input.existing?.pipelines.find(
    (pipeline) => pipeline.id === value || pipeline.name.toLocaleLowerCase() === lower,
  )
  if (existing) return { type: "runtime_pipeline", value: existing.id, depth: "L3", reusedContext: true }
  const module = input.map?.modules.find(
    (item) => item.id === value || item.name.toLocaleLowerCase() === lower || item.path.toLocaleLowerCase() === lower,
  )
  if (module) return { type: "module", value: module.path, depth: "L2", reusedContext: Boolean(input.existing) }
  if (input.profile?.sourceRoots.some((root) => root.toLocaleLowerCase() === lower))
    return { type: "directory", value, depth: "L1", reusedContext: Boolean(input.existing) }
  if (/\.[a-z0-9]+$/i.test(value)) return { type: "file", value, depth: "L1", reusedContext: Boolean(input.existing) }
  if (/\b(?:build|compile|package|bazel|gradle|cargo|cmake)\b/i.test(value))
    return { type: "build_pipeline", value, depth: "L3", reusedContext: Boolean(input.existing) }
  if (/\b(?:api|endpoint|route|handler)\b/i.test(value))
    return { type: "api", value, depth: "L2", reusedContext: Boolean(input.existing) }
  if (/\b(?:architecture|cross[- ]module|system)\b/i.test(value))
    return { type: "architecture_slice", value, depth: "L4", reusedContext: Boolean(input.existing) }
  if (/\b(?:pipeline|flow|callback|queue|worker)\b/i.test(value))
    return { type: "subsystem", value, depth: "L3", reusedContext: Boolean(input.existing) }
  return { type: "feature", value, depth: "L2", reusedContext: Boolean(input.existing) }
}

export function depthFor(scope: ScopeType, requested?: ExplorationDepth): ExplorationDepth {
  if (requested) return requested
  if (scope === "file") return "L1"
  if (scope === "directory" || scope === "module") return "L2"
  if (scope === "subsystem" || scope === "api" || scope === "runtime_pipeline" || scope === "build_pipeline")
    return "L3"
  if (scope === "architecture_slice") return "L4"
  return "L5"
}

export function plan(input: {
  readonly root: string
  readonly scope: ResolvedScope
  readonly profile?: RepositoryProfile
  readonly map?: RepositoryMap
  readonly requestedDepth?: ExplorationDepth
}): ExplorationPlan {
  const depth = depthFor(input.scope.type, input.requestedDepth)
  const scale = input.profile?.scale
  const excludedPaths = [
    ...(input.profile?.generatedRoots ?? []),
    ...(input.profile?.dependencyRoots ?? []),
    "build",
    "dist",
    "target",
    "node_modules",
  ]
  const candidates =
    input.scope.type === "whole_repository"
      ? (input.map?.modules.filter((module) => module.path !== ".").map((module) => module.path) ??
        input.profile?.sourceRoots ??
        [])
      : [input.scope.value]
  const scoped = candidates.filter(
    (candidate) => !excludedPaths.some((excluded) => candidate === excluded || candidate.startsWith(`${excluded}/`)),
  )
  const units = (scoped.length > 0 ? scoped : [input.root])
    .slice(0, scale === "MASSIVE" ? 32 : 128)
    .map((scope, index) => ({
      id: `explore_${index + 1}_${slug(scope)}`,
      scope,
      reason: input.scope.type === "whole_repository" ? "hierarchical module coverage" : "requested exploration scope",
      depth,
      broadSearch:
        input.scope.type === "whole_repository" && (scale === "LARGE" || scale === "MASSIVE")
          ? false
          : scope === input.root,
    }))
  return {
    resolved: { ...input.scope, depth },
    units,
    excludedPaths: [...new Set(excludedPaths)].sort(),
    unknowns:
      input.scope.type === "whole_repository"
        ? ["Detailed control and data flow requires targeted pipeline findings."]
        : [],
  }
}

export function coordinate(input: CoordinatorInput): CoordinatorResult {
  const scope = resolveScope({
    root: input.root,
    userScope: input.userScope,
    profile: input.profile,
    map: input.map,
    existing: input.existing,
  })
  const explorationPlan = plan({
    root: input.root,
    scope,
    profile: input.profile,
    map: input.map,
    requestedDepth: input.requestedDepth,
  })
  const findings = input.findings ?? [
    ...(input.profile && input.map
      ? structuralFindings({
          repositoryID: input.repositoryID,
          profile: input.profile,
          map: input.map,
          ...(input.sourceRevision ? { revision: input.sourceRevision } : {}),
          scope: scope.value,
        })
      : []),
    ...(input.sources
      ? sourceFindings({ sources: input.sources, scope: scope.value, revision: input.sourceRevision })
      : []),
  ]
  const builder = build({
    repositoryID: input.repositoryID,
    existing: input.existing,
    findings,
    taskID: input.taskID,
    ...(input.ownerID ? { ownerID: input.ownerID } : {}),
    ...(input.baseRevision ? { baseRevision: input.baseRevision } : {}),
    ...(input.sourceRevision ? { sourceRevision: input.sourceRevision } : {}),
    scope: scope.value,
    reason: input.reason ?? `explore ${scope.value}`,
  })
  return { scope, plan: explorationPlan, builder }
}

export function parseFinding(value: unknown, root: string): FindingValidation {
  if (!record(value)) return invalid(["finding must be an object"])
  if (
    typeof value.subject !== "string" ||
    typeof value.object !== "string" ||
    !isEdgeRelation(value.relation) ||
    !isConfidence(value.confidence)
  )
    return invalid(["finding subject, relation, object, and confidence are required"])
  if (!Array.isArray(value.evidence)) return invalid(["finding evidence must be an array"])
  const evidence = value.evidence.flatMap((item) => parseFindingEvidence(item, root))
  if (evidence.length !== value.evidence.length) return invalid(["finding contains invalid evidence"])
  const subject = boundedText(value.subject, 240)
  const object = boundedText(value.object, 240)
  if (!subject || !object) return invalid(["finding subject and object are empty or too long"])
  const explanation = typeof value.explanation === "string" ? boundedText(value.explanation, 2_000) : undefined
  const scope = typeof value.scope === "string" ? boundedText(value.scope, 240) : undefined
  const finding: Finding = {
    subject,
    relation: value.relation,
    object,
    confidence: value.confidence,
    evidence,
    ...(explanation ? { explanation } : {}),
    ...(scope ? { scope } : {}),
  }
  if (!finding.subject || !finding.object) return invalid(["finding subject and object cannot be empty"])
  if (finding.confidence === "VERIFIED" && finding.evidence.length === 0)
    return invalid(["VERIFIED finding requires evidence"])
  return { valid: true, finding }
}

export function parseFindingEnvelope(text: string, root: string): Finding[] {
  const match = text.match(/<ocx_context_findings>\s*([\s\S]*?)\s*<\/ocx_context_findings>/i)
  if (!match) return []
  try {
    const value = JSON.parse(match[1] ?? "") as unknown
    const rows = Array.isArray(value) ? value : [value]
    return rows.flatMap((item) => {
      const parsed = parseFinding(item, root)
      return parsed.valid ? [parsed.finding] : []
    })
  } catch {
    return []
  }
}

export function build(input: {
  readonly repositoryID: RepositoryID
  readonly existing: RepositoryContext
  readonly findings: readonly Finding[]
  readonly taskID: string
  readonly ownerID?: string
  readonly baseRevision?: string
  readonly sourceRevision?: string
  readonly scope?: string
  readonly reason: string
  readonly now?: number
}): BuilderResult {
  const accepted = input.findings.filter(
    (finding) =>
      finding.confidence !== "HYPOTHESIS" && finding.confidence !== "STALE" && finding.confidence !== "CONFLICTED",
  )
  const unknowns = input.findings
    .filter(
      (finding) =>
        finding.confidence === "HYPOTHESIS" || finding.confidence === "STALE" || finding.confidence === "CONFLICTED",
    )
    .map(
      (finding) =>
        `${finding.subject} ${finding.relation} ${finding.object} was not promoted from ${finding.confidence}.`,
    )
  if (accepted.length === 0) return { transaction: undefined, accepted: [], unknowns }

  const nodes = new Map<ContextNodeID, ContextNode>()
  const edges = new Map<ContextEdgeID, ContextEdge>()
  const evidence = new Map<EvidenceID, EvidenceRef>()
  const groups = new Map<
    string,
    {
      readonly nodes: Set<ContextNodeID>
      readonly edges: Set<ContextEdgeID>
      readonly evidence: Set<EvidenceID>
      readonly ownerIDs: string[]
      confidence: Finding["confidence"]
      readonly claims: ContextClaim[]
      readonly unknowns: string[]
      readonly explanation: string[]
    }
  >()
  for (const finding of accepted) {
    const groupID = slug(finding.scope || input.scope || `${finding.subject}-${finding.object}`)
    const group = groups.get(groupID) ?? {
      nodes: new Set<ContextNodeID>(),
      edges: new Set<ContextEdgeID>(),
      evidence: new Set<EvidenceID>(),
      ownerIDs: input.ownerID ? [input.ownerID] : [],
      confidence: "UNKNOWN",
      claims: [],
      unknowns: [],
      explanation: [],
    }
    const evidenceIDs = finding.evidence.map((item) => {
      const record = evidenceRecord(item, input.repositoryID, input.sourceRevision)
      evidence.set(record.id, record)
      return record.id
    })
    const subject = addFindingEvidence(
      ensureNode(input.existing, nodes, input.repositoryID, finding.subject),
      finding.evidence,
      evidenceIDs,
      finding.confidence,
    )
    const object = addFindingEvidence(
      ensureNode(input.existing, nodes, input.repositoryID, finding.object),
      finding.evidence,
      evidenceIDs,
      finding.confidence,
    )
    nodes.set(subject.id, subject)
    nodes.set(object.id, object)
    group.nodes.add(subject.id)
    group.nodes.add(object.id)
    if (subject.id !== object.id) {
      const nextEdge = edge(
        input.repositoryID,
        subject.id,
        object.id,
        finding.relation,
        finding.confidence,
        evidenceIDs,
        input.sourceRevision,
      )
      edges.set(nextEdge.id, nextEdge)
      group.edges.add(nextEdge.id)
    }
    evidenceIDs.forEach((id) => group.evidence.add(id))
    group.confidence = strongerConfidence(group.confidence, finding.confidence)
    if (finding.explanation) {
      group.explanation.push(finding.explanation)
      group.claims.push({
        id: `claim-${createHash("sha256").update(`${groupID}\0${finding.explanation}`).digest("hex").slice(0, 24)}`,
        text: finding.explanation,
        confidence: finding.confidence,
        status: "active",
        evidenceIDs,
      })
    }
    if (finding.confidence === "UNKNOWN")
      group.unknowns.push(`${finding.subject} ${finding.relation} ${finding.object} is not explored.`)
    groups.set(groupID, group)
  }
  const components = [...groups.entries()].map(([groupID, group]) =>
    component(input.repositoryID, groupID, group, evidence),
  )
  const pipelines = [...groups.entries()].map(([groupID, group]) =>
    pipeline(input.repositoryID, groupID, group, input.sourceRevision),
  )
  const operations = [
    ...[...evidence.values()].map((item) => ({ op: "upsert_evidence" as const, evidence: item })),
    ...[...nodes.values()].map((item) => ({ op: "upsert_node" as const, node: item })),
    ...[...edges.values()].map((item) => ({ op: "upsert_edge" as const, edge: item })),
    ...components.map((item) => ({ op: "upsert_component" as const, component: item })),
    ...pipelines.map((item) => ({ op: "upsert_pipeline" as const, pipeline: item })),
  ]
  return {
    transaction: ContextTransactionManager.create({
      repositoryID: input.repositoryID,
      ...(input.baseRevision ? { baseRevision: input.baseRevision } : {}),
      ...(input.sourceRevision ? { sourceRevision: input.sourceRevision } : {}),
      origin: { taskID: input.taskID, ...(input.ownerID ? { ownerID: input.ownerID } : {}) },
      reason: input.reason,
      operations,
      ...(input.now !== undefined ? { now: input.now } : {}),
    }),
    accepted,
    unknowns,
  }
}

export function structuralFindings(input: StructuralInput): Finding[] {
  const findings: Finding[] = []
  const repository = "repository" as const
  const scope = input.scope?.replaceAll("\\", "/").replace(/^\.\//, "")
  for (const module of input.map.modules
    .filter((item) => item.path !== ".")
    .filter((item) => {
      const excluded = [...input.profile.generatedRoots, ...input.profile.dependencyRoots]
      return !excluded.some((root) => item.path === root || item.path.startsWith(`${root}/`))
    })
    .filter(
      (item) => !scope || scope === input.profile.root || item.path === scope || item.path.startsWith(`${scope}/`),
    )
    .slice(0, 256)) {
    findings.push({
      subject: repository,
      relation: "owns",
      object: `module:${module.path}`,
      confidence: "INFERRED",
      evidence: [],
      scope: "repository architecture",
      explanation: `${module.name} is a mapped ${module.type} module at ${module.path}.`,
    })
  }
  if (findings.length === 0) {
    const targetScope = scope && scope !== "." ? scope : "workspace"
    findings.push({
      subject: repository,
      relation: "owns",
      object: `directory:${targetScope}`,
      confidence: "SUPPORTED",
      evidence: [],
      scope: "repository architecture",
      explanation: `Directory ${targetScope} contains active project files.`,
    })
  }
  return findings
}

export function sourceFindings(input: {
  readonly sources: readonly SourceFile[]
  readonly scope?: string
  readonly revision?: string
}): Finding[] {
  const files = new Set(input.sources.map((source) => normalizeSourcePath(source.file)))
  return input.sources.flatMap((source) => {
    const file = normalizeSourcePath(source.file)
    const scope = input.scope?.replaceAll("\\", "/").replace(/^\.\//, "")
    if (scope && scope !== file && !file.startsWith(`${scope}/`)) return []
    const imports = [...source.content.matchAll(/\b(?:from|import)\s*["']([^"']+)["']/g)]
      .map((match) => resolveImport(file, match[1] ?? "", files))
      .filter((value): value is string => value !== undefined)
    return imports.map((target) => ({
      subject: `file:${file}`,
      relation: "depends_on" as const,
      object: `file:${target}`,
      confidence: "VERIFIED" as const,
      evidence: [
        {
          file,
          contentHash: createHash("sha256").update(source.content).digest("hex"),
          observation: `${file} imports ${target}.`,
        },
      ],
      ...(input.scope ? { scope: input.scope } : {}),
      ...(input.revision ? { explanation: `Import flow verified at ${input.revision}.` } : {}),
    }))
  })
}

function parseFindingEvidence(value: unknown, root: string): FindingEvidence[] {
  if (!record(value) || typeof value.file !== "string" || typeof value.observation !== "string") return []
  try {
    const file = normalizeRelativePath(value.file)
    const absolute = `${root.replace(/[\\/]$/, "")}/${file}`
    if (absolute.includes("/../") || absolute.endsWith("/..")) return []
    const lineStart = validLine(value.lineStart) ? value.lineStart : undefined
    const lineEnd = validLine(value.lineEnd) ? value.lineEnd : undefined
    if (lineEnd !== undefined && lineStart !== undefined && lineEnd < lineStart) return []
    const observation = boundedText(value.observation, 2_000)
    if (!observation) return []
    return [
      {
        file,
        ...(typeof value.symbol === "string" ? { symbol: value.symbol.trim() } : {}),
        ...(lineStart !== undefined ? { lineStart } : {}),
        ...(lineEnd !== undefined ? { lineEnd } : {}),
        ...(typeof value.contentHash === "string" && value.contentHash.trim()
          ? { contentHash: value.contentHash.trim() }
          : {}),
        observation,
      },
    ]
  } catch {
    return []
  }
}

function ensureNode(
  context: RepositoryContext,
  nodes: Map<ContextNodeID, ContextNode>,
  repositoryID: RepositoryID,
  value: string,
): ContextNode {
  const canonicalName = normalizeName(value)
  const normalized = canonicalName.toLocaleLowerCase()
  const existing = context.nodes.find(
    (node) =>
      node.canonicalName.toLocaleLowerCase() === normalized ||
      node.aliases.some((alias) => alias.toLocaleLowerCase() === normalized),
  )
  if (existing) {
    nodes.set(existing.id, existing)
    return existing
  }
  const id = nodeID(`node-${slug(canonicalName)}`)
  const current = nodes.get(id)
  if (current) return current
  const created: ContextNode = {
    id,
    schemaVersion: CONTEXT_SCHEMA_VERSION,
    kind: nodeKind(canonicalName),
    canonicalName,
    repositoryID,
    metadata: {},
    confidence: "UNKNOWN",
    status: "active",
    evidenceIDs: [],
    aliases: [],
  }
  nodes.set(id, created)
  return created
}

function evidenceRecord(item: FindingEvidence, repositoryID: RepositoryID, revision?: string): EvidenceRef {
  const hash =
    item.contentHash ||
    createHash("sha256")
      .update(`${item.file}\0${item.symbol ?? ""}\0${item.observation}`)
      .digest("hex")
  const id = evidenceID(
    `evidence-${createHash("sha256")
      .update(`${repositoryID}\0${item.file}\0${item.symbol ?? ""}\0${hash}`)
      .digest("hex")
      .slice(0, 32)}`,
  )
  return {
    id,
    schemaVersion: CONTEXT_SCHEMA_VERSION,
    type: "source_code" as const,
    ...(revision ? { repositoryRevision: revision } : {}),
    file: item.file,
    ...(item.symbol ? { symbol: item.symbol } : {}),
    ...(item.lineStart !== undefined ? { lineStart: item.lineStart } : {}),
    ...(item.lineEnd !== undefined ? { lineEnd: item.lineEnd } : {}),
    contentHash: hash,
    observation: item.observation,
  }
}

function addFindingEvidence(
  node: ContextNode,
  findings: readonly FindingEvidence[],
  evidenceIDs: readonly EvidenceID[],
  findingConfidence: Finding["confidence"],
): ContextNode {
  const files = findings.map((item) => item.file)
  const symbols = findings.flatMap((item) => (item.symbol ? [item.symbol] : []))
  return {
    ...node,
    metadata: {
      ...node.metadata,
      ...(files.length > 0
        ? { files: [...new Set([...metadataStrings(node.metadata, "file", "files"), ...files])] }
        : {}),
      ...(symbols.length > 0
        ? { symbols: [...new Set([...metadataStrings(node.metadata, "symbol", "symbols"), ...symbols])] }
        : {}),
    },
    evidenceIDs: [...new Set([...node.evidenceIDs, ...evidenceIDs])],
    confidence: strongerConfidence(node.confidence, findingConfidence),
    status: "active",
  }
}

function metadataStrings(metadata: ContextNode["metadata"], ...keys: string[]): string[] {
  return keys.flatMap((key) => {
    const value = metadata[key]
    if (typeof value === "string") return [value]
    if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string")
    return []
  })
}

function edge(
  repositoryID: RepositoryID,
  from: ContextNode["id"],
  to: ContextNode["id"],
  relation: EdgeRelation,
  confidence: Finding["confidence"],
  evidenceIDs: readonly EvidenceID[],
  revision?: string,
): ContextEdge {
  const id = ContextGraph.stableEdgeID({ from, to, relation })
  return {
    id,
    schemaVersion: CONTEXT_SCHEMA_VERSION,
    from,
    to,
    relation,
    repositoryID,
    confidence,
    status: "active" as const,
    evidenceIDs,
    ...(revision ? { lastVerifiedRevision: revision } : {}),
  }
}

function component(
  repositoryID: RepositoryID,
  groupID: string,
  group: {
    readonly nodes: Set<ContextNodeID>
    readonly edges: Set<ContextEdgeID>
    readonly evidence: Set<EvidenceID>
    readonly ownerIDs: string[]
    confidence: Finding["confidence"]
    readonly claims: ContextClaim[]
    readonly unknowns: string[]
    readonly explanation: string[]
  },
  evidence: ReadonlyMap<EvidenceID, EvidenceRef>,
): ComponentContext {
  return {
    id: componentID(`component-${slug(groupID)}`),
    schemaVersion: CONTEXT_SCHEMA_VERSION,
    repositoryID,
    name: groupID,
    summary: group.explanation[0] || `Component for ${groupID}.`,
    status: "active",
    confidence: group.confidence,
    filePaths: [
      ...new Set(
        [...group.evidence].map((id) => evidence.get(id)?.file).filter((file): file is string => file !== undefined),
      ),
    ],
    symbolNames: [
      ...new Set(
        [...group.evidence]
          .map((id) => evidence.get(id)?.symbol)
          .filter((symbol): symbol is string => symbol !== undefined),
      ),
    ],
    ownerIDs: group.ownerIDs,
    evidenceIDs: [...group.evidence],
  }
}

function pipeline(
  repositoryID: RepositoryID,
  groupID: string,
  group: {
    readonly nodes: Set<ContextNodeID>
    readonly edges: Set<ContextEdgeID>
    readonly evidence: Set<EvidenceID>
    readonly ownerIDs: string[]
    confidence: Finding["confidence"]
    readonly claims: ContextClaim[]
    readonly unknowns: string[]
    readonly explanation: string[]
  },
  revision?: string,
): PipelineContext {
  const nodeIDs: PipelineContext["nodeIDs"] = [...group.nodes]
  const edgeIDs: PipelineContext["edgeIDs"] = [...group.edges]
  return {
    id: pipelineID(`pipeline-${slug(groupID)}`),
    schemaVersion: CONTEXT_SCHEMA_VERSION,
    repositoryID,
    name: groupID,
    kind: "runtime_pipeline",
    summary: group.explanation[0] || `Pipeline for ${groupID}.`,
    status: "active",
    confidence: group.confidence,
    ...(revision ? { lastVerifiedRevision: revision } : {}),
    entryPoints: nodeIDs.flatMap((nodeID, index) => (index === 0 ? [{ nodeID }] : [])),
    nodeIDs,
    edgeIDs,
    constraints: group.claims,
    unknowns: [...new Set(group.unknowns)],
    relatedPipelineIDs: [],
    ownerIDs: group.ownerIDs,
    evidenceIDs: [...group.evidence],
  }
}

function invalid(errors: readonly string[]): FindingValidation {
  return { valid: false, errors }
}

function strongerConfidence(left: Finding["confidence"], right: Finding["confidence"]): Finding["confidence"] {
  const rank: Record<Finding["confidence"], number> = {
    HYPOTHESIS: 0,
    UNKNOWN: 1,
    INFERRED: 2,
    SUPPORTED: 3,
    VERIFIED: 4,
    STALE: -1,
    CONFLICTED: -2,
  }
  return rank[right] >= rank[left] ? right : left
}

function nodeKind(value: string): ContextNode["kind"] {
  const normalized = value.toLocaleLowerCase()
  if (normalized === "repository") return "repository"
  if (normalized.startsWith("module:")) return "module"
  if (normalized.startsWith("file:")) return "file"
  if (normalized.startsWith("symbol:")) return "symbol"
  if (normalized.startsWith("pipeline:")) return "pipeline"
  if (normalized.startsWith("process:")) return "process"
  if (normalized.startsWith("thread:")) return "thread"
  if (normalized.startsWith("config:") || normalized.startsWith("configuration:")) return "configuration"
  if (normalized.startsWith("data:") || normalized.startsWith("data_structure:")) return "data_structure"
  return "component"
}

function normalizeSourcePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\//, "")
}

function resolveImport(file: string, specifier: string, files: ReadonlySet<string>): string | undefined {
  if (!specifier.startsWith(".")) return undefined
  const directory = file.includes("/") ? file.slice(0, file.lastIndexOf("/")) : "."
  const base = path.posix.normalize(path.posix.join(directory, specifier)).replace(/^\.\//, "")
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
    `${base}/index.js`,
  ]
  return candidates.find((candidate) => files.has(candidate) && !candidate.split("/").includes(".."))
}

function validLine(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function slug(value: string): string {
  const normalized = value
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return normalized.slice(0, 64) || "unknown"
}

function boundedText(value: string, max: number): string | undefined {
  const clean = value.replace(/\s+/g, " ").trim()
  return clean.length > 0 && clean.length <= max ? clean : undefined
}
