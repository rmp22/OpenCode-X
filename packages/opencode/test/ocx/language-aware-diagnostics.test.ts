import { describe, expect, test } from "bun:test"
import {
  isJavaLangType,
  isSamePackageType,
  isGenuineMissingJavaImport,
  parseTypeScriptDiagnostics,
  parseJavaDiagnostics,
  parseRustDiagnostics,
  parseGoDiagnostics,
  parsePythonDiagnostics,
  normalizeDiagnostics,
} from "../../src/ocx/verification/diagnostics"

describe("Language-Aware Diagnostics", () => {
  test("java.lang implicit types are recognized and suppressed from missing-import findings", () => {
    expect(isJavaLangType("String")).toBe(true)
    expect(isJavaLangType("Integer")).toBe(true)
    expect(isJavaLangType("Boolean")).toBe(true)
    expect(isJavaLangType("Object")).toBe(true)
    expect(isJavaLangType("System")).toBe(true)
    expect(isJavaLangType("Thread")).toBe(true)
    expect(isJavaLangType("Math")).toBe(true)
    expect(isJavaLangType("Exception")).toBe(true)
    expect(isJavaLangType("AutoCloseable")).toBe(true)

    expect(isJavaLangType("List")).toBe(false)
    expect(isJavaLangType("Map")).toBe(false)
    expect(isJavaLangType("CustomService")).toBe(false)

    expect(isGenuineMissingJavaImport("String")).toBe(false)
    expect(isGenuineMissingJavaImport("System")).toBe(false)
    expect(isGenuineMissingJavaImport("java.util.List")).toBe(true)
  })

  test("same package Java types are recognized as implicitly available", () => {
    const pkg = "com.example.service"
    const pkgTypes = ["UserService", "UserDTO", "UserRepository"]

    expect(isSamePackageType("UserDTO", pkg, pkgTypes)).toBe(true)
    expect(isSamePackageType("OrderDTO", pkg, pkgTypes)).toBe(false)

    expect(isGenuineMissingJavaImport("UserDTO", pkg, pkgTypes)).toBe(false)
    expect(isGenuineMissingJavaImport("OrderDTO", pkg, pkgTypes)).toBe(true)
  })

  test("Java diagnostics suppress implicit imports but retain genuine missing imports", () => {
    const outputWithImplicit = `
      [ERROR] /src/App.java:[10,5] error: cannot find symbol symbol: class String
    `
    const suppressed = parseJavaDiagnostics(outputWithImplicit)
    expect(suppressed.length).toBe(0)

    const outputWithGenuine = `
      [ERROR] /src/App.java:[12,5] error: cannot find symbol symbol: class UnresolvedExternalClient
    `
    const genuine = parseJavaDiagnostics(outputWithGenuine)
    expect(genuine.length).toBe(1)
    expect(genuine[0].message).toContain("UnresolvedExternalClient")
  })

  test("TypeScript diagnostics are normalized into structured items", () => {
    const tsOutput = `
      src/index.ts(15,22): error TS2304: Cannot find name 'foo'.
      src/app.tsx(42,10): warning TS6133: 'unused' is declared but never read.
    `
    const items = parseTypeScriptDiagnostics(tsOutput)
    expect(items.length).toBe(2)
    expect(items[0].code).toBe("TS2304")
    expect(items[0].line).toBe(15)
    expect(items[0].column).toBe(22)
    expect(items[0].severity).toBe("error")
    expect(items[1].severity).toBe("warning")
  })

  test("Rust diagnostics parse error codes, messages, and source references", () => {
    const rustOutput = `
      error[E0382]: use of moved value: \`x\`
        --> src/main.rs:18:9
    `
    const items = parseRustDiagnostics(rustOutput)
    expect(items.length).toBe(1)
    expect(items[0].code).toBe("E0382")
    expect(items[0].line).toBe(18)
    expect(items[0].column).toBe(9)
    expect(items[0].file).toBe("src/main.rs")
  })

  test("Go diagnostics parse file, line, and message accurately", () => {
    const goOutput = `
      ./main.go:25:3: undefined: calculateTotal
    `
    const items = parseGoDiagnostics(goOutput)
    expect(items.length).toBe(1)
    expect(items[0].file).toBe("./main.go")
    expect(items[0].line).toBe(25)
    expect(items[0].column).toBe(3)
    expect(items[0].message).toContain("undefined: calculateTotal")
  })

  test("Python diagnostics normalize mypy and flake8 outputs", () => {
    const pyOutput = `
      src/server.py:10: error: Incompatible types in assignment (expression has type "int", variable has type "str")
      src/server.py:20:5: E302 expected 2 blank lines, found 1
    `
    const items = parsePythonDiagnostics(pyOutput)
    expect(items.length).toBe(2)
    expect(items[0].line).toBe(10)
    expect(items[1].code).toBe("E302")
    expect(items[1].column).toBe(5)
  })

  test("normalizeDiagnostics auto-detects language format from raw compiler output", () => {
    const raw = "src/foo.ts(1,1): error TS2307: Cannot find module 'bar'."
    const diag = normalizeDiagnostics(raw)
    expect(diag.length).toBe(1)
    expect(diag[0].language).toBe("typescript")
  })
})
