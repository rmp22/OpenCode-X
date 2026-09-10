import { SpanProtector, overlaps, type ProtectedSpan } from "./span-protector"
import type { RewriteEdit, StyleViolation } from "./style-contract"

export type TargetedRewriteInput = {
  readonly draft: string
  readonly edits: readonly RewriteEdit[]
  readonly violations: readonly StyleViolation[]
  readonly protectedSpans: readonly ProtectedSpan[]
}

export type AppliedEdit = RewriteEdit & {
  readonly start: number
  readonly end: number
}

export type AppliedRewrite = {
  readonly pass: boolean
  readonly applied: boolean
  readonly text: string
  readonly edits: readonly AppliedEdit[]
  readonly errors: readonly string[]
}

export function apply(input: TargetedRewriteInput): AppliedRewrite {
  const errors: string[] = []
  const violations = new Map(input.violations.map((violation) => [violation.id, violation]))
  const applied: AppliedEdit[] = []

  for (const edit of input.edits) {
    const violation = violations.get(edit.violation_id)
    if (!violation) {
      errors.push(`edit references unknown violation ${edit.violation_id}`)
      continue
    }
    if (edit.old_text.length === 0) {
      errors.push(`edit ${edit.violation_id} has empty old_text`)
      continue
    }
    const locations = locationsOf(input.draft, edit.old_text).filter(
      (location) => !input.protectedSpans.some((span) => overlaps(span, location.start, location.end)),
    )
    const violationLocations = violation.span ? locationsOf(input.draft, violation.span) : []
    const narrowed = locations.filter((location) => {
      if (!violation.span) return true
      return violationLocations.some((span) => location.start >= span.start && location.end <= span.end)
    })
    if (violation.span && violationLocations.length === 0) {
      errors.push(`violation span for ${edit.violation_id} is missing`)
      continue
    }
    const allowed = violation.span ? narrowed : locations
    if (allowed.length === 0) {
      errors.push(`old_text for ${edit.violation_id} is missing or protected`)
      continue
    }
    if (allowed.length > 1) {
      errors.push(`old_text for ${edit.violation_id} is ambiguous`)
      continue
    }
    const location = allowed[0]!
    applied.push({ ...edit, start: location.start, end: location.end })
  }

  const ordered = [...applied].sort((a, b) => a.start - b.start || a.end - b.end)
  for (let index = 1; index < ordered.length; index++) {
    const prior = ordered[index - 1]!
    const current = ordered[index]!
    if (current.start < prior.end) errors.push(`edits ${prior.violation_id} and ${current.violation_id} overlap`)
  }
  if (errors.length > 0) return { pass: false, applied: false, text: input.draft, edits: [], errors }

  const text = [...ordered]
    .sort((a, b) => b.start - a.start)
    .reduce((result, edit) => result.slice(0, edit.start) + edit.new_text + result.slice(edit.end), input.draft)
  const protectedResult = SpanProtector.verify(input.draft, text, input.protectedSpans)
  if (!protectedResult.pass)
    return {
      pass: false,
      applied: false,
      text: input.draft,
      edits: [],
      errors: protectedResult.changed.map((change) => `protected span ${change.id} changed`),
    }
  return { pass: true, applied: ordered.length > 0, text, edits: ordered, errors: [] }
}

function locationsOf(text: string, value: string): { start: number; end: number }[] {
  const locations: { start: number; end: number }[] = []
  let offset = 0
  while (offset < text.length) {
    const start = text.indexOf(value, offset)
    if (start === -1) break
    locations.push({ start, end: start + value.length })
    offset = start + value.length
  }
  return locations
}

export * as TargetedRewriter from "./targeted-rewriter"

export const applyEdits = apply
