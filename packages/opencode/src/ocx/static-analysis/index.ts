import { ScopeAnalyzer } from "./analyzer"
import { FqnGuard, type FqnCheckOptions } from "./fqn-guard"
import {
  detectLanguage,
  type StaticAuditResult,
  type StaticDiagnostic,
  type SupportedLanguage,
} from "./types"

export * from "./types"
export * from "./analyzer"
export * from "./fqn-guard"

export class UnifiedStaticGate {
  static audit(
    filePath: string,
    content: string,
    options?: FqnCheckOptions,
  ): StaticAuditResult {
    const language = detectLanguage(filePath)
    if (!language) {
      return {
        passed: true,
        language: "typescript",
        filePath,
        diagnostics: [],
      }
    }

    const scopeResult = ScopeAnalyzer.analyze(filePath, content)
    const fqnDiagnostics = FqnGuard.check(filePath, content, [], options)

    const allDiagnostics: StaticDiagnostic[] = [
      ...scopeResult.diagnostics,
      ...fqnDiagnostics,
    ]

    const hasErrors = allDiagnostics.some((d) => d.severity === "error")

    return {
      passed: !hasErrors,
      language,
      filePath,
      diagnostics: allDiagnostics,
    }
  }
}
