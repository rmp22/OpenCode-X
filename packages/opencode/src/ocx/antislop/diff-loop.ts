import { UniversalChecks } from "../static-checks/universal"
import { ScopeAnalyzer } from "../static-analysis/analyzer"
import { FqnGuard } from "../static-analysis/fqn-guard"
import { changedLineSet } from "../static-checks/changed-lines"
import { detectLanguage } from "../static-analysis/types"

export namespace AntiSlopDiffLoop {
  export interface DiffInspectionInput {
    readonly filePath: string
    readonly previousContent?: string
    readonly currentContent: string
    readonly gitDiffSnippet?: string
  }

  export type CheckCategory =
    | "dead_code"
    | "imports_missing"
    | "slop_code"
    | "orphan_leftover"
    | "unoptimized_code"
    | "unnecessary_changes"

  export interface DiffGapCheck {
    readonly category: CheckCategory
    readonly status: "flagged" | "verified_clean"
    readonly title: string
    readonly details: readonly string[]
    readonly actionRequired?: string
  }

  export interface DiffAuditResult {
    readonly hasGaps: boolean
    readonly checks: readonly DiffGapCheck[]
    readonly feedbackPrompt: string
  }

  export function auditDiff(input: DiffInspectionInput): DiffAuditResult {
    const filePath = input.filePath
    const current = input.currentContent
    const previous = input.previousContent
    const language = detectLanguage(filePath)

    const isChangedLine = (line: number) => {
      if (!previous) return true
      const changed = changedLineSet(previous, current)
      return changed.has(line)
    }

    const checks: DiffGapCheck[] = []

    const scopeResult = ScopeAnalyzer.analyze(filePath, current)
    const universalResult = UniversalChecks.audit(filePath, current)
    const fqnDiagnostics = FqnGuard.check(filePath, current)

    const deadFindings = universalResult.findings.filter(
      (f) => f.code === "ERR_DEAD_CODE" && isChangedLine(f.line),
    )
    const unwiredSymbols = scopeResult.diagnostics.filter(
      (d) => (d.code === "ERR_UNWIRED_CODE" || d.code === "ERR_ORPHAN_VARIABLE") && isChangedLine(d.line),
    )

    if (deadFindings.length > 0 || unwiredSymbols.length > 0) {
      const details: string[] = []
      for (const d of deadFindings) {
        details.push(`Line ${d.line}: ${d.message}`)
      }
      for (const u of unwiredSymbols) {
        const callers = u.callerPerimeter && u.callerPerimeter.length > 0
          ? ` (Callers in unit: ${u.callerPerimeter.join(", ")})`
          : " (No callers found in unit)"
        details.push(`Line ${u.line}: ${u.message}${callers}`)
      }
      checks.push({
        category: "dead_code",
        status: "flagged",
        title: "Dead Code - Seek Callers as Verification",
        details,
        actionRequired:
          "Newly added symbols must be wired to callers or deleted. Seek callers in perimeter: if an added function or variable is uncalled, wire it into the call chain or remove it.",
      })
    } else {
      checks.push({
        category: "dead_code",
        status: "verified_clean",
        title: "Dead Code - Seek Callers as Verification",
        details: ["All newly added symbols have active callers or exports; no dead code detected."],
      })
    }

    const missingImports = scopeResult.diagnostics.filter(
      (d) => d.code === "ERR_UNRESOLVED_SYMBOL" && isChangedLine(d.line),
    )
    if (missingImports.length > 0) {
      const details = missingImports.map((m) => `Line ${m.line}: ${m.message}`)
      checks.push({
        category: "imports_missing",
        status: "flagged",
        title: "Imports Missing - Check Dependencies & Build System",
        details,
        actionRequired:
          "Check if code added in the diff has dependencies not added to imports or build system manifests. Add required imports at line 1 and update package dependencies if external.",
      })
    } else {
      checks.push({
        category: "imports_missing",
        status: "verified_clean",
        title: "Imports Missing - Check Dependencies & Build System",
        details: ["All referenced types and symbols are properly imported and declared."],
      })
    }

    const slopFindings = universalResult.findings.filter(
      (f) =>
        (f.code === "ERR_AI_SLOP_COMMENT" || f.code === "ERR_EMPTY_CATCH" || f.code === "ERR_DEBUG_LEFTOVER") &&
        isChangedLine(f.line),
    )
    if (slopFindings.length > 0) {
      const details = slopFindings.map((s) => `Line ${s.line}: ${s.message}`)
      checks.push({
        category: "slop_code",
        status: "flagged",
        title: "Slop Code - AI Slop & Vibe Code Giveaways",
        details,
        actionRequired:
          "Remove AI slop giveaways: comments explaining code, placeholder TODO stubs, silent empty catch blocks, and leftover debug statements. Keep code clean and self-explanatory.",
      })
    } else {
      checks.push({
        category: "slop_code",
        status: "verified_clean",
        title: "Slop Code - AI Slop & Vibe Code Giveaways",
        details: ["No AI slop comments, placeholder stubs, or empty catches detected."],
      })
    }

    const orphanImports = scopeResult.diagnostics.filter(
      (d) => d.code === "ERR_ORPHAN_IMPORT",
    )
    if (orphanImports.length > 0) {
      const details = orphanImports.map((o) => `Line ${o.line}: ${o.message}`)
      checks.push({
        category: "orphan_leftover",
        status: "flagged",
        title: "Orphan/Leftover Codes - Clean Up Removed Code Side Effects",
        details,
        actionRequired:
          "Removing or replacing code left orphaned imports or dangling references behind. Clean them up and check for side effects.",
      })
    } else {
      checks.push({
        category: "orphan_leftover",
        status: "verified_clean",
        title: "Orphan/Leftover Codes - Clean Up Removed Code Side Effects",
        details: ["No orphaned imports or leftover variables detected."],
      })
    }

    const noopFindings = universalResult.findings.filter(
      (f) => f.code === "ERR_NOOP_CODE" && isChangedLine(f.line),
    )
    const fqnErrors = fqnDiagnostics.filter((f) => isChangedLine(f.line))

    const currentLines = current.split("\n")
    const deepNestingLines: number[] = []
    for (let i = 0; i < currentLines.length; i++) {
      if (!isChangedLine(i + 1)) continue
      const line = currentLines[i]
      const indent = line.match(/^\s*/)?.[0]?.length ?? 0
      if (indent >= 16 && line.trim().length > 0) {
        deepNestingLines.push(i + 1)
      }
    }

    if (noopFindings.length > 0 || fqnErrors.length > 0 || deepNestingLines.length > 0) {
      const details: string[] = []
      for (const n of noopFindings) {
        details.push(`Line ${n.line}: ${n.message}`)
      }
      for (const f of fqnErrors) {
        details.push(`Line ${f.line}: ${f.message}`)
      }
      if (deepNestingLines.length > 0) {
        details.push(`Line(s) ${deepNestingLines.slice(0, 3).join(", ")}: Excessive nesting (spaghetti/deep indentation).`)
      }
      checks.push({
        category: "unoptimized_code",
        status: "flagged",
        title: "Unoptimized Code - World's Best Practices & OCX Optimization",
        details,
        actionRequired:
          "Apply world-class best practices: eliminate no-op code and inline FQNs (use simple names with imports/aliases). Slim down code to favor existing abstractions, avoid spaghetti/god objects, and use early returns instead of else.",
      })
    } else {
      checks.push({
        category: "unoptimized_code",
        status: "verified_clean",
        title: "Unoptimized Code - World's Best Practices & OCX Optimization",
        details: ["Code adheres to lean, modular, and optimized architecture standards."],
      })
    }

    if (previous && previous === current) {
      checks.push({
        category: "unnecessary_changes",
        status: "flagged",
        title: "Unnecessary Changes - Prevent Dirty Changes",
        details: ["Mutation resulted in an exact no-op with identical before/after content."],
        actionRequired: "Remove no-op mutations to prevent unnecessary dirty changes.",
      })
    } else {
      checks.push({
        category: "unnecessary_changes",
        status: "verified_clean",
        title: "Unnecessary Changes - Prevent Dirty Changes",
        details: ["All changes are purposeful and targeted to the unit."],
      })
    }

    const flaggedChecks = checks.filter((c) => c.status === "flagged")
    const hasGaps = flaggedChecks.length > 0

    const passSections = checks.map((c, index) => {
      const passNum = index + 1
      const icon = c.status === "verified_clean" ? "✓ PASSED" : "→ FOCUS IN LOOP"
      const header = `PASS ${passNum} [${c.title.toUpperCase()}]: ${icon}`
      const detailLines = c.details.map((d) => `  ${d}`).join("\n")
      const actionLine = c.actionRequired ? `  Prompt for agent: ${c.actionRequired}` : ""
      return [header, detailLines, actionLine].filter(Boolean).join("\n")
    })

    const feedbackPrompt = [
      "=== CONTINUOUS ANTI-SLOP AGENTIC LOOP PASS ===",
      `Target: ${filePath}`,
      "Review the loop pass prompts below one by one to verify your changes and eliminate tunnel vision:",
      "",
      passSections.join("\n\n"),
      "",
      hasGaps
        ? `Loop Summary: ${flaggedChecks.length} pass(es) have active focus items.\nLoop Invariant: Do not stop until all are cleared, else repeat the loop.`
        : "Loop Summary: All 6 loop passes verified clean! Loop complete.",
      "==============================================",
    ].join("\n")

    return {
      hasGaps,
      checks,
      feedbackPrompt,
    }
  }
}
