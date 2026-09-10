export * as SemanticGraph from "./graph"

export type SemanticNode = {
  readonly id: string
  readonly kind: "symbol" | "type" | "function" | "class" | "module" | "file" | "test" | "api" | "config" | "asset"
  readonly name: string
  readonly path: string
  readonly language?: string
  readonly signature?: string
  readonly doc?: string
  readonly exported: boolean
  readonly attributes: readonly string[]
}

export type SemanticEdge = {
  readonly source: string
  readonly target: string
  readonly kind: "calls" | "imports" | "extends" | "implements" | "references" | "depends-on" | "exposes" | "consumes" | "tests" | "owns" | "belongs-to"
  readonly weight: number
}

export type SemanticGraph = {
  readonly nodes: readonly SemanticNode[]
  readonly edges: readonly SemanticEdge[]
  readonly modules: readonly string[]
  readonly entryPoints: readonly string[]
  readonly publicApi: readonly SemanticNode[]
  readonly testTargets: readonly SemanticNode[]
}

export type SymbolInfo = {
  readonly name: string
  readonly kind: string
  readonly file: string
  readonly line: number
  readonly column: number
  readonly signature?: string
  readonly doc?: string
  readonly isExported: boolean
  readonly callers: readonly string[]
  readonly callees: readonly string[]
  readonly dependencies: readonly string[]
}

export type DependencyGraph = {
  readonly nodes: readonly string[]
  readonly edges: readonly { readonly from: string; readonly to: string; readonly kind: string }[]
  readonly cycles: readonly string[][]
}

export type ImpactResult = {
  readonly directFiles: readonly string[]
  readonly callers: readonly string[]
  readonly implementations: readonly string[]
  readonly dependents: readonly string[]
  readonly tests: readonly string[]
  readonly modules: readonly string[]
  readonly publicApiExposure: boolean
  readonly persistenceImpact: boolean
  readonly protocolImpact: boolean
  readonly buildTargets: readonly string[]
  readonly threadingImpact: boolean
  readonly securityImpact: boolean
  readonly risk: "low" | "medium" | "medium-high" | "high" | "critical"
}

export function buildGraph(nodes: readonly SemanticNode[], edges: readonly SemanticEdge[]): SemanticGraph {
  const moduleSet = new Set<string>()
  const entryPoints: SemanticNode[] = []
  const publicApi: SemanticNode[] = []
  const testTargets: SemanticNode[] = []

  for (const node of nodes) {
    const module = node.path.split("/").slice(0, -1).join("/")
    if (module) moduleSet.add(module)
    if (node.exported && node.kind !== "test") publicApi.push(node)
    if (node.kind === "test") testTargets.push(node)
    if (node.attributes.includes("entry")) entryPoints.push(node)
  }

  return {
    nodes,
    edges,
    modules: [...moduleSet],
    entryPoints: entryPoints.map((n) => n.id),
    publicApi,
    testTargets,
  }
}

export function findSymbol(graph: SemanticGraph, name: string): readonly SemanticNode[] {
  return graph.nodes.filter((n) => n.name === name)
}

export function findReferences(graph: SemanticGraph, nodeId: string): readonly SemanticEdge[] {
  return graph.edges.filter((e) => e.source === nodeId || e.target === nodeId)
}

export function findCallers(graph: SemanticGraph, nodeId: string): readonly SemanticNode[] {
  const callerIds = graph.edges.filter((e) => e.target === nodeId && e.kind === "calls").map((e) => e.source)
  return graph.nodes.filter((n) => callerIds.includes(n.id))
}

export function findCallees(graph: SemanticGraph, nodeId: string): readonly SemanticNode[] {
  const calleeIds = graph.edges.filter((e) => e.source === nodeId && e.kind === "calls").map((e) => e.target)
  return graph.nodes.filter((n) => calleeIds.includes(n.id))
}

export function findImplementations(graph: SemanticGraph, nodeId: string): readonly SemanticNode[] {
  const implIds = graph.edges.filter((e) => e.source === nodeId && (e.kind === "extends" || e.kind === "implements")).map((e) => e.target)
  return graph.nodes.filter((n) => implIds.includes(n.id))
}

export function findDependents(graph: SemanticGraph, nodeId: string): readonly SemanticNode[] {
  const depIds = graph.edges.filter((e) => e.target === nodeId && (e.kind === "depends-on" || e.kind === "consumes")).map((e) => e.source)
  return graph.nodes.filter((n) => depIds.includes(n.id))
}

export function computeImpact(graph: SemanticGraph, nodeId: string): ImpactResult {
  const node = graph.nodes.find((n) => n.id === nodeId)
  if (!node) return emptyImpact()

  const directFiles = [node.path]
  const callers = findCallers(graph, nodeId).map((n) => n.path)
  const implementations = findImplementations(graph, nodeId).map((n) => n.path)
  const dependents = findDependents(graph, nodeId).map((n) => n.path)
  const tests = graph.nodes.filter((n) => n.kind === "test" && graph.edges.some((e) => e.source === n.id && e.target === nodeId && e.kind === "tests")).map((n) => n.path)
  const modules = [...new Set([...directFiles, ...callers, ...implementations, ...dependents].map((p) => p.split("/").slice(0, -1).join("/")))]

  const risk = computeRisk(node, callers.length, implementations.length, dependents.length, tests.length)

  return {
    directFiles,
    callers,
    implementations,
    dependents,
    tests,
    modules,
    publicApiExposure: node.exported,
    persistenceImpact: node.attributes.includes("persistence"),
    protocolImpact: node.attributes.includes("protocol"),
    buildTargets: [],
    threadingImpact: node.attributes.includes("concurrent") || node.attributes.includes("thread"),
    securityImpact: node.attributes.includes("auth") || node.attributes.includes("secret") || node.attributes.includes("trust"),
    risk,
  }
}

function computeRisk(node: SemanticNode, callerCount: number, implCount: number, depCount: number, testCount: number): ImpactResult["risk"] {
  const score = callerCount * 2 + implCount * 3 + depCount * 2 + (testCount === 0 ? 5 : 0) + (node.exported ? 3 : 0)
  if (score >= 15) return "critical"
  if (score >= 10) return "high"
  if (score >= 5) return "medium-high"
  if (score >= 2) return "medium"
  return "low"
}

function emptyImpact(): ImpactResult {
  return { directFiles: [], callers: [], implementations: [], dependents: [], tests: [], modules: [], publicApiExposure: false, persistenceImpact: false, protocolImpact: false, buildTargets: [], threadingImpact: false, securityImpact: false, risk: "low" }
}

export function detectCycles(graph: SemanticGraph): readonly string[][] {
  const cycles: string[][] = []
  const visited = new Set<string>()
  const inStack = new Set<string>()
  const path: string[] = []

  function dfs(nodeId: string): void {
    if (inStack.has(nodeId)) {
      const cycleStart = path.indexOf(nodeId)
      if (cycleStart >= 0) cycles.push([...path.slice(cycleStart), nodeId])
      return
    }
    if (visited.has(nodeId)) return
    visited.add(nodeId)
    inStack.add(nodeId)
    path.push(nodeId)
    for (const edge of graph.edges) {
      if (edge.source === nodeId) dfs(edge.target)
    }
    path.pop()
    inStack.delete(nodeId)
  }

  for (const node of graph.nodes) dfs(node.id)
  return cycles
}

export function findArchitectureBoundary(graph: SemanticGraph): readonly string[] {
  const boundaryNodes: string[] = []
  const moduleMap = new Map<string, readonly SemanticNode[]>()
  for (const node of graph.nodes) {
    const mod = node.path.split("/").slice(0, -1).join("/")
    const existing = moduleMap.get(mod) ?? []
    moduleMap.set(mod, [...existing, node])
  }
  for (const edge of graph.edges) {
    const sourceMod = edge.source.split("/").slice(0, -1).join("/")
    const targetMod = edge.target.split("/").slice(0, -1).join("/")
    if (sourceMod !== targetMod && edge.kind === "depends-on") {
      boundaryNodes.push(edge.source, edge.target)
    }
  }
  return [...new Set(boundaryNodes)]
}