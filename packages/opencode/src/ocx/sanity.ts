import { FqnGuard } from "./static-analysis/fqn-guard"
import { ScopeAnalyzer } from "./static-analysis/analyzer"
import { changedLineSet } from "./static-checks/changed-lines"
import { UniversalChecks } from "./static-checks/universal"
import { AntiSlopDiffLoop } from "./antislop/diff-loop"

export { AntiSlopDiffLoop }

export type SanityReport = {
  readonly passed: boolean
  readonly notice?: string
  readonly diffAudit?: AntiSlopDiffLoop.DiffAuditResult
}

export interface SanityOptions {
  readonly previousContent?: string
}

const PRAGMA_REGEX =
  /(?:eslint|oxlint|biome|ts-expect-error|ts-ignore|noqa|type:\s*ignore|deno-lint|copyright|licensed under|spdx-license-identifier|generated-file|do not edit|@hide|@param|@returns|@throws|@type)/i

function hasExplanatoryComments(filePath: string, content: string): boolean {
  if (/\.(java|kt|kts|c|h|cpp|cc|cxx|hpp|hh|hxx|m|mm|swift)$/i.test(filePath)) return false
  if (!/\.(ts|tsx|js|jsx|mjs|py|go|rs)$/i.test(filePath)) return false
  const lines = content.split("\n")
  let inLicenseBlock = true
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    if (!trimmed) continue
    if (trimmed.startsWith("#!")) continue
    if (inLicenseBlock && (trimmed.startsWith("/*") || trimmed.startsWith("*") || trimmed.startsWith("//"))) {
      if (/copyright|license|spdx/i.test(trimmed)) continue
    } else {
      inLicenseBlock = false
    }
    if (PRAGMA_REGEX.test(trimmed)) continue
    if (
      trimmed.startsWith("//") ||
      (trimmed.startsWith("/*") && !trimmed.includes("*/")) ||
      (/\.(py|sh|bash)$/i.test(filePath) && trimmed.startsWith("#"))
    ) {
      return true
    }
    if (/(?:[^:"'`]\/\/|#)\s+[a-zA-Z][a-zA-Z\s]{4,}$/.test(trimmed)) {
      return true
    }
  }
  return false
}

export function checkSanity(filePath: string, content: string, options?: SanityOptions): SanityReport {
  const notices: string[] = []
  const changedLines =
    options?.previousContent !== undefined && options.previousContent !== content
      ? changedLineSet(options.previousContent, content)
      : undefined
  const isChangedLine = (line: number): boolean => changedLines === undefined || changedLines.has(line)

  if (/\.json$/i.test(filePath)) {
    try {
      JSON.parse(content)
    } catch (error: any) {
      notices.push(`JSON syntax error: ${error?.message ?? "malformed JSON"}`)
    }
  }

  if (/\.html?$/i.test(filePath)) {
    const lines = content.split("\n")
    const deadLines: number[] = []
    for (const [index, line] of lines.entries()) {
      if (/<a\b[^>]*\bhref\s*=\s*["']#["'][^>]*>/i.test(line)) deadLines.push(index + 1)
    }
    if (deadLines.length > 0) {
      const hasLinkHandlers =
        /querySelectorAll\s*\(\s*['"][^'"]*href=['"]?#|addEventListener\s*\(\s*['"]click['"]/i.test(content) ||
        /<a\b[^>]*\bonclick\s*=/i.test(content)
      if (!hasLinkHandlers) {
        const preview = deadLines.slice(0, 5).join(", ")
        const suffix = deadLines.length > 5 ? ` and ${deadLines.length - 5} more` : ""
        notices.push(
          `Detected ${deadLines.length} unhandled placeholder link(s) (<a href="#">) at line(s) ${preview}${suffix}. Fix all ${deadLines.length} in one batch edit: if the destination exists on this page, point to its anchor id (e.g. href="#gallery"); if the destination is an unbuilt secondary page (e.g. Privacy, Terms, Support, Press), replace <a href="#"> with a <span> or disabled element with an honest unavailable indicator. NEVER point unrelated legal or support links to random sections like #cta.`,
        )
      }
    }

    const misdirectedMatches: string[] = []
    for (const [index, line] of lines.entries()) {
      const match = /<a\b[^>]*\bhref\s*=\s*["']#(?:cta|hero|features|gallery|about|specs)["'][^>]*>([^<]+)<\/a>/i.exec(line)
      if (match) {
        const linkText = match[1]!.trim()
        if (/^(?:privacy|terms|support|press|legal|cookies|help|status|careers)$/i.test(linkText)) {
          misdirectedMatches.push(`"${linkText}" -> ${line.trim()} (line ${index + 1})`)
        }
      }
    }
    if (misdirectedMatches.length > 0) {
      notices.push(
        `Detected ${misdirectedMatches.length} misdirected navigation link(s): ${misdirectedMatches.slice(0, 3).join(", ")}. Do not wire unrelated legal/support links to #cta or #hero. Render them as non-link <span> or disabled buttons.`,
      )
    }

    if (/<script\b[^>]*>(?:(?!<\/script>)[\s\S])*$/i.test(content)) {
      notices.push("Unclosed <script> tag detected.")
    }
    if (/<style\b[^>]*>(?:(?!<\/style>)[\s\S])*$/i.test(content)) {
      notices.push("Unclosed <style> tag detected.")
    }
  }

  if (hasExplanatoryComments(filePath, content)) {
    notices.push(
      "Detected explanatory code comments. OCX code standard requires code to be self-explanatory without added comments unless the user explicitly requested them.",
    )
  }

  const fqnErrors = FqnGuard.check(filePath, content).filter((e) => isChangedLine(e.line))
  if (fqnErrors.length > 0) {
    const shown = fqnErrors.slice(0, 8)
    const errorSummaries = shown.map((e) => `Line ${e.line}: ${e.message}`).join("\n")
    const hidden = fqnErrors.length > shown.length ? `\n... and ${fqnErrors.length - shown.length} more` : ""
    notices.push(
      `Detected inline fully qualified name(s) (FQNs) in violation of OCX standards:\n${errorSummaries}${hidden}\nAdd the import at the top of the file and use the simple name instead. If resolving a collision, use an import alias if supported (e.g. in Kotlin); inline FQNs are only permitted in Java when ambiguous naming collisions cannot be aliased.`,
    )
  }

  const universalFindings = UniversalChecks.audit(filePath, content).findings.filter((f) => isChangedLine(f.line))

  const deadCodeFindings = universalFindings.filter((f) => f.code === "ERR_DEAD_CODE")
  if (deadCodeFindings.length > 0) {
    const summaries = deadCodeFindings.slice(0, 5).map((f) => `Line ${f.line}: ${f.message}`).join("\n")
    notices.push(`[Anti-Tunnel Vision] Dead/unreachable code detected on newly modified line(s):\n${summaries}\nAction required: Either wire before the terminating return/throw/break or remove it.`)
  }

  const noopFindings = universalFindings.filter((f) => f.code === "ERR_NOOP_CODE")
  if (noopFindings.length > 0) {
    const summaries = noopFindings.slice(0, 5).map((f) => `Line ${f.line}: ${f.message}`).join("\n")
    notices.push(`[Anti-Tunnel Vision] No-op code / empty block detected on newly modified line(s):\n${summaries}\nAction required: Wire with actual computed logic or delete the no-op statement.`)
  }

  const emptyCatchFindings = universalFindings.filter((f) => f.code === "ERR_EMPTY_CATCH")
  if (emptyCatchFindings.length > 0) {
    const summaries = emptyCatchFindings.slice(0, 5).map((f) => `Line ${f.line}: ${f.message}`).join("\n")
    notices.push(`[Error Handling Integrity] Empty catch/except block silently swallows errors:\n${summaries}`)
  }

  const warnings: string[] = []
  const debugFindings = universalFindings.filter((f) => f.code === "ERR_DEBUG_LEFTOVER")
  if (debugFindings.length > 0) {
    const summaries = debugFindings.slice(0, 5).map((f) => `Line ${f.line}: ${f.message}`).join("\n")
    warnings.push(`[Code Cleanliness] Leftover debug statement(s) detected:\n${summaries}`)
  }

  const slopFindings = universalFindings.filter((f) => f.code === "ERR_AI_SLOP_COMMENT")
  if (slopFindings.length > 0) {
    const summaries = slopFindings.slice(0, 5).map((f) => `Line ${f.line}: ${f.message}`).join("\n")
    notices.push(`[Anti-Slop Standard] Explanatory comment(s) or placeholder stub(s) detected:\n${summaries}`)
  }

  const scopeResult = ScopeAnalyzer.analyze(filePath, content)
  const unresolvedSymbols = scopeResult.diagnostics.filter(
    (d) => d.code === "ERR_UNRESOLVED_SYMBOL" && isChangedLine(d.line),
  )
  if (unresolvedSymbols.length > 0) {
    const errorSummaries = unresolvedSymbols.slice(0, 5).map((e) => `Line ${e.line}: ${e.message}`).join("\n")
    notices.push(
      `Detected unresolved symbol(s) / missing import(s) (Anti-Tunnel Guard):\n${errorSummaries}\nYou referenced type(s) that are not imported or declared in this compilation unit. Add the proper import statement at the top of the file to maintain compilation integrity.`,
    )
  }

  const unwiredSymbols = scopeResult.diagnostics.filter(
    (d) => (d.code === "ERR_UNWIRED_CODE" || d.code === "ERR_ORPHAN_VARIABLE") && isChangedLine(d.line),
  )
  if (unwiredSymbols.length > 0) {
    const summaries = unwiredSymbols.slice(0, 5).map((d) => {
      const perimeter = d.callerPerimeter && d.callerPerimeter.length > 0 ? ` [Perimeter Callers: ${d.callerPerimeter.join(", ")}]` : ""
      return `Line ${d.line}: ${d.message}${perimeter} -> ${d.suggestedFix?.replacementText ?? "Wire to caller or delete"}`
    }).join("\n")
    notices.push(
      `[Anti-Tunnel Vision] Unwired or orphan code detected on modified line(s):\n${summaries}\nAction required: You introduced symbols disconnected from the caller perimeter. Either wire them properly into callers or delete them.`,
    )
  }

  const diffAudit = AntiSlopDiffLoop.auditDiff({
    filePath,
    previousContent: options?.previousContent,
    currentContent: content,
  })

  const allMessages = [...notices, ...warnings]
  if (diffAudit.hasGaps) {
    allMessages.push(diffAudit.feedbackPrompt)
  }

  return {
    passed: notices.length === 0,
    notice: allMessages.length > 0 ? allMessages.join("\n\n") : undefined,
    diffAudit,
  }
}

export * as SanityChecker from "./sanity"
