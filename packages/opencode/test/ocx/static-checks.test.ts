import { describe, expect, test } from "bun:test"
import { StaticChecks } from "../../src/ocx/static-checks"
import { UniversalChecks } from "../../src/ocx/static-checks/universal"
import { changedLineSet } from "../../src/ocx/static-checks/changed-lines"
import { detectStaticLanguage } from "../../src/ocx/static-checks/types"

describe("OCX Static Checks - universal language coverage", () => {
  test("detects languages beyond the nine gate-supported ones", () => {
    expect(detectStaticLanguage("Main.cs")).toBe("csharp")
    expect(detectStaticLanguage("app.rb")).toBe("ruby")
    expect(detectStaticLanguage("index.php")).toBe("php")
    expect(detectStaticLanguage("App.swift")).toBe("swift")
    expect(detectStaticLanguage("query.sql")).toBe("sql")
    expect(detectStaticLanguage("config.yaml")).toBe("yaml")
    expect(detectStaticLanguage("file.weirdlang")).toBe("unknown")
    expect(detectStaticLanguage("Makefile")).toBe("unknown")
  })

  test("runs bracket checks on unsupported languages instead of passing silently", () => {
    const result = UniversalChecks.audit("Main.cs", "public class Foo {\n  public void Bar() {\n", "csharp")
    expect(result.passed).toBe(false)
    expect(result.findings.some((f) => f.code === "ERR_BRACKET_IMBALANCE")).toBe(true)
  })

  test("runs bracket checks on unknown extensions for any programming language", () => {
    const result = UniversalChecks.audit("script.weirdlang", "func main(((\n", "unknown")
    expect(result.passed).toBe(false)
    expect(result.findings.some((f) => f.code === "ERR_BRACKET_IMBALANCE")).toBe(true)
  })

  test("passes balanced code in any language", () => {
    const result = UniversalChecks.audit("Main.cs", "public class Foo {\n  public void Bar() {\n  }\n}\n", "csharp")
    expect(result.passed).toBe(true)
  })

  test("skips bracket checks for prose files", () => {
    const result = UniversalChecks.audit("README.md", "An (unclosed thought\n", "unknown")
    expect(result.passed).toBe(true)
  })

  test("reports JSON syntax errors with the file path", () => {
    const result = UniversalChecks.audit("config.json", '{"a": 1,}', "json")
    expect(result.passed).toBe(false)
    expect(result.findings.some((f) => f.code === "ERR_JSON_SYNTAX")).toBe(true)
  })

  test("warns on mixed line endings that break exact-match edits", () => {
    const result = UniversalChecks.audit("file.kt", "line one\r\nline two\nline three\n", "kotlin")
    expect(result.findings.some((f) => f.code === "WARN_MIXED_LINE_ENDINGS")).toBe(true)
    expect(result.passed).toBe(true)
  })

  test("errors on null bytes", () => {
    const result = UniversalChecks.audit("blob.bin", "abc\0def", "unknown")
    expect(result.passed).toBe(false)
    expect(result.findings.some((f) => f.code === "ERR_NULL_BYTE")).toBe(true)
  })

  test("detects mismatched XML tags", () => {
    const result = UniversalChecks.audit("layout.xml", "<root><child></root>", "xml")
    expect(result.passed).toBe(false)
    expect(result.findings.some((f) => f.code === "ERR_XML_TAG_MISMATCH")).toBe(true)
  })
})

describe("OCX Static Checks - merged audit", () => {
  test("merges universal and language-gate diagnostics for supported languages", () => {
    const javaCode = `
package com.example.service;

import java.util.List;
import java.util.ArrayList;

public class TaskProcessor {
    public void run(List<String> items) {
        System.out.println(items.size());
    }
}
`
    const result = StaticChecks.auditFile("TaskProcessor.java", javaCode)
    expect(result.language).toBe("java")
    expect(result.languageDiagnostics.some((d) => d.code === "ERR_ORPHAN_IMPORT")).toBe(true)
  })

  test("scopes language diagnostics to changed lines when previous content is given", () => {
    const previous = `package com.example.service;

import java.util.List;
import java.util.ArrayList;

public class TaskProcessor {
    public void run(List<String> items) {
        System.out.println(items.size());
    }
}
`
    const current = previous.replace(
      "        System.out.println(items.size());",
      "        android.util.Log.d(\"TAG\", \"size=\" + items.size());\n        System.out.println(items.size());",
    )
    const result = StaticChecks.auditFile("TaskProcessor.java", current, { previousContent: previous })
    // The pre-existing orphan ArrayList import is outside the diff and must not block.
    expect(result.languageDiagnostics.some((d) => d.code === "ERR_ORPHAN_IMPORT")).toBe(false)
    // The newly added inline FQN is inside the diff and must still be caught.
    expect(result.languageDiagnostics.some((d) => d.code === "ERR_INLINE_FQN")).toBe(true)
  })
})

describe("OCX Static Checks - changed lines", () => {
  test("marks only the edited hunk as changed for single-region edits", () => {
    const previous = "a\nb\nc\nd\ne\n"
    const current = "a\nb\nCHANGED\nd\ne\n"
    expect(changedLineSet(previous, current)).toEqual(new Set([3]))
  })

  test("marks inserted lines as changed", () => {
    const previous = "a\nb\nc\n"
    const current = "a\nb\nNEW1\nNEW2\nc\n"
    expect(changedLineSet(previous, current)).toEqual(new Set([3, 4]))
  })

  test("returns an empty set for identical content", () => {
    expect(changedLineSet("a\nb\n", "a\nb\n").size).toBe(0)
  })
})
