export * as CodeGraph from "./graph"

export type SymbolType = "function" | "class" | "interface" | "type" | "variable" | "module"

export type CodeNode = {
  readonly id: string
  readonly name: string
  readonly file: string
  readonly type: SymbolType
  readonly exported?: boolean
  readonly line?: number
}

export type EdgeType = "imports" | "calls" | "implements" | "extends" | "depends_on"

export type CodeEdge = {
  readonly source: string
  readonly target: string
  readonly type: EdgeType
}

export type BlastRadiusResult = {
  readonly changedFiles: readonly string[]
  readonly directlyAffected: readonly string[]
  readonly transitiveAffected: readonly string[]
  readonly affectedTests: readonly string[]
  readonly impactScore: number
  readonly dependencyPaths: readonly (readonly string[])[]
}

export type CodeGraph = {
  readonly addNode: (node: CodeNode) => void
  readonly addEdge: (edge: CodeEdge) => void
  readonly getNode: (id: string) => CodeNode | undefined
  readonly getNodesByFile: (file: string) => readonly CodeNode[]
  readonly getDirectDependents: (targetIdOrFile: string) => readonly string[]
  readonly getTransitiveDependents: (targetIdOrFile: string, maxDepth?: number) => readonly string[]
  readonly computeBlastRadius: (changedFiles: readonly string[]) => BlastRadiusResult
  readonly computeGraphRank: (iterations?: number, damping?: number) => ReadonlyMap<string, number>
  readonly clear: () => void
}

export function createCodeGraph(): CodeGraph {
  const nodes = new Map<string, CodeNode>()
  const fileToNodes = new Map<string, Set<string>>()
  const forwardAdj = new Map<string, Set<string>>()
  const reverseAdj = new Map<string, Set<string>>()

  function registerNode(node: CodeNode): void {
    nodes.set(node.id, node)
    const set = fileToNodes.get(node.file) ?? new Set<string>()
    set.add(node.id)
    fileToNodes.set(node.file, set)
  }

  function registerEdge(edge: CodeEdge): void {
    const forward = forwardAdj.get(edge.source) ?? new Set<string>()
    forward.add(edge.target)
    forwardAdj.set(edge.source, forward)

    const reverse = reverseAdj.get(edge.target) ?? new Set<string>()
    reverse.add(edge.source)
    reverseAdj.set(edge.target, reverse)
  }

  function resolveTargetIds(targetIdOrFile: string): string[] {
    if (nodes.has(targetIdOrFile)) return [targetIdOrFile]
    const ids = fileToNodes.get(targetIdOrFile)
    if (ids) return [...ids]
    const matching: string[] = []
    for (const [file, set] of fileToNodes.entries()) {
      if (file.endsWith(targetIdOrFile) || targetIdOrFile.endsWith(file)) {
        matching.push(...set)
      }
    }
    return matching
  }

  function getDirectDependents(targetIdOrFile: string): readonly string[] {
    const targetIds = resolveTargetIds(targetIdOrFile)
    const result = new Set<string>()
    for (const id of targetIds) {
      const incoming = reverseAdj.get(id)
      if (incoming) {
        for (const dep of incoming) {
          result.add(dep)
        }
      }
    }
    return [...result]
  }

  function getTransitiveDependents(targetIdOrFile: string, maxDepth = 10): readonly string[] {
    const initialTargets = resolveTargetIds(targetIdOrFile)
    const visited = new Set<string>(initialTargets)
    const dependents = new Set<string>()
    let currentQueue = [...initialTargets]
    let depth = 0

    while (currentQueue.length > 0 && depth < maxDepth) {
      const nextQueue: string[] = []
      for (const current of currentQueue) {
        const incoming = reverseAdj.get(current)
        if (incoming) {
          for (const parent of incoming) {
            if (!visited.has(parent)) {
              visited.add(parent)
              dependents.add(parent)
              nextQueue.push(parent)
            }
          }
        }
      }
      currentQueue = nextQueue
      depth++
    }

    return [...dependents]
  }

  function computeBlastRadius(changedFiles: readonly string[]): BlastRadiusResult {
    const directlyAffectedFiles = new Set<string>()
    const transitiveAffectedFiles = new Set<string>()
    const affectedTests = new Set<string>()
    const dependencyPaths: string[][] = []

    for (const file of changedFiles) {
      const directDepIds = getDirectDependents(file)
      for (const depId of directDepIds) {
        const node = nodes.get(depId)
        const depFile = node?.file ?? depId
        if (!changedFiles.includes(depFile)) {
          directlyAffectedFiles.add(depFile)
        }
      }

      const transitiveDepIds = getTransitiveDependents(file)
      for (const depId of transitiveDepIds) {
        const node = nodes.get(depId)
        const depFile = node?.file ?? depId
        if (!changedFiles.includes(depFile)) {
          transitiveAffectedFiles.add(depFile)
          if (depFile.includes(".test.") || depFile.includes(".spec.") || depFile.startsWith("test/")) {
            affectedTests.add(depFile)
          }
        }
      }
    }

    const totalAffected = transitiveAffectedFiles.size
    const impactScore = Math.min(100, (changedFiles.length * 10) + (totalAffected * 15) + (affectedTests.size * 5))

    return {
      changedFiles,
      directlyAffected: [...directlyAffectedFiles],
      transitiveAffected: [...transitiveAffectedFiles],
      affectedTests: [...affectedTests],
      impactScore,
      dependencyPaths,
    }
  }

  function computeGraphRank(iterations = 20, damping = 0.85): ReadonlyMap<string, number> {
    const allNodeIds = [...nodes.keys()]
    const n = allNodeIds.length
    if (n === 0) return new Map()

    const ranks = new Map<string, number>()
    const initialRank = 1 / n
    for (const id of allNodeIds) ranks.set(id, initialRank)

    for (let iter = 0; iter < iterations; iter++) {
      const nextRanks = new Map<string, number>()
      for (const id of allNodeIds) {
        let rankSum = 0
        const incoming = reverseAdj.get(id)
        if (incoming) {
          for (const parent of incoming) {
            const parentOutgoingCount = forwardAdj.get(parent)?.size ?? 1
            const parentRank = ranks.get(parent) ?? initialRank
            rankSum += parentRank / parentOutgoingCount
          }
        }
        nextRanks.set(id, ((1 - damping) / n) + (damping * rankSum))
      }
      for (const [id, rank] of nextRanks) ranks.set(id, rank)
    }

    return ranks
  }

  return {
    addNode: registerNode,
    addEdge: registerEdge,
    getNode: (id) => nodes.get(id),
    getNodesByFile: (file) => {
      const ids = fileToNodes.get(file)
      if (!ids) return []
      return [...ids].map((id) => nodes.get(id)!).filter(Boolean)
    },
    getDirectDependents,
    getTransitiveDependents,
    computeBlastRadius,
    computeGraphRank,
    clear: () => {
      nodes.clear()
      fileToNodes.clear()
      forwardAdj.clear()
      reverseAdj.clear()
    },
  }
}
