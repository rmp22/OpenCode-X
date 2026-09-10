export type SeverityLevel = "error" | "warning" | "info";

export type RuleCategory =
  | "style"
  | "eng-practices"
  | "testing"
  | "api-design"
  | "architecture"
  | "security"
  | "documentation";

export type SupportedLanguage =
  | "typescript"
  | "javascript"
  | "python"
  | "java"
  | "cpp"
  | "go"
  | "shell"
  | "html"
  | "css"
  | "json"
  | "markdown"
  | "all";

export interface DiffHunk {
  readonly oldStart: number
  readonly oldLines: number
  readonly newStart: number
  readonly newLines: number
  readonly lines: readonly string[]
}

export interface RuleContext {
  readonly filePath: string
  readonly content: string
  readonly lines: readonly string[]
  readonly language: SupportedLanguage
  readonly isDiff?: boolean
  readonly diffHunks?: readonly DiffHunk[]
  readonly gitCommitMessage?: string
  readonly changedFilesCount?: number
  readonly changedLinesCount?: number
}

export interface GoogleFinding {
  readonly ruleId: string
  readonly category: RuleCategory
  readonly severity: SeverityLevel
  readonly file: string
  readonly line: number
  readonly column: number
  readonly message: string
  readonly explanation?: string
  readonly citation?: string
  readonly fixable: boolean
  readonly suggestion?: string
  readonly snippet?: string
}

export interface GoogleRule {
  readonly id: string
  readonly name: string
  readonly category: RuleCategory
  readonly languages: readonly SupportedLanguage[]
  readonly severity: SeverityLevel
  readonly description: string
  readonly rationale: string
  readonly citation: string
  readonly fixable: boolean
  readonly check: (context: RuleContext) => readonly GoogleFinding[]
}

export interface ScanOptions {
  readonly categories?: readonly RuleCategory[]
  readonly minSeverity?: SeverityLevel
  readonly languages?: readonly SupportedLanguage[]
  readonly excludeRuleIds?: readonly string[]
  readonly includeRuleIds?: readonly string[]
  readonly diffOnly?: boolean
  readonly maxErrors?: number
}

export interface ScanResult {
  readonly findings: readonly GoogleFinding[]
  readonly totalScannedFiles: number
  readonly totalScannedLines: number
  readonly durationMs: number
  readonly errorCount: number
  readonly warningCount: number
  readonly infoCount: number
  readonly passed: boolean
  readonly summary: string
}

export interface FixResult {
  readonly filePath: string
  readonly fixedCount: number
  readonly originalContent: string
  readonly fixedContent: string
  readonly modified: boolean
  readonly appliedRuleIds: readonly string[]
}

export interface PracticeCatalogEntry {
  readonly id: string
  readonly title: string
  readonly category: RuleCategory
  readonly source: string
  readonly sourceUrl?: string
  readonly summary: string
  readonly detailedPrinciples: readonly string[]
  readonly antiPatterns: readonly string[]
  readonly recommendedPatterns: readonly string[]
}
