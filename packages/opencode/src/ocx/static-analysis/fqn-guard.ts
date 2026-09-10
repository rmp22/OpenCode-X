import {
  detectLanguage,
  LANGUAGE_SPECS,
  type ImportedSymbol,
  type StaticDiagnostic,
  type SupportedLanguage,
} from "./types"

const KNOWN_PACKAGE_PREFIXES = [
  "java.",
  "javax.",
  "android.",
  "androidx.",
  "com.",
  "org.",
  "io.",
  "net.",
  "kotlin.",
  "kotlinx.",
  "sun.",
  "System.",
  "Microsoft.",
]

export interface FqnCheckOptions {
  readonly allowAmbiguousFallbackInJava?: boolean
}

export class FqnGuard {
  static extractImports(filePath: string, content: string): Map<string, string> {
    const language = detectLanguage(filePath)
    const simpleNames = new Map<string, string>()
    if (language !== "java" && language !== "kotlin" && language !== "csharp") return simpleNames

    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim()
      if (language === "csharp" && line.startsWith("using ")) {
        const rest = line.replace(/^using\s+/, "").replace(/;.*$/, "").trim()
        if (rest.includes("=")) {
          const [alias, fullPath] = rest.split("=")
          if (alias && fullPath) simpleNames.set(alias.trim(), fullPath.trim())
        } else if (rest.length > 0) {
          const parts = rest.split(".")
          const simple = parts[parts.length - 1]
          if (simple) simpleNames.set(simple, rest)
        }
        continue
      }
      if (!line.startsWith("import ")) continue
      const rest = line
        .replace(/^import\s+(?:static\s+)?/, "")
        .replace(/;.*$/, "")
        .trim()
      if (rest.endsWith(".*")) continue
      if (rest.includes(" as ")) {
        const [fullPath, alias] = rest.split(/\s+as\s+/)
        if (alias) simpleNames.set(alias.trim(), fullPath.trim())
        continue
      }
      const parts = rest.split(".")
      const simpleName = parts[parts.length - 1]
      if (simpleName && simpleName !== "*") simpleNames.set(simpleName, rest)
    }

    return simpleNames
  }

  static check(
    filePath: string,
    content: string,
    importedSymbols: readonly ImportedSymbol[] = [],
    options?: FqnCheckOptions,
  ): readonly StaticDiagnostic[] {
    const language = detectLanguage(filePath)
    if (!language) return []

    const spec = LANGUAGE_SPECS[language]
    if (!spec.disallowInlineFqn) return []

    const lines = content.split(/\r?\n/)
    const diagnostics: StaticDiagnostic[] = []

    const importedSimpleNames = new Map<string, string>()
    for (const imp of importedSymbols) {
      if (!imp.isWildcard) {
        importedSimpleNames.set(imp.name, imp.fullPath)
      }
    }
    for (const [simpleName, fullPath] of FqnGuard.extractImports(filePath, content)) {
      if (!importedSimpleNames.has(simpleName)) {
        importedSimpleNames.set(simpleName, fullPath)
      }
    }

    let inBlockComment = false

    for (let idx = 0; idx < lines.length; idx++) {
      let line = lines[idx]
      const lineNum = idx + 1

      if (inBlockComment) {
        const endIdx = line.indexOf("*/")
        if (endIdx !== -1) {
          inBlockComment = false
          line = line.slice(endIdx + 2)
        } else {
          continue
        }
      }

      const blockStart = line.indexOf("/*")
      if (blockStart !== -1) {
        const blockEnd = line.indexOf("*/", blockStart + 2)
        if (blockEnd !== -1) {
          line = line.slice(0, blockStart) + " " + line.slice(blockEnd + 2)
        } else {
          inBlockComment = true
          line = line.slice(0, blockStart)
        }
      }

      const lineCommentIdx = line.indexOf("//")
      if (lineCommentIdx !== -1) {
        line = line.slice(0, lineCommentIdx)
      }

      const trimmed = line.trim()
      if (
        trimmed.startsWith("package ") ||
        trimmed.startsWith("import ") ||
        trimmed.startsWith("using ") ||
        trimmed.startsWith("/*") ||
        trimmed.startsWith("*")
      ) {
        continue
      }

      const lineWithoutStrings = line.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, " ")

      const fqnPattern = /\b([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*)\.([A-Z][A-Za-z0-9_$]*)\b/g
      let match: RegExpExecArray | null

      while ((match = fqnPattern.exec(lineWithoutStrings)) !== null) {
        const fullFqn = match[0]
        const packagePrefix = match[1] + "."
        const simpleName = match[2]
        const colNum = match.index + 1

        const isKnownPrefix = KNOWN_PACKAGE_PREFIXES.some((p) => fullFqn.startsWith(p))
        const isPackageLike = match[1].includes(".") && /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/.test(match[1])

        if (!isKnownPrefix && !isPackageLike) {
          continue
        }

        const existingImport = importedSimpleNames.get(simpleName)
        const isAmbiguous = existingImport !== undefined && existingImport !== fullFqn

        if (language === "kotlin") {
          diagnostics.push({
            code: "ERR_INLINE_FQN",
            severity: "error",
            message: isAmbiguous
              ? `Inline FQN '${fullFqn}' is forbidden in Kotlin even on collision. Add an aliased import 'import ${fullFqn} as <Alias>' at the top of the file and reference '<Alias>'.`
              : `Inline FQN '${fullFqn}' is forbidden in Kotlin. Add 'import ${fullFqn}' at the top of the file and use simple name '${simpleName}'.`,
            filePath,
            line: lineNum,
            column: colNum,
            language,
            symbol: fullFqn,
            suggestedFix: {
              importToAdd: fullFqn,
              aliasRequired: isAmbiguous,
              replacementText: simpleName,
            },
          })
        } else if (language === "java") {
          if (isAmbiguous) {
            continue
          }

          diagnostics.push({
            code: "ERR_INLINE_FQN",
            severity: "error",
            message: `Inline FQN '${fullFqn}' is forbidden in Java. Add 'import ${fullFqn};' at the top of the file and use simple name '${simpleName}'.`,
            filePath,
            line: lineNum,
            column: colNum,
            language,
            symbol: fullFqn,
            suggestedFix: {
              importToAdd: fullFqn,
              replacementText: simpleName,
            },
          })
        } else if (language === "csharp") {
          diagnostics.push({
            code: "ERR_INLINE_FQN",
            severity: "error",
            message: isAmbiguous
              ? `Inline FQN '${fullFqn}' is forbidden in C#. Add an aliased using 'using ${simpleName}Alias = ${fullFqn};' at the top of the file and reference '${simpleName}Alias'.`
              : `Inline FQN '${fullFqn}' is forbidden in C#. Add 'using ${match[1]};' at the top of the file and use simple name '${simpleName}'.`,
            filePath,
            line: lineNum,
            column: colNum,
            language,
            symbol: fullFqn,
            suggestedFix: {
              importToAdd: isAmbiguous ? `using ${simpleName}Alias = ${fullFqn};` : `using ${match[1]};`,
              aliasRequired: isAmbiguous,
              replacementText: isAmbiguous ? `${simpleName}Alias` : simpleName,
            },
          })
        }
      }
    }

    return diagnostics
  }
}
