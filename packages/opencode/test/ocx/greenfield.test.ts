import { describe, expect, test } from "bun:test"
import { generateVerticalSliceScaffold } from "@/ocx/greenfield/scaffold"
import { validateSkeleton } from "@/ocx/greenfield/validator"

describe("Greenfield Construction", () => {
  test("generates vertical slice scaffold with tests and configs", () => {
    const scaffold = generateVerticalSliceScaffold("sample-service")
    expect(scaffold.name).toBe("sample-service")
    expect(scaffold.files.some((f) => f.relativePath === "package.json")).toBe(true)
    expect(scaffold.files.some((f) => f.relativePath === "tsconfig.json")).toBe(true)
    expect(scaffold.files.some((f) => f.relativePath === "src/index.ts")).toBe(true)
    expect(scaffold.files.some((f) => f.relativePath === "test/index.test.ts")).toBe(true)
  })

  test("validates required skeleton files", async () => {
    const result = await validateSkeleton("/tmp/empty-test-dir-1234")
    expect(result.passed).toBe(false)
    expect(result.missingFiles.length).toBeGreaterThan(0)
  })
})
