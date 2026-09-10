export * as ContextCommandService from "./commands"

import type { RepositoryMap, RepositoryProfile } from "../codebase/types"
import { ContextExploration } from "./exploration"
import type { SourceFile } from "./exploration"
import { ContextRenderer } from "./renderer"
import { ContextRetriever } from "./retriever"
import { ContextService } from "./service"
import type { ContextBudget, Finding, RepositoryID } from "./types"

export const CONTEXT_OPERATION_VALUES = [
  "show",
  "map",
  "pipelines",
  "components",
  "search",
  "stale",
  "history",
  "refresh",
  "evidence",
  "forget",
  "help",
] as const
export type ContextOperation = (typeof CONTEXT_OPERATION_VALUES)[number]

export type ParsedCommand = {
  readonly command: "explore" | "context"
  readonly operation: ContextOperation
  readonly scope?: string
  readonly query?: string
}

export type MapperSnapshot = {
  readonly profile: RepositoryProfile
  readonly map: RepositoryMap
  readonly revision?: string
  readonly sources?: readonly SourceFile[]
}

export type CommandResult = {
  readonly text: string
  readonly changed: boolean
  readonly repositoryID?: RepositoryID
  readonly confirmationRequired?: boolean
}

export type ExecuteInput = {
  readonly root: string
  readonly command: string | ParsedCommand
  readonly store?: Parameters<typeof ContextService.open>[0]["store"]
  readonly mapper?: MapperSnapshot
  readonly findings?: readonly Finding[]
  readonly confirmForget?: boolean
  readonly taskID?: string
  readonly ownerID?: string
  readonly budget?: Partial<ContextBudget>
}

export function parse(input: string): ParsedCommand | undefined {
  const tokens = tokenize(input.trim())
  const command = tokens.shift()?.toLocaleLowerCase()
  if (command === "/explore_codebase") {
    const scope = tokens.join(" ").trim()
    return { command: "explore", operation: "show", ...(scope ? { scope } : {}) }
  }
  if (command !== "/context") return undefined
  const operation = (tokens.shift()?.toLocaleLowerCase() || "show") as ContextOperation
  if (!CONTEXT_OPERATION_VALUES.includes(operation)) return { command: "context", operation: "help" }
  const scope = tokens.join(" ").trim()
  return { command: "context", operation, ...(scope ? { scope } : {}) }
}

export function help(): string {
  return [
    "Context commands:",
    "/explore_codebase <scope>",
    "/context show <scope>",
    "/context map <scope>",
    "/context pipelines [scope]",
    "/context components [scope]",
    "/context search <query>",
    "/context stale [scope]",
    "/context history [scope]",
    "/context refresh <scope>",
    "/context evidence [scope]",
    "/context forget <scope>",
  ].join("\n")
}

export function execute(input: ExecuteInput): CommandResult {
  const parsed = typeof input.command === "string" ? parse(input.command) : input.command
  if (!parsed) return { text: "Unknown context command.\n\n" + help(), changed: false }
  if (parsed.operation === "help") return { text: help(), changed: false }
  let handle: ReturnType<typeof ContextService.open>
  try {
    handle = ContextService.open({ root: input.root, store: input.store, revision: input.mapper?.revision })
  } catch (error) {
    return {
      changed: false,
      text: `Context is unavailable: ${error instanceof Error ? error.message : String(error)}. Continue with the codebase mapper and targeted exploration.`,
    }
  }
  try {
    if (parsed.command === "explore") return explore(handle, parsed, input)
    if (parsed.operation === "forget") return forget(handle, parsed.scope, input.confirmForget === true)
    if (parsed.operation === "refresh") return refresh(handle, parsed.scope)
    return view(handle, parsed, input.budget)
  } catch (error) {
    return {
      repositoryID: handle.repositoryID,
      changed: false,
      text: `Context operation unavailable: ${error instanceof Error ? error.message : String(error)}. No source files were changed.`,
    }
  }
}

function explore(
  handle: ReturnType<typeof ContextService.open>,
  parsed: ParsedCommand,
  input: ExecuteInput,
): CommandResult {
  const findings = input.findings ? ContextService.verifyFindings(handle, input.findings) : undefined
  const coordinated = ContextExploration.coordinate({
    repositoryID: handle.repositoryID,
    root: handle.root,
    userScope: parsed.scope ?? "full",
    existing: handle.context,
    ...(input.mapper?.profile ? { profile: input.mapper.profile } : {}),
    ...(input.mapper?.map ? { map: input.mapper.map } : {}),
    ...(input.mapper?.sources ? { sources: input.mapper.sources } : {}),
    ...(findings ? { findings } : {}),
    taskID: input.taskID ?? `explore-${Date.now()}`,
    ...(input.ownerID ? { ownerID: input.ownerID } : {}),
    baseRevision: handle.context.manifest.lastSeenRevision,
    ...(input.mapper?.revision ? { sourceRevision: input.mapper.revision } : {}),
    reason: `explicit exploration of ${parsed.scope ?? "full"}`,
  })
  const { scope, plan, builder: built } = coordinated
  const applied = built.transaction ? ContextService.apply(handle, built.transaction) : undefined
  const context = applied?.context ?? handle.context
  return {
    repositoryID: handle.repositoryID,
    changed: applied !== undefined,
    text: [
      `Resolved scope: ${scope.type} ${scope.value}`,
      `Depth: ${plan.resolved.depth}`,
      `Existing context reused: ${scope.reusedContext ? "yes" : "no"}`,
      `Units: ${plan.units.length}`,
      `Pipelines stored: ${context.pipelines.length}`,
      `Components stored: ${context.components.length}`,
      `Evidence stored: ${context.evidence.length}`,
      `Storage: ${handle.store.root}`,
      ...(plan.excludedPaths.length > 0 ? [`Excluded by default: ${plan.excludedPaths.join(", ")}`] : []),
      ...(built.unknowns.length > 0 ? ["Unknowns:", ...built.unknowns.map((item) => `- ${item}`)] : []),
      ...(plan.unknowns.length > 0 ? ["Remaining gaps:", ...plan.unknowns.map((item) => `- ${item}`)] : []),
      "",
      ContextRenderer.renderCompact(context, undefined, 8_000),
    ].join("\n"),
  }
}

function view(
  handle: ReturnType<typeof ContextService.open>,
  parsed: ParsedCommand,
  budget: Partial<ContextBudget> | undefined,
): CommandResult {
  const scope = parsed.scope
  if (parsed.operation === "map") return result(handle, ContextRenderer.renderCompact(handle.context, scope), false)
  if (parsed.operation === "pipelines")
    return result(handle, ContextRenderer.renderPipelines(scoped(handle.context, scope)), false)
  if (parsed.operation === "components")
    return result(handle, ContextRenderer.renderComponents(scoped(handle.context, scope)), false)
  if (parsed.operation === "stale") return result(handle, ContextRenderer.renderStale(handle.context), false)
  if (parsed.operation === "history")
    return result(handle, ContextRenderer.renderHistory(handle.store.history(handle.repositoryID)), false)
  if (parsed.operation === "evidence")
    return result(handle, ContextRenderer.renderEvidence(scoped(handle.context, scope)), false)
  const query = ContextRetriever.retrieve({
    context: handle.context,
    query: {
      repositoryID: handle.repositoryID,
      ...(parsed.operation === "search" ? { taskText: scope } : { scopeHints: scope ? [scope] : [] }),
    },
    budget,
  })
  if (parsed.operation === "search") return result(handle, ContextRenderer.renderAgentPacket(query.packet), false)
  if (scope && query.packet.pipelineIDs.length > 0)
    return result(handle, ContextRenderer.renderDetailed(handle.context, query.packet.pipelineIDs[0]), false)
  return result(handle, ContextRenderer.renderAgentPacket(query.packet), false)
}

function refresh(handle: ReturnType<typeof ContextService.open>, scope: string | undefined): CommandResult {
  const files = scope ? [scope] : undefined
  const refreshed = ContextService.refresh(handle, ContextService.sourceSnapshot(handle, files))
  return {
    repositoryID: handle.repositoryID,
    changed: refreshed.changed,
    text: [
      `Freshness: ${refreshed.report.state}`,
      `Unchanged evidence: ${refreshed.report.unchangedEvidenceIDs.length}`,
      `Moved evidence: ${refreshed.report.movedEvidenceIDs.length}`,
      `Changed evidence: ${refreshed.report.changedEvidenceIDs.length}`,
      `Missing evidence: ${refreshed.report.missingEvidenceIDs.length}`,
      `Affected entries: ${refreshed.report.affectedEntryIDs.length}`,
    ].join("\n"),
  }
}

function forget(
  handle: ReturnType<typeof ContextService.open>,
  scope: string | undefined,
  confirmed: boolean,
): CommandResult {
  if (!scope || scope.trim().toLocaleLowerCase() !== handle.repositoryID.toLocaleLowerCase())
    return {
      repositoryID: handle.repositoryID,
      changed: false,
      confirmationRequired: true,
      text: `Context forget requires the exact repository ID (${handle.repositoryID}) as its scope. No context was deleted.`,
    }
  if (confirmed) {
    ContextService.forget(handle)
    return {
      repositoryID: handle.repositoryID,
      changed: true,
      text: `Deleted OCX context data for ${handle.repositoryID}. Source files were not changed.`,
    }
  }
  return {
    repositoryID: handle.repositoryID,
    changed: false,
    confirmationRequired: true,
    text: `Context for ${handle.repositoryID} is ready to delete. Repeat with explicit confirmation to remove only OCX context data.`,
  }
}

function result(handle: ReturnType<typeof ContextService.open>, text: string, changed: boolean): CommandResult {
  return { repositoryID: handle.repositoryID, text, changed }
}

function scoped(context: ReturnType<typeof ContextService.open>["context"], scope: string | undefined) {
  if (!scope) return context
  const query = scope.toLocaleLowerCase()
  const pipelines = context.pipelines.filter(
    (pipeline) =>
      pipeline.id.toLocaleLowerCase().includes(query) ||
      pipeline.name.toLocaleLowerCase().includes(query) ||
      pipeline.summary.toLocaleLowerCase().includes(query) ||
      pipeline.nodeIDs.some((id) =>
        context.nodes
          .find((node) => node.id === id)
          ?.canonicalName.toLocaleLowerCase()
          .includes(query),
      ),
  )
  const pipelineIDs = new Set(pipelines.map((pipeline) => pipeline.id))
  const components = context.components.filter(
    (component) =>
      component.name.toLocaleLowerCase().includes(query) ||
      component.summary.toLocaleLowerCase().includes(query) ||
      component.filePaths.some((file) => file.toLocaleLowerCase().includes(query)) ||
      component.symbolNames.some((symbol) => symbol.toLocaleLowerCase().includes(query)),
  )
  const evidence = context.evidence.filter(
    (item) => item.file.toLocaleLowerCase().includes(query) || item.symbol?.toLocaleLowerCase().includes(query),
  )
  return {
    ...context,
    pipelines,
    components,
    evidence,
    nodes: context.nodes.filter(
      (node) =>
        pipelines.some((pipeline) => pipelineIDs.has(pipeline.id) && pipeline.nodeIDs.includes(node.id)) ||
        node.canonicalName.toLocaleLowerCase().includes(query),
    ),
  }
}

function tokenize(value: string): string[] {
  return (value.match(/"[^"]*"|'[^']*'|[^\s]+/g) ?? []).map((item) => item.replace(/^['"]|['"]$/g, ""))
}
