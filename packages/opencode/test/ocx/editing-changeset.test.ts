import { describe, expect, test } from "bun:test"
import { generateFileDiff, formatUnifiedDiff } from "@/ocx/editing/diff"
import { applyMigrationRule, migrateFileContents } from "@/ocx/editing/migration"

describe("Editing Changeset & Migration", () => {
  test("generates and formats unified diffs", () => {
    const oldCode = "const a = 1\nconst b = 2\n"
    const newCode = "const a = 1\nconst b = 3\n"
    const diff = generateFileDiff("test.ts", oldCode, newCode)
    const formatted = formatUnifiedDiff(diff)

    expect(formatted).toContain("--- a/test.ts")
    expect(formatted).toContain("+++ b/test.ts")
  })

  test("applies mechanical migration rules for imports and symbols", () => {
    const code = `import { foo } from "./old-path"\nconst result = foo()`
    const updated = applyMigrationRule(code, {
      oldImportPath: "./old-path",
      newImportPath: "./new-path",
      targetSymbol: "foo",
      newSymbol: "bar",
    })

    expect(updated).toContain('from "./new-path"')
    expect(updated).toContain("const result = bar()")
  })

  test("migrates multi-file contents", () => {
    const files = [
      { filePath: "a.ts", content: "const x = 1" },
      { filePath: "b.ts", content: "const y = 2" },
    ]
    const migrated = migrateFileContents(files, [{ targetSymbol: "x", newSymbol: "z" }])
    expect(migrated[0].modified).toBe(true)
    expect(migrated[1].modified).toBe(false)
  })
})
