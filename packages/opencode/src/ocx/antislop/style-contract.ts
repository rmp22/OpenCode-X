import { Schema } from "effect"
import { STYLE_CATEGORIES, STYLE_SEVERITIES } from "./style-policy"

export const StyleCategorySchema = Schema.Literals(STYLE_CATEGORIES)
export const StyleSeveritySchema = Schema.Literals(STYLE_SEVERITIES)

export const StyleViolationSchema = Schema.Struct({
  id: Schema.String,
  category: StyleCategorySchema,
  severity: StyleSeveritySchema,
  span: Schema.String,
  reason: Schema.String,
  replacement_hint: Schema.String,
})

export type StyleViolation = Schema.Schema.Type<typeof StyleViolationSchema>

export const ReviewResultSchema = Schema.Struct({
  pass: Schema.Boolean,
  violations: Schema.Array(StyleViolationSchema),
})

export type ReviewResult = Schema.Schema.Type<typeof ReviewResultSchema>

export const RewriteEditSchema = Schema.Struct({
  violation_id: Schema.String,
  old_text: Schema.String,
  new_text: Schema.String,
})

export type RewriteEdit = Schema.Schema.Type<typeof RewriteEditSchema>

export const RewriteResultSchema = Schema.Struct({
  edits: Schema.Array(RewriteEditSchema),
})

export type RewriteResult = Schema.Schema.Type<typeof RewriteResultSchema>

const REVIEW_KEYS = new Set(["pass", "violations"])
const VIOLATION_KEYS = new Set(["id", "category", "severity", "span", "reason", "replacement_hint"])
const REWRITE_KEYS = new Set(["edits"])
const EDIT_KEYS = new Set(["violation_id", "old_text", "new_text"])

export function decodeReviewResult(value: unknown): ReviewResult | undefined {
  if (!hasOnlyKeys(value, REVIEW_KEYS)) return undefined
  const violations = value.violations
  if (!Array.isArray(violations) || violations.some((item) => !hasOnlyKeys(item, VIOLATION_KEYS))) return undefined
  return decode(ReviewResultSchema, value)
}

export function decodeRewriteResult(value: unknown): RewriteResult | undefined {
  if (!hasOnlyKeys(value, REWRITE_KEYS)) return undefined
  const edits = value.edits
  if (!Array.isArray(edits) || edits.some((item) => !hasOnlyKeys(item, EDIT_KEYS))) return undefined
  return decode(RewriteResultSchema, value)
}

export function parseReviewResult(raw: string): ReviewResult | undefined {
  const value = parseObject(raw)
  return value === undefined ? undefined : decodeReviewResult(value)
}

export function parseRewriteResult(raw: string): RewriteResult | undefined {
  const value = parseObject(raw)
  return value === undefined ? undefined : decodeRewriteResult(value)
}

function parseObject(raw: string): unknown {
  const trimmed = raw.trim()
  const start = trimmed.indexOf("{")
  const end = trimmed.lastIndexOf("}")
  if (start === -1 || end <= start) return undefined
  try {
    return Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown))(trimmed.slice(start, end + 1))
  } catch {
    return undefined
  }
}

function decode<T>(schema: Schema.Schema<T>, value: unknown): T | undefined {
  try {
    return Schema.decodeUnknownSync(schema as unknown as Schema.Decoder<T>)(value)
  } catch {
    return undefined
  }
}

function hasOnlyKeys(value: unknown, allowed: ReadonlySet<string>): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  return Object.keys(value).every((key) => allowed.has(key))
}

export * as StyleContract from "./style-contract"
