export interface NormalizedDiagnostic {
  readonly language: "typescript" | "java" | "rust" | "go" | "python" | "unknown"
  readonly file?: string
  readonly line?: number
  readonly column?: number
  readonly code?: string
  readonly message: string
  readonly severity: "error" | "warning"
  readonly raw: string
}

export const JAVA_LANG_IMPLICIT_TYPES = new Set([
  "String",
  "Integer",
  "Long",
  "Short",
  "Byte",
  "Double",
  "Float",
  "Boolean",
  "Character",
  "Object",
  "Class",
  "System",
  "Thread",
  "ThreadLocal",
  "Exception",
  "RuntimeException",
  "Throwable",
  "Error",
  "Math",
  "Comparable",
  "Iterable",
  "AutoCloseable",
  "Cloneable",
  "CharSequence",
  "StringBuilder",
  "StringBuffer",
  "Enum",
  "Record",
  "Void",
  "NullPointerException",
  "IllegalArgumentException",
  "IllegalStateException",
  "IndexOutOfBoundsException",
  "UnsupportedOperationException",
  "SecurityException",
  "AssertionError",
  "Number",
  "Package",
  "Process",
  "ProcessBuilder",
  "Runtime",
  "StackTraceElement",
])

export function isJavaLangType(typeName: string): boolean {
  const isImplicit = JAVA_LANG_IMPLICIT_TYPES.has(typeName)
  return isImplicit
}

export function isSamePackageType(typeName: string, currentPackage?: string, packageTypes?: readonly string[]): boolean {
  if (!currentPackage || !packageTypes) return false
  const match = packageTypes.includes(typeName)
  return match
}

export function isGenuineMissingJavaImport(
  typeName: string,
  currentPackage?: string,
  packageTypes?: readonly string[],
): boolean {
  if (isJavaLangType(typeName)) return false
  if (isSamePackageType(typeName, currentPackage, packageTypes)) return false
  return true
}

export function parseTypeScriptDiagnostics(output: string): readonly NormalizedDiagnostic[] {
  const results: NormalizedDiagnostic[] = []
  const lines = output.split("\n")
  const tsPattern = /^([^(]+)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.*)$/

  for (const line of lines) {
    const match = line.trim().match(tsPattern)
    if (match) {
      const item: NormalizedDiagnostic = {
        language: "typescript",
        file: match[1].trim(),
        line: parseInt(match[2], 10),
        column: parseInt(match[3], 10),
        severity: match[4] === "warning" ? "warning" : "error",
        code: match[5],
        message: match[6].trim(),
        raw: line,
      }
      results.push(item)
    }
  }
  return results
}

export function parseJavaDiagnostics(
  output: string,
  currentPackage?: string,
  packageTypes?: readonly string[],
): readonly NormalizedDiagnostic[] {
  const results: NormalizedDiagnostic[] = []
  const lines = output.split("\n")
  const javacPattern = /^(?:\[ERROR\]\s+)?([^:]+):(?:\[(\d+),(\d+)\]|(\d+):)\s*(?:error:\s*)?(.*)$/

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    const match = line.match(javacPattern)
    if (match) {
      const file = match[1].trim()
      const lineNum = parseInt(match[2] || match[4], 10)
      const colNum = match[3] ? parseInt(match[3], 10) : undefined
      const message = match[5].trim()

      const symbolMatch = message.match(/cannot find symbol\s+symbol:\s+class\s+([A-Za-z0-9_]+)/)
      if (symbolMatch) {
        const typeName = symbolMatch[1]
        if (!isGenuineMissingJavaImport(typeName, currentPackage, packageTypes)) {
          continue
        }
      }

      const item: NormalizedDiagnostic = {
        language: "java",
        file,
        line: lineNum,
        column: colNum,
        severity: "error",
        message,
        raw: line,
      }
      results.push(item)
    }
  }
  return results
}

export function parseRustDiagnostics(output: string): readonly NormalizedDiagnostic[] {
  const results: NormalizedDiagnostic[] = []
  const lines = output.split("\n")
  let currentCode: string | undefined
  let currentMsg: string | undefined

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    const errorMatch = line.match(/^(?:error|warning)\[(E\d+)\]:\s+(.*)$/)
    if (errorMatch) {
      currentCode = errorMatch[1]
      currentMsg = errorMatch[2]
      continue
    }

    const locationMatch = line.match(/^-->\s+([^:]+):(\d+):(\d+)$/)
    if (locationMatch && currentMsg) {
      const item: NormalizedDiagnostic = {
        language: "rust",
        file: locationMatch[1].trim(),
        line: parseInt(locationMatch[2], 10),
        column: parseInt(locationMatch[3], 10),
        code: currentCode,
        message: currentMsg,
        severity: "error",
        raw: line,
      }
      results.push(item)
      currentCode = undefined
      currentMsg = undefined
    }
  }
  return results
}

export function parseGoDiagnostics(output: string): readonly NormalizedDiagnostic[] {
  const results: NormalizedDiagnostic[] = []
  const lines = output.split("\n")
  const goPattern = /^([^:]+\.go):(\d+):(\d+):\s+(.*)$/

  for (const line of lines) {
    const match = line.trim().match(goPattern)
    if (match) {
      const item: NormalizedDiagnostic = {
        language: "go",
        file: match[1].trim(),
        line: parseInt(match[2], 10),
        column: parseInt(match[3], 10),
        message: match[4].trim(),
        severity: "error",
        raw: line,
      }
      results.push(item)
    }
  }
  return results
}

export function parsePythonDiagnostics(output: string): readonly NormalizedDiagnostic[] {
  const results: NormalizedDiagnostic[] = []
  const lines = output.split("\n")
  const pyPattern = /^([^:]+\.py):(\d+):(?:(\d+):)?\s*(?:error:\s*|(E\d+|W\d+|F\d+)\s+)?(.*)$/

  for (const line of lines) {
    const match = line.trim().match(pyPattern)
    if (match) {
      const item: NormalizedDiagnostic = {
        language: "python",
        file: match[1].trim(),
        line: parseInt(match[2], 10),
        column: match[3] ? parseInt(match[3], 10) : undefined,
        code: match[4],
        message: match[5].trim(),
        severity: "error",
        raw: line,
      }
      results.push(item)
    }
  }
  return results
}

export function normalizeDiagnostics(
  output: string,
  hintLanguage?: "typescript" | "java" | "rust" | "go" | "python",
): readonly NormalizedDiagnostic[] {
  if (hintLanguage === "typescript" || output.includes("error TS")) {
    const ts = parseTypeScriptDiagnostics(output)
    if (ts.length > 0) return ts
  }

  if (hintLanguage === "java" || output.includes("[ERROR]") || output.includes("cannot find symbol")) {
    const java = parseJavaDiagnostics(output)
    if (java.length > 0) return java
  }

  if (hintLanguage === "rust" || output.includes("error[E") || output.includes("-->")) {
    const rust = parseRustDiagnostics(output)
    if (rust.length > 0) return rust
  }

  if (hintLanguage === "go" || /\.go:\d+:\d+:/.test(output)) {
    const go = parseGoDiagnostics(output)
    if (go.length > 0) return go
  }

  if (hintLanguage === "python" || /\.py:\d+:/.test(output)) {
    const py = parsePythonDiagnostics(output)
    if (py.length > 0) return py
  }

  const empty: readonly NormalizedDiagnostic[] = []
  return empty
}

export * as LanguageDiagnostics from "./diagnostics"
