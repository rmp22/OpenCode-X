import { describe, expect, test } from "bun:test"
import { TaskStore } from "../../src/ocx/task-store"

describe("task-store", () => {
  test("advances through the single lifecycle", () => {
    const store = TaskStore.memoryStore()
    store.create({ sessionID: "ses-1", title: "Build the landing page", scopeRoots: ["/repo/web-design"] })
    expect(store.get("ses-1")?.state).toBe("scoped")
    store.transition("ses-1", "planned")
    store.transition("ses-1", "acting")
    store.recordEvidence("ses-1", "assets/manifest.json")
    store.transition("ses-1", "verifying")
    store.transition("ses-1", "done")
    expect(store.get("ses-1")?.evidence).toEqual(["assets/manifest.json"])
  })

  test("rejects skips and terminal writes", () => {
    const store = TaskStore.memoryStore()
    store.create({ sessionID: "ses-2", title: "t" })
    expect(() => store.transition("ses-2", "done")).toThrow("cannot transition")
    store.transition("ses-2", "planned")
    store.transition("ses-2", "acting")
    store.transition("ses-2", "verifying")
    store.transition("ses-2", "failed")
    expect(() => store.transition("ses-2", "planned")).toThrow("cannot transition")
    expect(() => store.recordEvidence("ses-2", "late")).toThrow("terminal")
  })

  test("blocked resumes only through planned", () => {
    const store = TaskStore.memoryStore()
    store.create({ sessionID: "ses-3", title: "t" })
    store.transition("ses-3", "blocked")
    expect(() => store.transition("ses-3", "acting")).toThrow("cannot transition")
    store.transition("ses-3", "planned")
    expect(store.get("ses-3")?.state).toBe("planned")
  })
})
