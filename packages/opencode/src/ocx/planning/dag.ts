import type { PlanStep } from "./types"

export function topologicalSort(steps: PlanStep[]): PlanStep[] {
  const stepMap = new Map<string, PlanStep>()
  const inDegree = new Map<string, number>()
  const adjacency = new Map<string, string[]>()

  for (const step of steps) {
    stepMap.set(step.id, step)
    inDegree.set(step.id, 0)
    adjacency.set(step.id, [])
  }

  for (const step of steps) {
    for (const dep of step.dependencies) {
      if (stepMap.has(dep)) {
        inDegree.set(step.id, (inDegree.get(step.id) ?? 0) + 1)
        const neighbors = adjacency.get(dep) ?? []
        neighbors.push(step.id)
        adjacency.set(dep, neighbors)
      }
    }
  }

  const queue: string[] = []
  for (const [id, deg] of inDegree.entries()) {
    if (deg === 0) {
      queue.push(id)
    }
  }

  const sorted: PlanStep[] = []
  while (queue.length > 0) {
    const currentId = queue.shift()!
    sorted.push(stepMap.get(currentId)!)

    const neighbors = adjacency.get(currentId) ?? []
    for (const neighbor of neighbors) {
      const newDeg = (inDegree.get(neighbor) ?? 1) - 1
      inDegree.set(neighbor, newDeg)
      if (newDeg === 0) {
        queue.push(neighbor)
      }
    }
  }

  if (sorted.length < steps.length) {
    throw new Error("Cycle detected in plan dependencies")
  }

  return sorted
}
