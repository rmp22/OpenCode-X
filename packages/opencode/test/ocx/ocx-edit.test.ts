import { describe, expect, test } from "bun:test"
import { OCXEdit } from "../../src/ocx/ocx-edit"

describe("OCXEdit.resolveSpan", () => {
  test("resolves exact indented block", () => {
    const content = "top\n    int x = 1;\n    int y = 2;\nbottom\n"
    expect(OCXEdit.resolveSpan(content, "    int x = 1;\n    int y = 2;")).toBe("    int x = 1;\n    int y = 2;")
  })

  test("heals trailing whitespace drift", () => {
    const content = "line1\nold   \nline3\n"
    expect(OCXEdit.resolveSpan(content, "old")).toBe("old   ")
  })

  test("heals indentation drift", () => {
    const content = "\tint x = 1;\n\t\tint y = 2;\n"
    expect(OCXEdit.resolveSpan(content, "    int x = 1;\n        int y = 2;")).toBe("\tint x = 1;\n\t\tint y = 2;")
  })

  test("heals CRLF file with LF search", () => {
    const content = "line1\r\nold\r\nline3\r\n"
    expect(OCXEdit.resolveSpan(content, "old")).toBe("old\r")
  })

  test("heals blank-line drift", () => {
    const content = "function foo() {\n  const a = 1;\n\n  const b = 2;\n  return a + b;\n}\n"
    const search = "function foo() {\n  const a = 1;\n  const b = 2;\n  return a + b;\n}"
    expect(OCXEdit.resolveSpan(content, search)).toBe(
      "function foo() {\n  const a = 1;\n\n  const b = 2;\n  return a + b;\n}",
    )
  })

  test("heals smart quotes", () => {
    const content = "const label = “hello”;\n"
    expect(OCXEdit.resolveSpan(content, 'const label = "hello";')).toBe("const label = “hello”;")
  })

  test("returns undefined for hallucinated signature", () => {
    const content = "    @VisibleForTesting\n    void setOwnScrollY(int ownScrollY) {\n        doWork();\n    }\n"
    expect(
      OCXEdit.resolveSpan(content, "public void setOwnScrollY(int scrollY) {\n    foo();\n    bar();\n}"),
    ).toBeUndefined()
  })

  test("returns undefined for loose block-anchor content", () => {
    const content = [
      "function configure() {",
      "  keepImportantState()",
      "  removeAllUserData()",
      "  archiveBackups()",
      "  auditLog()",
      "}",
    ].join("\n")
    expect(
      OCXEdit.resolveSpan(content, ["function configure() {", "  const enabled = true", "}"].join("\n")),
    ).toBeUndefined()
  })

  test("returns undefined for unrelated middle content", () => {
    const content = ["function configure() {", "  removeAllUserData()", "}"].join("\n")
    expect(
      OCXEdit.resolveSpan(content, ["function configure() {", "  const enabled = true", "}"].join("\n")),
    ).toBeUndefined()
  })

  test("returns undefined for ambiguous spans", () => {
    const content = "  dup();\n  dup();\n"
    expect(OCXEdit.resolveSpan(content, "dup();")).toBeUndefined()
  })

  test("returns undefined for empty search", () => {
    expect(OCXEdit.resolveSpan("content", "")).toBeUndefined()
  })

  test("returns undefined for blank-only spans", () => {
    expect(OCXEdit.resolveSpan("", "\n")).toBeUndefined()
    expect(OCXEdit.resolveSpan("\n", "\n")).toBeUndefined()
  })
})

describe("OCXEdit.describeEdit", () => {
  test("keeps the base description and appends verbatim-copy guidance", () => {
    const description = OCXEdit.describeEdit("Replace exact text in one file.")
    expect(description.startsWith("Replace exact text in one file.")).toBe(true)
    expect(description).toContain("verbatim")
    expect(description).toContain("grep")
  })
})

describe("OCXEdit.buildNotFoundHint", () => {
  test("points at true definition for hallucinated signature", () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line${i}`)
    lines[10] = "    void setOwnScrollY(int ownScrollY) {"
    const content = lines.join("\n")
    const hint = OCXEdit.buildNotFoundHint(
      content,
      "public void setOwnScrollY(int scrollY) {\n    foo();\n    bar();\n}",
    )
    expect(hint).toContain("first-line not found")
    expect(hint).toContain("line 11")
    expect(hint).toContain('grep for "setOwnScrollY"')
  })

  test("reports file and search meta", () => {
    const hint = OCXEdit.buildNotFoundHint("alpha\nbeta\n", "missing\nsecond\n")
    expect(hint).toContain("file: 3 lines")
    expect(hint).toContain("search: 2 lines")
    expect(hint).toContain("fix:")
  })

  test("flags generic closing-brace anchor", () => {
    const content = Array.from({ length: 10 }, () => "}").join("\n")
    const hint = OCXEdit.buildNotFoundHint(content, "missing first line here\nsecond\n}")
    expect(hint).toContain("generic anchor")
  })
})
