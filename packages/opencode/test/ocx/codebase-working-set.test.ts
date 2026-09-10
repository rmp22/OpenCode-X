import { describe, expect, test } from "bun:test"
import { create, reset, updateFromPaths } from "../../src/ocx/codebase/working-set"

describe("codebase working set", () => {
  test("keeps evidence items bounded and replaces weaker duplicates", () => {
    const set = updateFromPaths(
      create("task", 1),
      {
        modules: ["services/auth", "services/auth"],
        directories: ["services"],
        reason: "definition found",
        confidence: 0.8,
        now: 2,
      },
      { maxModules: 1 },
    )
    const stronger = updateFromPaths(
      set,
      { modules: ["services/auth"], reason: "exact definition", confidence: 1, now: 3 },
      { maxModules: 1 },
    )
    expect(stronger.modules).toHaveLength(1)
    expect(stronger.modules[0].confidence).toBe(1)
    expect(stronger.directories[0].path).toBe("services")
  })

  test("resets task state instead of carrying stale regions", () => {
    const set = updateFromPaths(create("task"), { files: ["src/old.ts"], reason: "old result" })
    const next = reset(set.taskID, 4)
    expect(next.files).toEqual([])
    expect(next.updatedAt).toBe(4)
  })
})
