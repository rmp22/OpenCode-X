import { readFileSync, statSync } from "node:fs"
import { classify } from "./artifact-classifier"
import { type ScanFileInput, scanFiles, type ScanFilesInput } from "./scanner"
import type { ProjectVocabulary } from "./vocabulary"
import type { SlopPolicy } from "./policy"
import type { SemanticNeighborhood } from "./context"

export type RuntimeAdvisory = {
  readonly id: string
  readonly message: string
  readonly span?: string
  readonly severity: "info" | "review" | "repair" | "block"
}

export type RuntimeScanInput = {
  readonly files: readonly (string | { path: string; content?: string })[]
  readonly policy?: SlopPolicy
  readonly vocabulary?: ProjectVocabulary
  readonly neighborhoods?: ReadonlyMap<string, SemanticNeighborhood>
}

export function scanChangedFiles(input: RuntimeScanInput): RuntimeAdvisory[] {
  if (input.policy?.enabled === false) return []
  const resolvedFiles = input.files.map((file): ScanFileInput => {
    const path = typeof file === "string" ? file : file.path
    if (typeof file !== "string" && file.content !== undefined) return { path, content: file.content }
    if (classify(path) === "unknown") return { path, status: "unsupported" }
    try {
      const stats = statSync(path)
      if (!stats.isFile()) return { path, status: "unreadable", detail: "path is not a regular file" }
      if (stats.size > 1_048_576) return { path, status: "too_large", detail: "scan limit is 1048576 bytes" }
      return { path, content: readFileSync(path, "utf8") }
    } catch (error) {
      return { path, status: "unreadable", detail: error instanceof Error ? error.message : "unable to read file" }
    }
  })
  const result = scanFiles({
    files: resolvedFiles,
    maxFiles: 64,
    maxBytes: 1_048_576,
    maxFindings: 64,
    ...(input.policy ? { policy: input.policy } : {}),
    ...(input.vocabulary ? { vocabulary: input.vocabulary } : {}),
    ...(input.neighborhoods ? { neighborhoods: input.neighborhoods } : {}),
  } satisfies ScanFilesInput)
  const signals = result.signals.map((signal) => {
    const id = signal.id.startsWith("A-") || signal.id.startsWith("V-") ? signal.id : `A-${signal.id}`
    return {
      id,
      message: `${signal.evidence}: ${signal.action}`,
      ...(signal.span ? { span: signal.span } : {}),
      severity: signal.severity,
    }
  })
  const notices = result.notices.map((notice) => ({
    id: `A-SCAN-${notice.status.toUpperCase()}`,
    message: `${notice.path}: ${notice.detail ?? notice.status}`,
    severity: notice.status === "unsupported" ? ("review" as const) : ("block" as const),
  }))
  return [...signals, ...notices]
}

export * as AntiSlopRuntime from "./runtime"
