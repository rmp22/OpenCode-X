import { UnifiedStaticGate } from "../static-analysis"
import { changedLineSet } from "./changed-lines"
import { detectStaticLanguage } from "./types"
import { UniversalChecks } from "./universal"

export * from "./types"
export * from "./universal"
export * from "./changed-lines"

export interface MergedStaticCheckResult {
  readonly passed: boolean
  readonly filePath: string
  readonly language: string
  readonly universal: ReturnType<typeof UniversalChecks.audit>
  readonly languageDiagnostics: ReadonlyArray<{
    readonly code: string
    readonly severity: "error" | "warning"
    readonly message: string
    readonly line: number
  }>
}

const SUPPORTED_GATE_LANGUAGES = new Set([
  "java",
  "kotlin",
  "typescript",
  "javascript",
  "python",
  "go",
  "rust",
  "c",
  "cpp",
])

export class StaticChecks {
  static auditFile(
    filePath: string,
    content: string,
    options?: { readonly previousContent?: string },
  ): MergedStaticCheckResult {
    const language = detectStaticLanguage(filePath)
    const universal = UniversalChecks.audit(filePath, content, language)

    if (!SUPPORTED_GATE_LANGUAGES.has(language)) {
      return {
        passed: universal.passed,
        filePath,
        language,
        universal,
        languageDiagnostics: [],
      }
    }

    const gateResult = UnifiedStaticGate.audit(filePath, content)
    let diagnostics = gateResult.diagnostics.map((d) => ({
      code: d.code,
      severity: d.severity,
      message: d.message,
      line: d.line,
    }))

    if (options?.previousContent !== undefined && options.previousContent !== content) {
      const changed = changedLineSet(options.previousContent, content)
      diagnostics = diagnostics.filter((d) => changed.has(d.line))
    }

    return {
      passed: universal.passed && diagnostics.filter((d) => d.severity === "error").length === 0,
      filePath,
      language,
      universal,
      languageDiagnostics: diagnostics,
    }
  }
}

export * as StaticChecksModule from "."
