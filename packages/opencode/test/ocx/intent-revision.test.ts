import { describe, expect, test } from "bun:test"
import { IntentRevision, isMaterialChange, detectIntentRevision, selectiveInvalidation } from "../../src/ocx/intent-revision"

describe("Intent Revision", () => {
  test("short correction 'no' is material change", () => {
    expect(isMaterialChange("Build feature A", "no")).toBe(true)
    expect(isMaterialChange("Build feature A", "stop")).toBe(true)
    expect(isMaterialChange("Build feature A", "don't change API")).toBe(true)
  })

  test("compatible completed work is preserved", () => {
    const result = selectiveInvalidation({
      currentRevision: "r2",
      previousRevision: "r1",
      objects: [
        { id: "a", intentRevision: "r1", kind: "context" },
        { id: "b", intentRevision: "r2", kind: "workflow" },
      ],
    })
    expect(result.stale).toContain("a")
    expect(result.preserved).toContain("b")
  })

  test("detectIntentRevision for material change", () => {
    const rev = detectIntentRevision("Build A", "no", "r1")
    expect(rev?.materialChange).toBe(true)
  })

  test("non-material change does not create new revision", () => {
    const rev = detectIntentRevision("Build A", "Build A", "r1")
    expect(rev).toBeUndefined()
  })
})
