import { Effect } from "effect"
import { scanTextAsync } from "./slop-gate"
import type { CheckKind, LedgerEntry } from "./ledger"
import { changedPaths, lastOutcome, matchExpect, sourcePaths } from "./ledger"
import type { PlanStep } from "./header"
import type { ExecutionPlan } from "./plan-workstream-state"
import type { WorkSurface } from "./workflow"
import { BuildGuard } from "@/ocx/build-guard"
import { scanArtifact, scanText, STYLE_RULES } from "./slop-gate"
import { referenceFindings } from "./fact-gate"
import { lineFindings, webFindings } from "./code-gate"
import { arithmeticFindings, reversalFindings } from "./reason-gate"
import { dependencyFindings } from "./dependency-gate"
import { OutputFormat } from "./output-format"
import { AntiSlopRuntime } from "./antislop/runtime"
import { ComprehensionGate } from "./antislop/comprehension"
import { ReviewCostGate } from "./antislop/review-cost"
import { SlopSignalScanner } from "./antislop/scanner"

function resolveRelative(fromPath: string, spec: string, files: Set<string>): string | undefined {
  const isPy = fromPath.endsWith(".py")
  const dir = fromPath.replace(/\/[^/]*$/, "")
  if (!isPy) {
    const base = `${dir}/${spec}`.replace(/\/\.\//g, "/")
    const candidates = [".ts", ".tsx", ".js", ".jsx", ".mjs"].map((ext) => `${base}${ext}`)
    candidates.push(`${base}/index.ts`, `${base}/index.js`)
    for (const candidate of candidates) if (files.has(candidate)) return candidate
    return undefined
  }
  let ups = 0
  let rest = spec
  while (rest.startsWith(".")) {
    ups++
    rest = rest.slice(1)
  }
  rest = rest.replace(/^\//, "")
  const parts = fromPath.split("/").slice(0, -1)
  for (let i = 1; i < ups; i++) parts.pop()
  const candidate = [...parts, ...rest.split(".")].filter(Boolean).join("/")
  return files.has(`${candidate}.py`) ? `${candidate}.py` : undefined
}

export function importCycleFinding(added?: ReadonlyMap<string, readonly string[]>): Finding | undefined {
  if (!added || added.size === 0) return undefined
  const files = new Set([...added.keys()])
  const graph = new Map<string, Set<string>>()
  for (const [path, lines] of added) {
    if (!/\.(ts|tsx|js|jsx|mjs|py)$/.test(path)) continue
    for (const line of lines) {
      const js = /^\s*(?:import|export)\b.*?["'](\.[^"']+)["']/.exec(line)
      const py = /^\s*from\s+(\.[\w.]*)\s+import\b/.exec(line)
      const spec = js?.[1] ?? py?.[1]
      if (!spec || !spec.startsWith(".")) continue
      const target = resolveRelative(path, spec, files)
      if (target && target !== path) {
        const set = graph.get(path) ?? new Set<string>()
        set.add(target)
        graph.set(path, set)
      }
    }
  }
  const color = new Map<string, 1 | 2>()
  const stack: string[] = []
  const visit = (node: string): string[] | undefined => {
    color.set(node, 1)
    stack.push(node)
    for (const next of graph.get(node) ?? []) {
      const state = color.get(next)
      if (state === 1) {
        const start = stack.indexOf(next)
        return [...stack.slice(start), next]
      }
      if (state === undefined) {
        const found = visit(next)
        if (found) return found
      }
    }
    stack.pop()
    color.set(node, 2)
    return undefined
  }
  for (const node of graph.keys()) {
    if (color.has(node)) continue
    const cycle = visit(node)
    if (cycle)
      return {
        id: "C20-import-cycle",
        message: `circular import between changed files: ${cycle.join(" -> ")}; extract the shared part into a leaf module or invert one dependency`,
        span: cycle.join(" -> ").slice(0, 120),
      }
  }
  return undefined
}

export type GateTier = "quick" | "standard" | "full"

export type Finding = {
  readonly id: string
  readonly message: string
  readonly span?: string
}

const SPAN_EXCERPT = 80
const BLOCKERS_PER_FILE = 3
const DUPLICATION_FINDINGS_MAX = 3
const MISSING_ASSETS_MAX = 5

export type DesignRecord = {
  readonly direction: string
  readonly distinctiveDecisions: readonly string[]
}

export type GateInput = {
  readonly reply: string
  readonly entries: readonly LedgerEntry[]
  readonly openTodos: readonly string[]
  readonly tier: GateTier
  readonly plan?: readonly PlanStep[]
  readonly executionPlan?: ExecutionPlan
  readonly added?: ReadonlyMap<string, readonly string[]>
  readonly design?: DesignRecord
  readonly priorReadPaths?: readonly string[]
  readonly sources?: readonly string[]
  readonly manifest?: string
  readonly strictOutput?: boolean
  readonly strictPlanChecks?: boolean
  readonly userPrompt?: string
  readonly comprehension?: ComprehensionGate.ComprehensionInput
  readonly reviewCost?: ReviewCostGate.ReviewCostInput
  readonly validationSurfaces?: readonly WorkSurface[]
  readonly domainChecks?: boolean
}

const BANNED_WORDS = [
  "delve",
  "tapestry",
  "testament",
  "boast",
  "showcase",
  "seamlessly",
  "seamless",
  "world-class",
  "cutting-edge",
  "state-of-the-art",
  "game-changer",
  "revolutionary",
  "breathtaking",
  "supercharge",
  "effortlessly",
  "utilize",
  "leverage",
  "furthermore",
  "aforementioned",
]

const CHEER_PATTERNS = [
  /(^|\n)(?:good|great|excellent|perfect|awesome|nice)\s*[!.](?=\s|$)/gi,
  /\bgreat progress\b/gi,
]

const WORD_LIMIT = 25
const PLAN_CHECK_LANGUAGE = /\b(?:benchmark|check|compile|coverage|green|pass|run|smoke|suite|verify)\w*\b/i
const BROAD_SCOPE_LANGUAGE = /\b(?:add|all|complete|entire|everything|finish|fix|fully|implement|remove|replace|regenerate|update)\w*\b/i
const REDUCED_SCOPE_LANGUAGE = /\b(?:can't|cannot|defer\w*|didn't|did not|left|not available|not done|not implement\w*|not possible|only|out of scope|remain\w*|skip\w*|unable|unavailable|without (?:a|the)\s+\w+)\b/i
const ACCEPTED_SCOPE_LANGUAGE = /\b(?:exclude\w*|just|only|out of scope|without)\b/i
const BLOCKING_FINDINGS = new Set([
  "O1-output-header",
  "C29-plan-check-unknown",
  "C30-scope-reduced",
  "C32-rerun-greenwashing",
  "CG-missing-evidence",
  "C33-review-cost",
  "C34-execution-plan-check",
  "R1-review-finding",
])

export function hitLengthCap(parts: readonly { type?: string; reason?: string }[]): boolean {
  const finishes = parts.filter((part) => part.type === "step-finish")
  return finishes.at(-1)?.reason === "length"
}

const DELIVERY_LANGUAGE =
  /deliver\w*\s+(?:the\s+)?(?:\d+\s+)?files|save (?:them |it )?(?:at|to|as) |exact relative path|file \d+ of \d+/i

export function codeInChatFinding(reply: string, entries: readonly LedgerEntry[]): Finding | undefined {
  if (entries.some((entry) => entry.kind === "write" || entry.kind === "edit")) return undefined
  const blocks = Math.floor((reply.match(/^```/gm) ?? []).length / 2)
  if (blocks < 2 || !DELIVERY_LANGUAGE.test(reply)) return undefined
  return {
    id: "C22-code-in-chat",
    message: `${blocks} code blocks delivered as chat while zero files were written this turn; create the files with the write tool instead`,
    span: `${blocks} blocks`,
  }
}

export function blocksClose(finding: Finding): boolean {
  return BLOCKING_FINDINGS.has(finding.id)
}

export function scopeReductionFinding(reply: string, userPrompt: string): Finding | undefined {
  if (!/\bSTATE:\s*done\b/i.test(reply)) return undefined
  if (!BROAD_SCOPE_LANGUAGE.test(userPrompt) || ACCEPTED_SCOPE_LANGUAGE.test(userPrompt)) return undefined
  const reduced = REDUCED_SCOPE_LANGUAGE.exec(reply)
  if (!reduced) return undefined
  return {
    id: "C30-scope-reduced",
    message: `the reply closes a broad request while narrowing scope with "${reduced[0]}"; get user approval or keep working before declaring done`,
    span: reduced[0],
  }
}

function executionPlanFindings(plan: ExecutionPlan | undefined): Finding[] {
  if (!plan) return []
  return plan.workstreams
    .flatMap((workstream) =>
      workstream.steps.flatMap((step) =>
        step.checks
          .filter((check) => check.status !== "passed")
          .map((check) => ({
            id: "C34-execution-plan-check",
            message: `${workstream.id}/${step.id} check "${check.description}" is ${check.status}; record trusted runtime evidence before finishing`,
            span: check.id,
          })),
      ),
    )
    .slice(0, 8)
}

function replyBody(reply: string): string {
  return reply.replaceAll(/```[\s\S]*?```/g, "")
}

function sentences(body: string): string[] {
  return body
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
}




export function unsupportedQualityClaims(reply: string, changedCount: number): Finding[] {
  if (changedCount === 0) return []
  const claim =
    /\b(?:production[- ]ready|looks good|works perfectly|all good|everything works|fully functional|guaranteed|risk[- ]free|bug[- ]free|cannot fail|zero (?:bugs|errors)|without a doubt|impossible to (?:fail|break))\b/i.exec(reply)
  if (!claim) return []
  return [{
    id: "E11-unsupported-quality-claim",
    message: `"${claim[0]}" is a verdict without evidence; back it with observable facts (command results, rendered checks, measured values) or remove the claim`,
    span: claim[0],
  }]
}


export function planConformance(planned: readonly string[], changed: readonly string[]): Finding[] {
  if (planned.length === 0 || changed.length === 0) return []
  const written = new Set(changed)
  const missing = planned.filter((p) => !written.has(p) && !changed.some((c) => c.endsWith(p) || p.endsWith(c)))
  if (missing.length >= planned.length)
    return [{
      id: "E12-plan-not-followed",
      message: `none of the ${planned.length} planned file(s) were written (${missing.slice(0, 3).join(", ")}); update the execution plan or follow it`,
      span: missing.slice(0, 2).join(" | "),
    }]
  return []
}

export function wholeFileBlockers(
  paths: readonly string[],
  readFileSafe: (path: string) => string | undefined,
  options?: { readonly domainChecks?: boolean },
): Finding[] {
  const out: Finding[] = []
  for (const path of paths) {
    const content = readFileSafe(path)
    if (content === undefined) continue

    const scan = SlopSignalScanner.scan({ path, content })
    for (const signal of scan.signals.filter((item) => item.severity === "block").slice(0, BLOCKERS_PER_FILE))
      out.push({
        id: "E7-wholefile-blocker",
        message: `${path}: ${signal.id}: ${signal.evidence}`,
        span: signal.evidence.slice(0, SPAN_EXCERPT),
      })

    if (options?.domainChecks && /\.(html?|css)$/i.test(path)) {
      for (const finding of scanArtifact(content)
        .filter((item) => item.severity === "blocker")
        .slice(0, BLOCKERS_PER_FILE))
        out.push({
          id: "E7-wholefile-blocker",
          message: `${path}: ${finding.rule}: ${finding.evidence}`,
          span: finding.evidence.slice(0, SPAN_EXCERPT),
        })
    }

  }
  return out
}

export function crossFileDuplication(added?: ReadonlyMap<string, readonly string[]>): Finding[] {
  if (!added || added.size < 2) return []
  const owners = new Map<string, Set<string>>()
  for (const [path, lines] of added) {
    for (const raw of lines) {
      const line = raw.trim()
      if (line.length < 40) continue
      if (/^(?:import|from|export default|\/\/|\*|\/\*)/.test(line)) continue
      const set = owners.get(line) ?? new Set<string>()
      set.add(path)
      owners.set(line, set)
    }
  }
  const out: Finding[] = []
  for (const [line, paths] of owners) {
    if (paths.size >= 2)
      out.push({
        id: "E8-cross-file-duplication",
        message: `identical line added in ${[...paths].join(", ")}; extract the shared block into one module`,
        span: line.slice(0, SPAN_EXCERPT),
      })
    if (out.length >= DUPLICATION_FINDINGS_MAX) break
  }
  return out
}

export function missingLocalAssets(
  added?: ReadonlyMap<string, readonly string[]>,
  readFileSafe?: (path: string) => string | undefined,
): Finding[] {
  if (!added || !readFileSafe) return []
  const out: Finding[] = []
  const seen = new Set<string>()
  for (const [path, lines] of added) {
    if (!/\.(html?|css)$/i.test(path)) continue
    const dir = path.replace(/\/[^/]*$/, "")
    for (const line of lines) {
      for (const m of line.matchAll(/(?:src|href)="(?!https?:|data:|#|mailto:|\/)([^"]+\.(?:png|jpe?g|svg|webp|gif|ico|woff2?|css|js))"/gi)) {
        const ref = m[1]
        const resolved = `${dir}/${ref.replace(/^\.\//, "")}`
        if (seen.has(resolved)) continue
        seen.add(resolved)
        if (!readFileSafe(resolved))
          out.push({
            id: "E9-missing-local-asset",
            message: `${path} references ${ref} but the file does not exist in the project`,
            span: ref.slice(0, 80),
          })
        if (out.length >= MISSING_ASSETS_MAX) return out
      }
    }
  }
  return out
}


const DESIGN_STOPWORDS = new Set([
  "with", "that", "this", "because", "instead", "every", "each", "keep", "keeps",
  "used", "using", "than", "then", "into", "onto", "from", "over", "when",
])

function designKeywords(text: string): string[] {
  return [...new Set([...text.toLowerCase().matchAll(/[a-z][a-z-]{3,}/g)].map((m) => m[0]))]
    .filter((word) => !DESIGN_STOPWORDS.has(word))
    .slice(0, 6)
}

function designTokens(text: string): string[] {
  const tokens: string[] = []
  for (const match of text.matchAll(/["']([^"']{3,})["']|\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g)) {
    const value = (match[1] ?? match[2] ?? "").trim().toLowerCase()
    if (value && !tokens.includes(value)) tokens.push(value)
  }
  return tokens.slice(0, 4)
}

export function designFidelity(
  design?: DesignRecord,
  added?: ReadonlyMap<string, readonly string[]>,
): Finding[] {
  if (!design || !added || added.size === 0) return []
  const uiLines = [...added.entries()]
    .filter(([path]) => /\.(html?|css)$/i.test(path))
    .flatMap(([, lines]) => lines)
  if (uiLines.length === 0) return []
  const corpus = uiLines.join("\n").toLowerCase()
  const findings: Finding[] = []
  for (const decision of design.distinctiveDecisions) {
    const tokens = designTokens(decision)
    if (tokens.length > 0) {
      if (tokens.some((token) => corpus.includes(token))) continue
      findings.push({
        id: "D1-design-decision-absent",
        message: `recorded decision "${decision}" has no trace in the changed UI files; apply it or resubmit the design record`,
        span: decision.slice(0, SPAN_EXCERPT),
      })
      if (findings.length >= 3) break
      continue
    }
    const keywords = designKeywords(decision)
    if (keywords.length === 0 || keywords.some((word) => corpus.includes(word))) continue
    findings.push({
      id: "D1-design-decision-absent",
      message: `recorded decision "${decision}" has no trace in the changed UI files; apply it or resubmit the design record`,
      span: decision.slice(0, SPAN_EXCERPT),
    })
    if (findings.length >= 3) break
  }
  return findings
}

export function mediaNotLocalized(added?: ReadonlyMap<string, readonly string[]>): Finding[] {
  if (!added || added.size === 0) return []
  let assetWrites = 0
  let remoteImages = 0
  let evidence = ""
  let remoteCode = 0
  let codeEvidence = ""
  let codeWrites = 0
  for (const [path, lines] of added) {
    if (/\/(?:assets?|images?|img|media)\//i.test(path)) assetWrites++
    if (/\.(?:js|css|woff2?|ttf|otf)$/i.test(path)) codeWrites++
    for (const line of lines) {
      for (const m of line.matchAll(/(?:src|content)="(https?:[^"]+\.(?:png|jpe?g|webp|gif|svg|avif)|https?:\/\/(?:images\.unsplash\.com|images\.pexels\.com|cdn\.pixabay\.com|picsum\.photos)[^"]*)"/gi)) {
        remoteImages++
        if (!evidence) evidence = m[1].slice(0, 80)
      }
      for (const m of line.matchAll(/url\(\s*["']?(https?:\/\/[^"')]+)\s*["']?\)/gi)) {
        remoteImages++
        if (!evidence) evidence = m[1].slice(0, 80)
      }
      for (const m of line.matchAll(/(?:src|href)\s*=\s*["'](https?:[^"']+)["']/gi)) {
        const url = m[1]
        if (/\.(?:js|css|woff2?|ttf|otf)(?:[?#]|$)|cdn\.tailwindcss\.com|fonts\.googleapis\.com|fonts\.gstatic\.com|unpkg\.com|cdn\.jsdelivr\.net/i.test(url)) {
          remoteCode++
          if (!codeEvidence) codeEvidence = url.slice(0, 80)
        }
      }
    }
  }
  if (remoteImages > 0 && assetWrites === 0)
    return [{
      id: "E10-media-not-localized",
      message: `${remoteImages} remote image reference(s) shipped (e.g. ${evidence}) while zero files were written under an assets directory; download the images into the project`,
      span: evidence,
    }]
  if (remoteCode > 0 && codeWrites === 0)
    return [{
      id: "E10-media-not-localized",
      message: `${remoteCode} remote script/style/font reference(s) shipped (e.g. ${codeEvidence}) with no vendored js/css/font in the change; vendor the dependency or inline critical CSS`,
      span: codeEvidence,
    }]
  return []
}

export function commentedFiles(
  paths: readonly string[],
  readFileSafe: (path: string) => string | undefined,
): Finding[] {
  const out: Finding[] = []
  for (const path of paths) {
    if (!/\.(ts|tsx|js|jsx|mjs|py|css|scss|html?|kt|kts|java|go|rs|swift|c|cc|cpp|h|hpp|m|mm|sh|bash|zsh|sql)$/i.test(path)) continue
    const content = readFileSafe(path)
    if (!content) continue
    const firstComment = commentSpans(content, /\.(?:py|sh|bash|zsh)$/i.test(path))[0]
    if (firstComment)
      out.push({
        id: "E13-comments-remain",
        message: `${path} contains commented-out code (${firstComment}); remove the dead branch or restore it as executable code`,
        span: firstComment,
      })
    if (out.length >= BLOCKERS_PER_FILE + 2) break
  }
  return out
}

function commentSpans(content: string, hashComments = false): string[] {
  const lines = content.split("\n")
  const allowed = leadingLicenseLines(lines)
  const spans: string[] = []
  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim()
    if (
      trimmed.length < 2 ||
      allowed.has(index) ||
      trimmed.startsWith("#!") ||
      /(?:eslint|oxlint|biome|ts-expect-error|ts-ignore|noqa|type: ignore|deno-lint|generated|sourceMappingURL|prettier|region|endregion)/i.test(trimmed)
    )
      continue
    const marker = commentMarker(line, hashComments)
    if (marker !== undefined && isCommentedCode(trimmed, marker)) spans.push(trimmed.slice(marker === 0 ? 0 : marker, SPAN_EXCERPT))
  }
  return spans
}

function isCommentedCode(line: string, marker: number): boolean {
  const body = line
    .slice(marker === 0 ? 2 : marker + 2)
    .replace(/^[*\s]+/, "")
    .replace(/\s*(?:\*\/|-->)\s*$/, "")
  return /^(?:const|let|var|val|if|else|for|while|switch|try|catch|return|throw|import|export|function|fun|class|interface|type|enum|def|async|await)\b/.test(body)
}

function leadingLicenseLines(lines: readonly string[]): Set<number> {
  const allowed = new Set<number>()
  let start = 0
  while (start < lines.length && lines[start].trim() === "") start++
  let end = start
  while (end < lines.length && (lines[end].trim().startsWith("/*") || lines[end].trim().startsWith("*") || lines[end].trim().startsWith("//"))) end++
  const prefix = lines.slice(start, end).join("\n")
  if (!/(?:copyright|\(c\)|©|all rights reserved|licensed under|spdx-license-identifier)/i.test(prefix))
    return allowed
  for (let index = start; index < end; index++) allowed.add(index)
  return allowed
}

function commentMarker(line: string, hashComments: boolean): number | undefined {
  let quote: string | undefined
  for (let index = 0; index < line.length; index++) {
    const char = line[index]
    if (quote) {
      if (char === "\\") index++
      else if (char === quote) quote = undefined
      continue
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char
      continue
    }
    if (line.startsWith("//", index) || line.startsWith("/*", index) || line.startsWith("<!--", index)) return index
    if (hashComments && char === "#" && (index === 0 || /\s/.test(line[index - 1] ?? ""))) return index
  }
  const trimmed = line.trim()
  if (trimmed.startsWith("*") || (hashComments && trimmed.startsWith("#")) || trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("<!--")) return 0
  return undefined
}

export function evaluate(input: GateInput): Finding[] {
  const findings: Finding[] = []
  const body = replyBody(input.reply)

  if (input.strictOutput) {
    const violation = OutputFormat.check(input.reply)
    if (violation)
      findings.push({
        id: "O1-output-header",
        message: violation.message,
        span: violation.span,
      })
  }

  for (const word of BANNED_WORDS) {
    const pattern = new RegExp(`(?<![\\w-])${word}(?![\\w-])`, "i")
    const match = pattern.exec(body)
    if (!match) continue
    const lineStart = body.lastIndexOf("\n", match.index) + 1
    const lineEnd = body.indexOf("\n", match.index)
    const line = body.slice(lineStart, lineEnd === -1 ? undefined : lineEnd).trim()
    if (line.startsWith(">")) continue
    findings.push({
      id: "E1-banned-word",
      message: `banned word "${match[0]}" in the reply`,
      span: match[0],
    })
  }

  for (const pattern of CHEER_PATTERNS) {
    const match = pattern.exec(body)
    pattern.lastIndex = 0
    if (!match) continue
    findings.push({
      id: "E1-banned-word",
      message: `self-cheer opener "${match[0].trim()}" in the reply`,
      span: match[0].trim(),
    })
  }

  for (const sentence of sentences(body)) {
    if (sentence.split(/\s+/).length <= WORD_LIMIT) continue
    findings.push({
      id: "E2-long-sentence",
      message: `reply has a sentence over ${WORD_LIMIT} words`,
      span: sentence.slice(0, 80),
    })
    break
  }

  if (input.openTodos.length > 0)
    findings.push({
      id: "C6-open-todos",
      message: `${input.openTodos.length} todo item(s) still open: ${input.openTodos.slice(0, 5).join(" | ")}`,
    })

  const changed = changedPaths(input.entries)
  const codeChanged = input.validationSurfaces
    ? input.validationSurfaces.includes("code") || input.validationSurfaces.includes("test")
    : changed.some((path) => /\.(ts|tsx|js|jsx|mjs|py|rs|go|java|kt|swift|c|cpp|h)$/.test(path))

  if (input.comprehension)
    for (const finding of ComprehensionGate.findings(input.comprehension))
      findings.push({ id: finding.id, message: finding.message, span: finding.field })

  const addedLines = [...(input.added ?? new Map<string, readonly string[]>()).values()].reduce(
    (total, lines) => total + lines.length,
    0,
  )
  const reviewCost = input.reviewCost ?? ReviewCostGate.fromDiff({ changedPaths: changed, addedLines })
  for (const finding of ReviewCostGate.findings(reviewCost))
    findings.push({ id: finding.id, message: finding.message, ...(finding.span ? { span: finding.span } : {}) })

  if (codeChanged && input.tier !== "quick") {
    const tests = lastOutcome(input.entries, "test")
    if (tests !== "passed")
      findings.push({
        id: "C4-tests-not-green",
        message: tests === "failed" ? "the test run this turn failed" : "no passing test run found this turn",
      })
  }

  const tsChanged = changed.some((path) => /\.(ts|tsx)$/.test(path))
  if (tsChanged) {
    const typecheck = lastOutcome(input.entries, "typecheck")
    if (typecheck === "failed")
      findings.push({ id: "C3-typecheck-failed", message: "the typecheck run this turn failed" })
  }

  if (/tests?\s+(all\s+)?pass/i.test(body) && lastOutcome(input.entries, "test") !== "passed")
    findings.push({ id: "C5-claim-without-run", message: 'the reply claims tests pass but no passing run is recorded' })

  if (
    codeChanged &&
    lastOutcome(input.entries, "test") !== "passed" &&
    /\b(?:this fixes|fixed it|that (?:did|does) it|should (?:now )?(?:work|pass|be fixed)|problem solved)\b/i.test(body)
  )
    findings.push({
      id: "C18-unverified-fix-claim",
      message: "the reply claims the problem is fixed but no passing test run is recorded this turn; run the check and report its result, or soften the claim",
    })

  ;(input.plan ?? []).forEach((step, index) => {
    const kind: CheckKind | undefined = matchExpect(step.expect)
    if (!kind) {
      if (input.strictPlanChecks && PLAN_CHECK_LANGUAGE.test(step.expect))
        findings.push({
          id: "C29-plan-check-unknown",
          message: `plan step ${index + 1} expects "${step.expect}" but names no supported check; name the exact check before finishing`,
          span: step.expect,
        })
      return
    }
    if (lastOutcome(input.entries, kind) === "passed") return
    findings.push({
      id: "C9-plan-obligation",
      message: `plan step ${index + 1} expects "${step.expect}" but no passing ${kind} run is recorded`,
      span: step.do,
    })
  })

  findings.push(...executionPlanFindings(input.executionPlan))

  for (const [path, lines] of input.added ?? []) {
    for (const line of lines) {
      const marker = /\b(TODO|FIXME|HACK|XXX|stub|placeholder|not implemented)\b/i.exec(line)
      if (marker) {
        findings.push({ id: "C1-todo-marker", message: `added line in ${path} contains "${marker[0]}"`, span: line.trim().slice(0, 80) })
        break
      }
    }
    if (path.endsWith(".ts") || path.endsWith(".tsx") || path.endsWith(".js") || path.endsWith(".jsx") || path.endsWith(".mjs")) {
      for (const line of lines) {
        if (/:\s*any\b/.test(line)) {
          findings.push({ id: "C10-explicit-any", message: `added line in ${path} uses explicit any`, span: line.trim().slice(0, 80) })
          break
        }
      }
      for (const line of lines) {
        if (/\bconsole\.(log|debug)\(/.test(line)) {
          findings.push({ id: "C11-console-left", message: `added line in ${path} leaves a console log`, span: line.trim().slice(0, 80) })
          break
        }
      }
      for (const line of lines) {
        if (/\bdebugger\b/.test(line)) {
          findings.push({ id: "C13-debugger", message: `added line in ${path} leaves a debugger statement`, span: line.trim().slice(0, 80) })
          break
        }
      }
      for (const line of lines) {
        if (/\.catch\s*\(\s*(?:\(\s*[\w,\s]*\)\s*=>\s*(?:\{\s*\}|undefined|null)|function\s*\([^)]*\)\s*\{\s*\})\s*\)/.test(line)) {
          findings.push({
            id: "C15-swallowed-promise",
            message: `added line in ${path} swallows a promise failure silently`,
            span: line.trim().slice(0, 80),
          })
          break
        }
      }
      const secretLiteral =
        /\b(?:password|passwd|secret|api[_-]?key|apikey|access[_-]?token|auth[_-]?token|private[_-]?key)["']?\s*[:=]\s*["'][^"']{8,}["']/i
      for (const line of lines) {
        if (secretLiteral.test(line) && !/\b(?:process\.env|import\.meta\.env|os\.environ|getenv|Deno\.env|Bun\.env)/.test(line)) {
          findings.push({
            id: "C16-hardcoded-secret",
            message: `added line in ${path} assigns a hardcoded credential literal; read it from configuration instead`,
            span: line.trim().slice(0, 80),
          })
          break
        }
      }
      for (const line of lines) {
        if (/catch\s*(\([^)]*\))?\s*\{\s*\}/.test(line)) {
          findings.push({ id: "C12-empty-catch", message: `added line in ${path} has an empty catch`, span: line.trim().slice(0, 80) })
          break
        }
      }
    }
    findings.push(...lineFindings(path, lines))
    const artifact = SlopSignalScanner.scan({ path, content: lines.join("\n") })
    for (const signal of artifact.signals.filter((item) => item.severity === "block").slice(0, 3))
      findings.push({
        id: "R1-review-finding",
        message: `${path}: ${signal.id}: ${signal.evidence}`,
        span: signal.evidence.slice(0, SPAN_EXCERPT),
      })
    if (input.domainChecks && /\.(html?|css)$/i.test(path)) {
      for (const finding of scanArtifact(lines.join("\n")).slice(0, 3))
        findings.push({
          id: "E4-artifact-slop",
          message: `${path}: ${finding.rule} (${finding.severity}): "${finding.evidence}"`,
          span: finding.evidence,
        })
      for (const web of webFindings(lines.join("\n")))
        findings.push({ id: web.id, message: `${path}: ${web.message}`, span: web.span })
      const joined = lines.join("\n")
      const sections = (joined.match(/<section\b/g) ?? []).length
      if (sections >= 4)
        findings.push({
          id: "E5-god-object-html",
          message: `${path} holds ${sections} sections in one file; split nav, footer, and section bodies into owned partial files or custom elements and keep the entry a shell`,
          span: `${sections} <section> blocks`,
        })
      const classCounts = new Map<string, number>()
      for (const line of lines)
        for (const match of line.matchAll(/class="([^"]{20,})"/g))
          classCounts.set(match[1], (classCounts.get(match[1]) ?? 0) + 1)
      for (const [value, count] of classCounts)
        if (count >= 4) {
          findings.push({
            id: "E6-duplicated-markup",
            message: `${path} repeats class="${value}" ${count} times; extract the block into a component or partial instead of copy-pasting markup`,
            span: value.slice(0, 60),
          })
          break
        }
    }
  }

  let commentHits = 0
  for (const [commentPath, commentLines] of input.added ?? []) {
    if (commentHits >= 3) break
    for (const span of commentSpans(commentLines.join("\n"), /\.(?:py|sh|bash|zsh)$/i.test(commentPath))) {
      commentHits++
      findings.push({
        id: "C14-added-comment",
        message: `comment added in ${commentPath}: code should read without it`,
        span,
      })
      if (commentHits >= 3) break
    }
  }

  const turnEntries = input.entries
  const created = new Set<string>()
  const edited = new Set<string>()
  for (const entry of turnEntries) {
    if (entry.kind === "write") created.add(entry.path)
    if (entry.kind === "edit") edited.add(entry.path)
  }
  for (const path of edited) {
    if (created.has(path)) continue
    const firstEdit = turnEntries.findIndex((entry) => entry.kind === "edit" && entry.path === path)
    const readBefore = turnEntries.slice(0, firstEdit).some((entry) => entry.kind === "read" && entry.path === path)
    const priorCleanRead = input.priorReadPaths?.includes(path) ?? false
    if (!readBefore && !priorCleanRead)
      findings.push({
        id: "C7-edit-before-read",
        message: `edited ${path} without reading it first`,
        span: path,
      })
  }

  findings.push(...crossFileDuplication(input.added))
  if (input.domainChecks) {
    findings.push(...missingLocalAssets(input.added))
    findings.push(...mediaNotLocalized(input.added))
  }
  findings.push(...dependencyFindings(input.added, input.manifest))
  if (input.domainChecks) findings.push(...designFidelity(input.design, input.added))
  const codeInChat = codeInChatFinding(body, input.entries)
  if (codeInChat) findings.push(codeInChat)
  findings.push(...referenceFindings(body, input.sources ?? sourcePaths(input.entries)))
  findings.push(...arithmeticFindings(body))
  findings.push(...reversalFindings(body))
  const importCycle = importCycleFinding(input.added)
  if (importCycle) findings.push(importCycle)
  const styleIds = new Set<string>(STYLE_RULES)
  const styleHits = scanText(body).filter((finding) => styleIds.has(finding.rule)).slice(0, 3)
  for (const hit of styleHits)
    findings.push({ id: hit.rule, message: `${hit.evidence}: ${hit.fix}`, span: hit.evidence.slice(0, 80) })
  findings.push(...unsupportedQualityClaims(replyBody(input.reply), changedPaths(input.entries).length))
  if (input.userPrompt) {
    const reduction = scopeReductionFinding(input.reply, input.userPrompt)
    if (reduction) findings.push(reduction)
  }
  const buildSystem = BuildGuard.detectBuildSystemByPaths(changedPaths(input.entries))
  if (buildSystem && (!input.validationSurfaces || input.validationSurfaces.some((surface) => ["code", "test", "build", "config", "dependency"].includes(surface))))
    findings.push({
      id: "C19-buildsystem-touched",
      message: `changed files belong to a ${buildSystem} build tree; ask the user before running any build or build-backed test, and confirm whether building is part of verification`,
    })
  return findings
}

export function directive(findings: readonly Finding[], advisory?: readonly Finding[]): string | undefined {
  if (findings.length === 0 && (!advisory || advisory.length === 0)) return undefined
  const lines: string[] = []
  if (findings.length > 0) {
    lines.push("=== OCX EXIT GATE ===", "Fix these before you finish:")
    for (const finding of findings)
      lines.push(`- ${finding.id}: ${finding.message}${finding.span ? ` [\"${finding.span}\"]` : ""}`)
    lines.push("=== END OCX EXIT GATE ===")
  }
  if (advisory && advisory.length > 0) {
    lines.push("=== OCX OUTPUT ADVISORY ===", "Candidates flagged for review. Verify and fix or justify:")
    for (const item of advisory)
      lines.push(`- ${item.id}: ${item.message}${item.span ? ` [\"${item.span}\"]` : ""}`)
    lines.push("=== END OCX OUTPUT ADVISORY ===")
  }
  return lines.length > 0 ? lines.join("\n") : undefined
}

export function detectorCandidates(reply: string): Finding[] {
  const body = replyBody(reply)
  return scanText(body).map((candidate) => ({
    id: `A-${candidate.rule}`,
    message: candidate.fix,
    span: candidate.evidence,
  }))
}

export function antiSlopAdvisories(added?: ReadonlyMap<string, readonly string[]>): Finding[] {
  if (!added || added.size === 0) return []
  return AntiSlopRuntime.scanChangedFiles({
    files: [...added.entries()].map(([path, lines]) => ({ path, content: lines.join("\n") })),
  }).map((item) => ({ id: item.id, message: item.message, ...(item.span ? { span: item.span } : {}) }))
}

function normalizeSpan(span: string | undefined): string {
  return (span ?? "").replaceAll(/[\\"'`.,]/g, "").replace(/\s+/g, " ").trim().toLowerCase()
}

export function sameSpan(left: string | undefined, right: string | undefined): boolean {
  const a = normalizeSpan(left)
  const b = normalizeSpan(right)
  return a.length > 0 && a === b
}

export function crossDetectorFindings(
  advisory: readonly Finding[],
  tier: GateTier,
): { findings: Finding[]; advisory: Finding[] } {
  const bySpan = new Map<string, Set<string>>()
  for (const item of advisory) {
    const span = normalizeSpan(item.span)
    if (!span) continue
    const rules = bySpan.get(span) ?? new Set<string>()
    rules.add(item.id)
    bySpan.set(span, rules)
  }
  const findings: Finding[] = []
  const remaining: Finding[] = []
  for (const item of advisory) {
    const span = normalizeSpan(item.span)
    const rules = bySpan.get(span)
    if (tier === "full" && rules && rules.size >= 2) {
      findings.push({ id: "C8-cross-detected", message: `multiple detectors flagged this span: ${item.message}`, span: item.span })
      continue
    }
    remaining.push(item)
  }
  return { findings, advisory: remaining }
}

export * as ExitGate from "./exit-gate"

// ── Async SDK-based scanning ─────────────────────────────────────────────────

export function detectorCandidatesAsync(reply: string): Effect.Effect<Finding[], never> {
  const body = replyBody(reply)
  return scanTextAsync(body).pipe(
    Effect.map((candidates) =>
      candidates.map((candidate) => ({
        id: `A-${candidate.rule}`,
        message: candidate.fix,
        span: candidate.evidence,
      }))
    ),
  )
}
