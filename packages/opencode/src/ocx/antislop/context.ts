import { CodebaseMap } from "../codebase/map"
import type { ModuleRecord, RepositoryMap } from "../codebase/types"
import {
  findCallers,
  findCallees,
  findDependents,
  findReferences,
  type SemanticGraph,
  type SemanticNode,
} from "../semantic/graph"

export type SemanticNeighborhood = {
  readonly symbol?: SemanticNode
  readonly owner?: SemanticNode
  readonly callers: readonly SemanticNode[]
  readonly callees: readonly SemanticNode[]
  readonly dependents: readonly SemanticNode[]
  readonly siblings: readonly SemanticNode[]
  readonly tests: readonly SemanticNode[]
  readonly references: readonly string[]
}

export type ArchitectureContext = {
  readonly module?: ModuleRecord
  readonly relatedModules: readonly ModuleRecord[]
  readonly evidence: readonly string[]
}

export function neighborhood(graph: SemanticGraph, symbol: string): SemanticNeighborhood {
  const node = graph.nodes.find((item) => item.id === symbol || item.name === symbol)
  if (!node) return emptyNeighborhood()
  const owner = ownerNode(graph, node)
  const callers = findCallers(graph, node.id)
  const callees = findCallees(graph, node.id)
  const dependents = findDependents(graph, node.id)
  const siblings = graph.nodes.filter(
    (item) => item.id !== node.id && item.path.split("/").slice(0, -1).join("/") === node.path.split("/").slice(0, -1).join("/"),
  )
  const tests = graph.nodes.filter(
    (item) => item.kind === "test" && graph.edges.some((edge) => edge.source === item.id && edge.target === node.id && edge.kind === "tests"),
  )
  const references = findReferences(graph, node.id).map((edge) => `${edge.kind}:${edge.source}->${edge.target}`)
  return { symbol: node, ...(owner ? { owner } : {}), callers, callees, dependents, siblings, tests, references }
}

export function architectureContext(map: RepositoryMap, pathOrModule: string): ArchitectureContext {
  const module = CodebaseMap.moduleForPath(map, pathOrModule) ?? map.modules.find(
    (item) => item.path === pathOrModule || item.name === pathOrModule || item.id === pathOrModule,
  )
  if (!module) return { relatedModules: [], evidence: [] }
  const relatedModules = CodebaseMap.relatedModules(map, module.path)
  const evidence = [
    `module ${module.path} uses the ${module.type} boundary`,
    module.buildSystem ? `build system: ${module.buildSystem}` : undefined,
    module.sourceRoots.length > 0 ? `source roots: ${module.sourceRoots.join(", ")}` : undefined,
    module.testRoots.length > 0 ? `test roots: ${module.testRoots.join(", ")}` : undefined,
  ].filter((item): item is string => item !== undefined)
  return { module, relatedModules, evidence }
}

export function evidence(context: SemanticNeighborhood): string[] {
  return [
    context.symbol ? `${context.symbol.kind} ${context.symbol.name} in ${context.symbol.path}` : undefined,
    context.owner ? `owner: ${context.owner.name}` : undefined,
    context.callers.length > 0 ? `callers: ${context.callers.map((item) => item.name).join(", ")}` : undefined,
    context.callees.length > 0 ? `callees: ${context.callees.map((item) => item.name).join(", ")}` : undefined,
    context.tests.length > 0 ? `tests: ${context.tests.map((item) => item.name).join(", ")}` : undefined,
  ].filter((item): item is string => item !== undefined)
}

function ownerNode(graph: SemanticGraph, node: SemanticNode): SemanticNode | undefined {
  const edge = graph.edges.find(
    (item) => item.source === node.id && (item.kind === "belongs-to" || item.kind === "owns"),
  )
  return edge ? graph.nodes.find((item) => item.id === edge.target) : undefined
}

function emptyNeighborhood(): SemanticNeighborhood {
  return { callers: [], callees: [], dependents: [], siblings: [], tests: [], references: [] }
}

export * as AntiSlopContext from "./context"
