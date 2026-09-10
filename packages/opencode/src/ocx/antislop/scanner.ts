import { scanText } from "../slop-gate"
import { CommentSlop } from "./comment"
import { classify, isConfigurationSurface, isHumanFacingSurface, isSourceSurface, type ArtifactSurface } from "./artifact-classifier"
import { DependencySlop } from "./dependency"
import { IdentifierShapeAnalyzer } from "./identifier-shape"
import { StructuralSlop } from "./structural"
import { SystemsSlop } from "./systems"
import { TestSlop } from "./test-slop"
import { ErrorHandlingSlop } from "./error-handling"
import { FakeCompleteness } from "./fake-completeness"
import { ArchitectureSlop } from "./architecture"
import { AbstractionSlop } from "./abstraction"
import { SecuritySlop } from "./security"
import { PerformanceSlop } from "./performance"
import { createPolicy, type SlopPolicy } from "./policy"
import type { SemanticNeighborhood } from "./context"
import type { ProjectVocabulary } from "./vocabulary"

export type SignalFamily =
  | "naming"
  | "comments"
  | "prose"
  | "structure"
  | "dependency"
  | "tests"
  | "frontend"
  | "systems"
  | "error_handling"
  | "fake_completeness"
  | "vibe_coding"
  | "architecture"
  | "abstraction"
  | "security"
  | "performance"
export type SignalSeverity = "info" | "review" | "repair" | "block"

export type SlopSignal = {
  readonly id: string
  readonly family: SignalFamily
  readonly surface: ArtifactSurface
  readonly severity: SignalSeverity
  readonly evidence: string
  readonly action: string
  readonly path?: string
  readonly span?: string
  readonly confidence: "low" | "medium" | "high"
  readonly advisory: true
  readonly automaticRepair: false
}

export type ScanInput = {
  readonly path?: string
  readonly content: string
  readonly surface?: ArtifactSurface
  readonly policy?: SlopPolicy
  readonly vocabulary?: ProjectVocabulary
  readonly neighborhood?: SemanticNeighborhood
}

export type ScanFileInput = {
  readonly path: string
  readonly content?: string
  readonly status?: "readable" | "unreadable" | "unsupported" | "too_large"
  readonly detail?: string
}

export type ScanNotice = {
  readonly path: string
  readonly status: "unreadable" | "unsupported" | "too_large" | "file_limit" | "finding_limit"
  readonly detail?: string
}

export type ScanResult = {
  readonly surface: ArtifactSurface
  readonly signals: readonly SlopSignal[]
  readonly notices: readonly ScanNotice[]
  readonly score: number
  readonly automaticRepair: false
  readonly scanned: number
}

export type ScanFilesInput = {
  readonly files: readonly ScanFileInput[]
  readonly policy?: SlopPolicy
  readonly vocabulary?: ProjectVocabulary
  readonly neighborhoods?: ReadonlyMap<string, SemanticNeighborhood>
  readonly maxFiles?: number
  readonly maxBytes?: number
  readonly maxFindings?: number
}

export function scan(input: ScanInput): ScanResult {
  const surface = input.surface ?? classify(input.path ?? "")
  const policy = createPolicy(input.policy)
  const notices = surface === "unknown" && input.path ? [{ path: input.path, status: "unsupported" as const }] : []
  if (!policy.enabled) return { surface, signals: [], notices, score: 0, automaticRepair: false, scanned: 1 }
  const signals: SlopSignal[] = []
  const path = input.path
  const context = input.neighborhood
  const code = stripComments(input.content)
  if (isSourceSurface(surface)) {
    for (const finding of IdentifierShapeAnalyzer.scanSource(
      code,
      path,
      {
        ...(context?.owner ? { enclosingTerms: [context.owner.name] } : {}),
        ...(input.vocabulary ? { establishedTerms: input.vocabulary.terms } : {}),
      },
      policy,
    ))
      signals.push({
        id: finding.rule,
        family: "naming",
        surface,
        severity: finding.analysis.action === "reject" ? "repair" : "review",
        evidence: finding.evidence,
        action: finding.fix,
        ...(path ? { path } : {}),
        span: finding.identifier,
        confidence: input.vocabulary || context ? "medium" : "low",
        advisory: true,
        automaticRepair: false,
      })
    if (surface === "source_code" || surface === "code_comment") {
      addLegacySignals(signals, CommentSlop.scanComments(input.content, path ?? ""), "comments", surface, path)
      addLegacySignals(signals, FakeCompleteness.scanFakeCompleteness(code, path ?? ""), "fake_completeness", surface, path)
      addLegacySignals(signals, ErrorHandlingSlop.scanErrorHandling(code, path ?? ""), "error_handling", surface, path)
      addLegacySignals(signals, ArchitectureSlop.scanArchitectureSlop(code, path ?? ""), "architecture", surface, path)
      addLegacySignals(signals, AbstractionSlop.scanAbstraction(code, path ?? ""), "abstraction", surface, path)
      addLegacySignals(signals, SecuritySlop.scanSecuritySlop(code, path ?? ""), "security", surface, path)
      addLegacySignals(signals, PerformanceSlop.scanPerformanceSlop(code, path ?? ""), "performance", surface, path)
      if (/\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(path ?? "")) {
        addLegacySignals(signals, StructuralSlop.scanStructural(code, path ?? ""), "structure", surface, path)
        addLegacySignals(signals, DependencySlop.scanDependency(code, path ?? ""), "dependency", surface, path)
      }
      if (/\.(?:c|cc|cpp|cxx|h|hpp|rs|java|kt)$/i.test(path ?? "") || /Android\.bp/i.test(path ?? "")) {
        addLegacySignals(signals, SystemsSlop.scanSystems(code, path ?? ""), "systems", surface, path)
      }
      if (/\.(?:test|spec)\.[jt]sx?$/.test(path ?? ""))
        addLegacySignals(signals, TestSlop.scanTestSlop(code, path ?? ""), "tests", surface, path)
    }
  }
  if (isConfigurationSurface(surface)) {
    addLegacySignals(signals, SecuritySlop.scanSecuritySlop(code, path ?? ""), "security", surface, path)
    addLegacySignals(signals, DependencySlop.scanDependency(code, path ?? ""), "dependency", surface, path)
    addLegacySignals(signals, FakeCompleteness.scanFakeCompleteness(code, path ?? ""), "fake_completeness", surface, path)
    addLegacySignals(signals, CommentSlop.scanComments(input.content, path ?? ""), "comments", surface, path)
  }
  if (isHumanFacingSurface(surface)) addTextSignals(signals, scanText(input.content), "prose", surface, path)
  const unique = uniqueSignals(signals)
  return { surface, signals: unique, notices, score: score(unique), automaticRepair: false, scanned: 1 }
}

export function scanFiles(input: ScanFilesInput): ScanResult {
  const maxFiles = Math.max(0, input.maxFiles ?? 64)
  const maxBytes = Math.max(1, input.maxBytes ?? 1_048_576)
  const maxFindings = Math.max(0, input.maxFindings ?? 64)
  const signals: SlopSignal[] = []
  const notices: ScanNotice[] = []
  let scanned = 0
  for (const [index, file] of input.files.entries()) {
    if (index >= maxFiles) {
      notices.push({ path: file.path, status: "file_limit", detail: `scan limit is ${maxFiles} files` })
      continue
    }
    if (file.status === "unsupported" || file.status === "unreadable" || file.status === "too_large") {
      notices.push({ path: file.path, status: file.status, detail: file.detail })
      continue
    }
    if (file.content === undefined) {
      notices.push({ path: file.path, status: "unreadable", detail: "file content was not provided" })
      continue
    }
    if (new TextEncoder().encode(file.content).byteLength > maxBytes) {
      notices.push({ path: file.path, status: "too_large", detail: `scan limit is ${maxBytes} bytes` })
      continue
    }
    const result = scan({
      path: file.path,
      content: file.content,
      ...(input.policy ? { policy: input.policy } : {}),
      ...(input.vocabulary ? { vocabulary: input.vocabulary } : {}),
      ...(input.neighborhoods?.get(file.path) ? { neighborhood: input.neighborhoods.get(file.path) } : {}),
    })
    signals.push(...result.signals)
    notices.push(...result.notices)
    scanned++
    if (signals.length >= maxFindings) {
      for (const remaining of input.files.slice(index + 1)) notices.push({ path: remaining.path, status: "finding_limit", detail: `finding limit is ${maxFindings}` })
      break
    }
  }
  const unique = uniqueSignals(signals).slice(0, maxFindings)
  const surfaces = input.files.map((file) => classify(file.path)).filter((surface) => surface !== "unknown")
  const surface = surfaces.length === 0 ? "unknown" : new Set(surfaces).size === 1 ? surfaces[0]! : "unknown"
  return { surface, signals: unique, notices, score: score(unique), automaticRepair: false, scanned }
}

function stripComments(content: string): string {
  let result = ""
  let quote: "'" | '"' | "`" | undefined
  let lineComment = false
  let blockComment = false
  let escaped = false
  for (let index = 0; index < content.length; index++) {
    const current = content[index]
    const next = content[index + 1]
    if (lineComment) {
      if (current === "\n") {
        lineComment = false
        result += current
      } else result += " "
      continue
    }
    if (blockComment) {
      if (current === "*" && next === "/") {
        blockComment = false
        result += "  "
        index++
      } else result += current === "\n" ? "\n" : " "
      continue
    }
    if (quote) {
      result += current
      if (escaped) {
        escaped = false
        continue
      }
      if (current === "\\") {
        escaped = true
        continue
      }
      if (current === quote) quote = undefined
      continue
    }
    if (current === "'" || current === '"' || current === "`") {
      quote = current
      result += current
      continue
    }
    if (current === "/" && next === "/") {
      lineComment = true
      result += "  "
      index++
      continue
    }
    if (current === "/" && next === "*") {
      blockComment = true
      result += "  "
      index++
      continue
    }
    result += current
  }
  return result
}

function addLegacySignals(
  target: SlopSignal[],
  findings: readonly { rule: string; severity: "warning" | "blocker"; evidence: string; fix: string }[],
  family: SignalFamily,
  surface: ArtifactSurface,
  path: string | undefined,
): void {
  for (const finding of findings)
    target.push({
      id: finding.rule,
      family,
      surface,
      severity: finding.severity === "blocker" ? "block" : "review",
      evidence: finding.evidence,
      action: finding.fix,
      ...(path ? { path } : {}),
      span: finding.evidence,
      confidence: "low",
      advisory: true,
      automaticRepair: false,
    })
}

function addTextSignals(
  target: SlopSignal[],
  findings: readonly { rule: string; severity: "warning" | "blocker"; evidence: string; fix: string }[],
  family: SignalFamily,
  surface: ArtifactSurface,
  path: string | undefined,
): void {
  addLegacySignals(target, findings, family, surface, path)
}

function uniqueSignals(signals: readonly SlopSignal[]): SlopSignal[] {
  const seen = new Set<string>()
  return signals.filter((signal) => {
    const key = `${signal.id}:${signal.path ?? ""}:${signal.span ?? signal.evidence}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function score(signals: readonly SlopSignal[]): number {
  return signals.reduce((total, signal) => total + (signal.severity === "block" ? 3 : signal.severity === "repair" ? 2 : 1), 0)
}

export * as SlopSignalScanner from "./scanner"
