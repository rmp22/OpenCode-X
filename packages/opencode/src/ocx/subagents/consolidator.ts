import type { DomainOwnerType, SubagentTask } from "./types"

export function consolidateSubagentTasks(tasks: SubagentTask[]): SubagentTask[] {
  const byOwner = new Map<DomainOwnerType, SubagentTask[]>()

  for (const t of tasks) {
    const list = byOwner.get(t.owner) ?? []
    list.push(t)
    byOwner.set(t.owner, list)
  }

  const consolidated: SubagentTask[] = []

  for (const [owner, group] of byOwner.entries()) {
    if (group.length === 1) {
      consolidated.push(group[0])
    } else {
      const combinedPrompt = group.map((t, idx) => `Task ${idx + 1}: ${t.prompt}`).join("\n\n")
      const minDepth = Math.min(...group.map((t) => t.depth))

      consolidated.push({
        id: `consolidated-${owner}-${Date.now()}`,
        owner,
        prompt: combinedPrompt,
        depth: minDepth,
      })
    }
  }

  return consolidated
}
