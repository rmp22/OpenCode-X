import { OutputFormat } from "../output-format"
import { parseReviewResult, parseRewriteResult } from "./style-contract"
import { SpanProtector, type ProtectedSpan } from "./span-protector"

export type HardCheckContext = {
  readonly draft?: string
  readonly strictOutput?: boolean
  readonly added?: ReadonlyMap<string, readonly string[]>
  readonly commentsRequested?: boolean
  readonly protectedBefore?: string
  readonly protectedAfter?: string
  readonly protectedSpans?: readonly ProtectedSpan[]
  readonly requiredAnnotations?: readonly string[]
  readonly reviewJson?: string
  readonly rewriteJson?: string
}

export type HardViolation = {
  readonly ruleId: string
  readonly severity: "hard"
  readonly message: string
  readonly evidence?: string
  readonly location?: string
}

export type HardCheckResult = {
  readonly pass: boolean
  readonly violations: readonly HardViolation[]
}

const EXPLANATORY_TAG = /@(?:remarks|note|description|details)\b/i
const DIRECTIVE = /(?:eslint|oxlint|biome|ts-expect-error|ts-ignore|noqa|type:\s*ignore|deno-lint|@hide)\b/i
const LICENSE = /(?:copyright|\(c\)|©|all rights reserved|licensed under|spdx-license-identifier)/i

export function check(context: HardCheckContext): HardCheckResult {
  const violations: HardViolation[] = []
  const add = (violation: HardViolation) => {
    if (
      !violations.some(
        (item) =>
          item.ruleId === violation.ruleId &&
          item.evidence === violation.evidence &&
          item.location === violation.location,
      )
    )
      violations.push(violation)
  }

  if (context.strictOutput && context.draft !== undefined) {
    const output = OutputFormat.check(context.draft)
    if (output)
      add({
        ruleId: "output.header",
        severity: "hard",
        message: output.message,
        evidence: output.span,
      })
  }

  if (!context.commentsRequested)
    for (const [path, lines] of context.added ?? []) {
      for (const [index, line] of lines.entries()) {
        if (!EXPLANATORY_TAG.test(line) || isExempt(line)) continue
        add({
          ruleId: "comments.no_explanatory_doc_tag",
          severity: "hard",
          message: `added explanatory documentation tag in ${path}; remove it unless the user requested comments`,
          evidence: line.trim(),
          location: `${path}:${index + 1}`,
        })
      }
    }

  if (context.protectedBefore !== undefined && context.protectedAfter !== undefined && context.protectedSpans) {
    const protectedResult = SpanProtector.verify(
      context.protectedBefore,
      context.protectedAfter,
      context.protectedSpans,
    )
    for (const changed of protectedResult.changed)
      add({
        ruleId: "protected_text.changed",
        severity: "hard",
        message: `protected span ${changed.id} changed during rewrite`,
        evidence: changed.before,
      })
  }

  for (const annotation of context.requiredAnnotations ?? []) {
    if (!context.protectedBefore?.includes(annotation) || context.protectedAfter?.includes(annotation)) continue
    add({
      ruleId: "required_annotation.removed",
      severity: "hard",
      message: "a required annotation was removed during rewrite",
      evidence: annotation,
    })
  }

  if (context.reviewJson !== undefined && !parseReviewResult(context.reviewJson))
    add({
      ruleId: "review.schema",
      severity: "hard",
      message: "semantic reviewer output does not match the review contract",
    })
  if (context.rewriteJson !== undefined && !parseRewriteResult(context.rewriteJson))
    add({
      ruleId: "rewrite.schema",
      severity: "hard",
      message: "targeted rewriter output does not match the rewrite contract",
    })

  return { pass: violations.length === 0, violations }
}

export function checkHardRules(context: HardCheckContext, draft?: string): HardCheckResult {
  return check({ ...context, ...(draft !== undefined ? { draft } : {}) })
}

function isExempt(line: string): boolean {
  const trimmed = line.trim()
  if (DIRECTIVE.test(trimmed) || LICENSE.test(trimmed)) return true
  if (/^(?:\/\/|\/\*|\*|<!--|#)\s*(?:generated|code generated|do not edit)/i.test(trimmed)) return true
  return false
}

export * as HardRuleChecker from "./hard-rule-checker"
