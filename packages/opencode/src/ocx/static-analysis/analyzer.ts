import {
  detectLanguage,
  LANGUAGE_SPECS,
  type DeclaredSymbol,
  type ImportedSymbol,
  type StaticAuditResult,
  type StaticDiagnostic,
  type SupportedLanguage,
} from "./types"

interface TokenizedCode {
  readonly codeWithoutStringsOrComments: string
  readonly rawLines: readonly string[]
  readonly cleanLines: readonly string[]
}

function stripCommentsAndStrings(source: string, language: SupportedLanguage): TokenizedCode {
  const rawLines = source.split(/\r?\n/)
  const cleanChars: string[] = []
  const len = source.length
  let i = 0
  let inLineComment = false
  let inBlockComment = false
  let inString: string | null = null
  let isEscaped = false

  const isPython = language === "python"

  while (i < len) {
    const ch = source[i]
    const next = i + 1 < len ? source[i + 1] : ""

    if (inLineComment) {
      if (ch === "\n") {
        inLineComment = false
        cleanChars.push("\n")
      } else {
        cleanChars.push(" ")
      }
      i++
      continue
    }

    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false
        cleanChars.push("  ")
        i += 2
      } else {
        cleanChars.push(ch === "\n" ? "\n" : " ")
        i++
      }
      continue
    }

    if (inString !== null) {
      if (isEscaped) {
        isEscaped = false
        cleanChars.push(" ")
        i++
      } else if (ch === "\\") {
        isEscaped = true
        cleanChars.push(" ")
        i++
      } else if (ch === inString) {
        inString = null
        cleanChars.push(" ")
        i++
      } else {
        cleanChars.push(ch === "\n" ? "\n" : " ")
        i++
      }
      continue
    }

    if (!isPython && ch === "/" && next === "/") {
      inLineComment = true
      cleanChars.push("  ")
      i += 2
      continue
    }

    if (!isPython && ch === "/" && next === "*") {
      inBlockComment = true
      cleanChars.push("  ")
      i += 2
      continue
    }

    if (isPython && ch === "#") {
      inLineComment = true
      cleanChars.push(" ")
      i++
      continue
    }

    if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch
      cleanChars.push(" ")
      i++
      continue
    }

    cleanChars.push(ch)
    i++
  }

  const cleanedSource = cleanChars.join("")
  const cleanLines = cleanedSource.split(/\r?\n/)

  return {
    codeWithoutStringsOrComments: cleanedSource,
    rawLines,
    cleanLines,
  }
}

function parseImports(cleanLines: readonly string[], rawLines: readonly string[], language: SupportedLanguage): ImportedSymbol[] {
  const imports: ImportedSymbol[] = []

  for (let idx = 0; idx < cleanLines.length; idx++) {
    const line = cleanLines[idx].trim()
    const lineNum = idx + 1

    if (language === "java") {
      if (line.startsWith("import ")) {
        const isStatic = line.startsWith("import static ")
        const rest = line
          .replace(/^import\s+(?:static\s+)?/, "")
          .replace(/;.*$/, "")
          .trim()
        const isWildcard = rest.endsWith(".*")
        const parts = rest.split(".")
        const name = isWildcard ? "*" : parts[parts.length - 1]
        imports.push({
          name,
          fullPath: rest,
          isWildcard,
          isStatic,
          line: lineNum,
        })
      }
    } else if (language === "kotlin") {
      if (line.startsWith("import ")) {
        const rest = line
          .replace(/^import\s+/, "")
          .replace(/;.*$/, "")
          .trim()
        const isWildcard = rest.endsWith(".*")
        if (rest.includes(" as ")) {
          const [fullPath, alias] = rest.split(/\s+as\s+/)
          const parts = fullPath.split(".")
          imports.push({
            name: alias.trim(),
            alias: alias.trim(),
            fullPath: fullPath.trim(),
            isWildcard: false,
            isStatic: false,
            line: lineNum,
          })
        } else {
          const parts = rest.split(".")
          const name = isWildcard ? "*" : parts[parts.length - 1]
          imports.push({
            name,
            fullPath: rest,
            isWildcard,
            isStatic: false,
            line: lineNum,
          })
        }
      }
    } else if (language === "typescript" || language === "javascript") {
      if (line.startsWith("import ")) {
        const match = line.match(/^import\s+(?:type\s+)?(?:\{([^}]+)\}|(\*\s+as\s+([A-Za-z0-9_$]+))|([A-Za-z0-9_$]+))/)
        if (match) {
          if (match[1]) {
            const symbols = match[1].split(",")
            for (const sym of symbols) {
              const trimmed = sym.trim()
              if (!trimmed) continue
              if (trimmed.includes(" as ")) {
                const [orig, alias] = trimmed.split(/\s+as\s+/)
                imports.push({
                  name: alias.trim(),
                  alias: alias.trim(),
                  fullPath: orig.trim(),
                  isWildcard: false,
                  isStatic: false,
                  line: lineNum,
                })
              } else {
                imports.push({
                  name: trimmed,
                  fullPath: trimmed,
                  isWildcard: false,
                  isStatic: false,
                  line: lineNum,
                })
              }
            }
          } else if (match[3]) {
            imports.push({
              name: match[3],
              alias: match[3],
              fullPath: match[3],
              isWildcard: true,
              isStatic: false,
              line: lineNum,
            })
          } else if (match[4]) {
            imports.push({
              name: match[4],
              fullPath: match[4],
              isWildcard: false,
              isStatic: false,
              line: lineNum,
            })
          }
        }
      }
    } else if (language === "python") {
      if (line.startsWith("import ")) {
        const rest = line.replace(/^import\s+/, "")
        const items = rest.split(",")
        for (const item of items) {
          const trimmed = item.trim()
          if (trimmed.includes(" as ")) {
            const [full, alias] = trimmed.split(/\s+as\s+/)
            imports.push({
              name: alias.trim(),
              alias: alias.trim(),
              fullPath: full.trim(),
              isWildcard: false,
              isStatic: false,
              line: lineNum,
            })
          } else {
            const parts = trimmed.split(".")
            imports.push({
              name: parts[0].trim(),
              fullPath: trimmed,
              isWildcard: false,
              isStatic: false,
              line: lineNum,
            })
          }
        }
      } else if (line.startsWith("from ")) {
        const match = line.match(/^from\s+([A-Za-z0-9_.]+)\s+import\s+(.+)$/)
        if (match) {
          const mod = match[1]
          const targets = match[2].split(",")
          for (const target of targets) {
            const trimmed = target.trim()
            if (!trimmed) continue
            if (trimmed === "*") {
              imports.push({
                name: "*",
                fullPath: mod,
                isWildcard: true,
                isStatic: false,
                line: lineNum,
              })
            } else if (trimmed.includes(" as ")) {
              const [orig, alias] = trimmed.split(/\s+as\s+/)
              imports.push({
                name: alias.trim(),
                alias: alias.trim(),
                fullPath: `${mod}.${orig.trim()}`,
                isWildcard: false,
                isStatic: false,
                line: lineNum,
              })
            } else {
              imports.push({
                name: trimmed,
                fullPath: `${mod}.${trimmed}`,
                isWildcard: false,
                isStatic: false,
                line: lineNum,
              })
            }
          }
        }
      }
    } else if (language === "go") {
      const rawLine = rawLines[idx].trim()
      if (rawLine.startsWith("import (") || rawLine === "import (") {
        let groupIdx = idx + 1
        while (groupIdx < rawLines.length) {
          const gLine = rawLines[groupIdx].trim()
          if (gLine === ")") {
            idx = groupIdx
            break
          }
          const matchItem = gLine.match(/^(?:([A-Za-z0-9_]+)\s+)?"([^"]+)"/)
          if (matchItem) {
            const alias = matchItem[1]
            const path = matchItem[2]
            const defaultName = path.split("/").pop() ?? path
            imports.push({
              name: alias ?? defaultName,
              alias,
              fullPath: path,
              isWildcard: false,
              isStatic: false,
              line: groupIdx + 1,
            })
          }
          groupIdx++
        }
        continue
      }

      const matchSingle = rawLine.match(/^import\s+(?:([A-Za-z0-9_]+)\s+)?"([^"]+)"/)
      if (matchSingle) {
        const alias = matchSingle[1]
        const path = matchSingle[2]
        const defaultName = path.split("/").pop() ?? path
        imports.push({
          name: alias ?? defaultName,
          alias,
          fullPath: path,
          isWildcard: false,
          isStatic: false,
          line: lineNum,
        })
      }
    } else if (language === "rust") {
      if (line.startsWith("use ")) {
        const rest = line.replace(/^use\s+/, "").replace(/;.*$/, "").trim()
        if (rest.includes(" as ")) {
          const [fullPath, alias] = rest.split(/\s+as\s+/)
          imports.push({
            name: alias.trim(),
            alias: alias.trim(),
            fullPath: fullPath.trim(),
            isWildcard: false,
            isStatic: false,
            line: lineNum,
          })
        } else {
          const parts = rest.split("::")
          const name = parts[parts.length - 1]
          imports.push({
            name,
            fullPath: rest,
            isWildcard: name === "*",
            isStatic: false,
            line: lineNum,
          })
        }
      }
    } else if (language === "csharp") {
      if (line.startsWith("using ")) {
        const rest = line.replace(/^using\s+/, "").replace(/;.*$/, "").trim()
        if (rest.includes("=")) {
          const [alias, fullPath] = rest.split("=")
          imports.push({
            name: alias.trim(),
            alias: alias.trim(),
            fullPath: fullPath.trim(),
            isWildcard: false,
            isStatic: false,
            line: lineNum,
          })
        } else if (rest.length > 0) {
          const parts = rest.split(".")
          const name = parts[parts.length - 1]
          imports.push({
            name,
            fullPath: rest,
            isWildcard: true,
            isStatic: false,
            line: lineNum,
          })
        }
      }
    }
  }

  return imports
}

function parseDeclaredSymbols(cleanLines: readonly string[], language: SupportedLanguage): DeclaredSymbol[] {
  const symbols: DeclaredSymbol[] = []

  for (let idx = 0; idx < cleanLines.length; idx++) {
    const line = cleanLines[idx]
    const lineNum = idx + 1

    if (language === "java" || language === "kotlin" || language === "csharp") {
      const classMatch = line.match(/\b(?:class|interface|enum|record|struct)\s+([A-Za-z0-9_$]+)/)
      if (classMatch) {
        symbols.push({
          name: classMatch[1],
          kind: "class",
          line: lineNum,
          scopeDepth: 0,
        })
      }

      const funMatch = line.match(/\bfun\s*(?:<[^>]*>\s*)?([A-Za-z_][A-Za-z0-9_]*)/)
      if (funMatch) {
        symbols.push({
          name: funMatch[1],
          kind: "function",
          line: lineNum,
          scopeDepth: 0,
        })
      }

      const valMatch = line.match(/^\s*(?:(?:private|public|protected|internal|open|lateinit|const)\s+)*(?:val|var)\s+([A-Za-z_][A-Za-z0-9_]*)/)
      if (valMatch) {
        symbols.push({
          name: valMatch[1],
          kind: "field",
          line: lineNum,
          scopeDepth: 0,
        })
      }

      const trimmedStart = line.trim()
      const isStatementKeyword = /^(?:return|new|throw|case|if|for|while|switch|catch|import|package|extends|implements)\b/.test(trimmedStart)
      if (!isStatementKeyword) {
        const methodMatch = line.match(/^\s*(?:(?:public|private|protected|static|final|synchronized|abstract|native|default|override|open|internal)\s+)+[\w<>\[\]]+\s+([A-Za-z_$][\w$]*)\s*\(/)
        if (methodMatch) {
          symbols.push({
            name: methodMatch[1],
            kind: "function",
            line: lineNum,
            scopeDepth: 0,
          })
        } else {
          const fieldMatch = line.match(/^\s*(?:(?:public|private|protected|static|final|volatile|transient)\s+)+[\w<>\[\]]+\s+([A-Za-z_$][\w$]*)\s*(?:=|;)/)
          if (fieldMatch) {
            symbols.push({
              name: fieldMatch[1],
              kind: "field",
              line: lineNum,
              scopeDepth: 0,
            })
          }
        }
      }
    } else if (language === "typescript" || language === "javascript") {
      const fnMatch = line.match(/\bfunction\s+([A-Za-z0-9_$]+)/)
      if (fnMatch) {
        symbols.push({
          name: fnMatch[1],
          kind: "function",
          line: lineNum,
          scopeDepth: 0,
        })
      } else {
        const declMatch = line.match(/\b(?:class|interface|type|enum)\s+([A-Za-z0-9_$]+)/)
        if (declMatch) {
          symbols.push({
            name: declMatch[1],
            kind: "class",
            line: lineNum,
            scopeDepth: 0,
          })
        }
      }
      const constMatch = line.match(/^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/)
      if (constMatch) {
        symbols.push({
          name: constMatch[1],
          kind: "variable",
          line: lineNum,
          scopeDepth: 0,
        })
      }
    } else if (language === "python") {
      const defMatch = line.match(/^\s*def\s+([A-Za-z0-9_]+)/)
      if (defMatch) {
        symbols.push({
          name: defMatch[1],
          kind: "function",
          line: lineNum,
          scopeDepth: 0,
        })
      } else {
        const classMatch = line.match(/^\s*class\s+([A-Za-z0-9_]+)/)
        if (classMatch) {
          symbols.push({
            name: classMatch[1],
            kind: "class",
            line: lineNum,
            scopeDepth: 0,
          })
        }
      }
    } else if (language === "go") {
      const goMatch = line.match(/\btype\s+([A-Za-z0-9_]+)\s+(?:struct|interface)/)
      if (goMatch) {
        symbols.push({
          name: goMatch[1],
          kind: "class",
          line: lineNum,
          scopeDepth: 0,
        })
      }
    } else if (language === "rust") {
      const rsMatch = line.match(/\b(?:struct|enum|trait|type)\s+([A-Za-z0-9_]+)/)
      if (rsMatch) {
        symbols.push({
          name: rsMatch[1],
          kind: "class",
          line: lineNum,
          scopeDepth: 0,
        })
      }
    }
  }

  return symbols
}

function extractIdentifiers(line: string): Array<{ name: string; column: number }> {
  const results: Array<{ name: string; column: number }> = []
  const regex = /\b[A-Za-z_$][A-Za-z0-9_$]*\b/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(line)) !== null) {
    results.push({ name: match[0], column: match.index + 1 })
  }
  return results
}

export class ScopeAnalyzer {
  static analyze(filePath: string, content: string): StaticAuditResult {
    const language = detectLanguage(filePath)
    if (!language) {
      return {
        passed: true,
        language: "typescript",
        filePath,
        diagnostics: [],
      }
    }

    const spec = LANGUAGE_SPECS[language]
    const tokenized = stripCommentsAndStrings(content, language)
    const imports = parseImports(tokenized.cleanLines, tokenized.rawLines, language)
    const declaredSymbols = parseDeclaredSymbols(tokenized.cleanLines, language)

    const declaredSet = new Set(declaredSymbols.map((s) => s.name))
    const universalSet = new Set(spec.universalImports)
    const importUsageCounts = new Map<string, number>()

    for (const imp of imports) {
      if (!imp.isWildcard) {
        importUsageCounts.set(imp.name, 0)
      }
    }

    const symbolUsageCounts = new Map<string, number>()
    const diagnostics: StaticDiagnostic[] = []

    for (let idx = 0; idx < tokenized.cleanLines.length; idx++) {
      const line = tokenized.cleanLines[idx]
      const lineNum = idx + 1
      const trimmed = line.trim()

      if (
        trimmed.startsWith("import ") ||
        trimmed.startsWith("from ") ||
        trimmed.startsWith("package ") ||
        trimmed.startsWith("use ") ||
        trimmed.startsWith("using ") ||
        trimmed.startsWith("namespace ")
      ) {
        continue
      }

      const idents = extractIdentifiers(line)
      for (const ident of idents) {
        const name = ident.name
        symbolUsageCounts.set(name, (symbolUsageCounts.get(name) ?? 0) + 1)

        if (importUsageCounts.has(name)) {
          importUsageCounts.set(name, (importUsageCounts.get(name) ?? 0) + 1)
        }

        const isCapitalizedType = /^[A-Z][A-Za-z0-9_$]*$/.test(name)
        if (!isCapitalizedType) continue
        if (/^[A-Z][A-Z0-9_$]+$/.test(name)) continue
        const isKnownGlobal = universalSet.has(name)
        const isDeclared = declaredSet.has(name)
        const isImported = importUsageCounts.has(name) || imports.some((i) => i.isWildcard)

        if (
          isCapitalizedType &&
          !isKnownGlobal &&
          !isDeclared &&
          !isImported &&
          (language === "java" || language === "kotlin" || language === "csharp")
        ) {
          const prevWordMatch = line.slice(0, ident.column - 1).match(/([A-Za-z0-9_$]+)\s*\.\s*$/)
          if (!prevWordMatch) {
            diagnostics.push({
              code: "ERR_UNRESOLVED_SYMBOL",
              severity: "error",
              message: `Unresolved symbol '${name}' at line ${lineNum}, col ${ident.column}. Symbol is referenced but not imported or declared in this unit.`,
              filePath,
              line: lineNum,
              column: ident.column,
              language,
              symbol: name,
              suggestedFix: {
                importToAdd: name,
              },
            })
          }
        }
      }
    }

    const declaredFuncs = declaredSymbols
      .filter((s) => s.kind === "function")
      .map((s) => s.name)

    const LIFECYCLE_NAMES = new Set([
      "main",
      "init",
      "run",
      "execute",
      "setUp",
      "tearDown",
      "beforeEach",
      "afterEach",
      "toString",
      "hashCode",
      "equals",
      "compareTo",
      "render",
      "constructor",
      "componentDidMount",
      "componentWillUnmount",
      "ngOnInit",
      "viewDidLoad",
      "__init__",
      "start",
      "stop",
      "close",
      "destroy",
      "apply",
      "build",
      "create",
      "get",
      "set",
      "handle",
      "test",
      "check",
      "audit",
      "validate",
    ])

    for (const sym of declaredSymbols) {
      if (LIFECYCLE_NAMES.has(sym.name) || sym.name.startsWith("test") || sym.name.startsWith("_")) {
        continue
      }
      const lineText = tokenized.rawLines[sym.line - 1] ?? ""
      if (
        lineText.includes("export ") ||
        lineText.includes("public ") ||
        lineText.includes("pub ") ||
        (language === "kotlin" && !lineText.includes("private ")) ||
        (language === "go" && /^[A-Z]/.test(sym.name)) ||
        lineText.includes("@Override") ||
        lineText.includes("@Test") ||
        lineText.includes("@Bean")
      ) {
        continue
      }

      const usageCount = symbolUsageCounts.get(sym.name) ?? 0
      if (usageCount <= 1) {
        const isVar = sym.kind === "variable"
        const callers = declaredFuncs.filter((f) => f !== sym.name)
        diagnostics.push({
          code: isVar ? "ERR_ORPHAN_VARIABLE" : "ERR_UNWIRED_CODE",
          severity: "error",
          message: isVar
            ? `Orphan variable '${sym.name}' declared at line ${sym.line} is never referenced or wired in this unit.`
            : `Unwired ${sym.kind} '${sym.name}' declared at line ${sym.line} is never called or wired into callers.`,
          filePath,
          line: sym.line,
          column: 1,
          language,
          symbol: sym.name,
          callerPerimeter: callers.slice(0, 5),
          suggestedFix: {
            wireAction: "wire_to_caller",
            callerContext: callers.length > 0 ? `Wire to: ${callers.slice(0, 3).join(", ")}` : undefined,
            replacementText: isVar
              ? `Wire variable '${sym.name}' into call chain or delete it.`
              : `Wire '${sym.name}()' to a caller or delete it.`,
          },
        })
      }
    }

    for (const imp of imports) {
      if (imp.isWildcard) continue
      const count = importUsageCounts.get(imp.name) ?? 0
      if (count === 0) {
        diagnostics.push({
          code: "ERR_ORPHAN_IMPORT",
          severity: "warning",
          message: `Unused import '${imp.fullPath}' at line ${imp.line}. Symbol '${imp.name}' is never referenced in file.`,
          filePath,
          line: imp.line,
          column: 1,
          language,
          symbol: imp.name,
          suggestedFix: {
            importToRemove: imp.fullPath,
          },
        })
      }
    }

    return {
      passed: diagnostics.filter((d) => d.severity === "error").length === 0,
      language,
      filePath,
      diagnostics,
    }
  }
}
