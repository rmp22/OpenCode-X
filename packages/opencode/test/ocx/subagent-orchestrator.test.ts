import { describe, expect, test } from "bun:test"
import { DomainOwnerRegistry } from "@/ocx/subagents/owner"
import { consolidateSubagentTasks } from "@/ocx/subagents/consolidator"
import { MaxSubagentRecursionError } from "@/ocx/subagents/types"

describe("Domain Owner Subagents & Orchestration", () => {
  test("retains subsystem memory across delegations without lock contention", async () => {
    const registry = new DomainOwnerRegistry()

    const result = await registry.delegateTask(
      { id: "t1", owner: "database", prompt: "Inspect migrations", depth: 1 },
      async () => ({
        taskId: "t1",
        owner: "database",
        output: "Found 5 migrations",
        subsystemMemoryUpdates: { lastMigrationId: "005_users" },
        success: true,
      }),
    )

    expect(result.success).toBe(true)
    expect(registry.getDomainMemory("database", "lastMigrationId")).toBe("005_users")
  })

  test("enforces max recursion depth", async () => {
    const registry = new DomainOwnerRegistry(2)

    expect(async () => {
      await registry.delegateTask(
        { id: "t-deep", owner: "core", prompt: "Run runaway loop", depth: 3 },
        async () => ({ taskId: "t-deep", owner: "core", output: "ok", success: true }),
      )
    }).toThrow(MaxSubagentRecursionError)
  })

  test("consolidates multiple subagent tasks to the same domain owner", () => {
    const tasks = [
      { id: "a1", owner: "ui" as const, prompt: "Check header layout", depth: 1 },
      { id: "a2", owner: "ui" as const, prompt: "Check footer layout", depth: 1 },
      { id: "b1", owner: "auth" as const, prompt: "Check jwt validation", depth: 1 },
    ]

    const consolidated = consolidateSubagentTasks(tasks)
    expect(consolidated.length).toBe(2)
    const uiTask = consolidated.find((t) => t.owner === "ui")
    expect(uiTask?.prompt).toContain("Check header layout")
    expect(uiTask?.prompt).toContain("Check footer layout")
  })
})
