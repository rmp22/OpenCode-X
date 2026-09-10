export const QUESTION_KEYS = [
  "problem",
  "rootCause",
  "owner",
  "architectureFit",
  "behaviorChange",
  "assumptions",
  "edgeCases",
  "risks",
  "verification",
  "naming",
] as const

export type QuestionKey = (typeof QUESTION_KEYS)[number]

export type ComprehensionAnswers = {
  readonly problem?: string
  readonly rootCause?: string
  readonly owner?: string
  readonly architectureFit?: string
  readonly behaviorChange?: string
  readonly assumptions?: readonly string[]
  readonly edgeCases?: readonly string[]
  readonly risks?: readonly string[]
  readonly verification?: readonly string[]
  readonly naming?: string
}

export type ComprehensionInput = ComprehensionAnswers & {
  readonly required?: readonly QuestionKey[]
}

export type ComprehensionFinding = {
  readonly id: "CG-missing-evidence"
  readonly severity: "blocker"
  readonly field: QuestionKey
  readonly message: string
}

export type ComprehensionResult = {
  readonly complete: boolean
  readonly missing: readonly QuestionKey[]
  readonly findings: readonly ComprehensionFinding[]
}

export function check(input: ComprehensionInput = {}): ComprehensionResult {
  const required = input.required ?? QUESTION_KEYS
  const missing = required.filter((key) => !present(input[key]))
  return {
    complete: missing.length === 0,
    missing,
    findings: missing.map((field) => ({
      id: "CG-missing-evidence",
      severity: "blocker",
      field,
      message: `comprehension evidence is missing for ${field}; explain the change from source and verification evidence before finalizing`,
    })),
  }
}

export function findings(input: ComprehensionInput = {}): readonly ComprehensionFinding[] {
  return check(input).findings
}

export function render(input: ComprehensionInput = {}): string {
  const result = check(input)
  if (result.complete) return "=== OCX COMPREHENSION GATE ===\nAll required change explanations have evidence.\n=== END OCX COMPREHENSION GATE ==="
  return [
    "=== OCX COMPREHENSION GATE ===",
    "Do not finalize until these answers are grounded in source, callers, tests, or project documentation:",
    ...result.missing.map((field) => `- ${field}`),
    "=== END OCX COMPREHENSION GATE ===",
  ].join("\n")
}

function present(value: string | readonly string[] | undefined): boolean {
  if (Array.isArray(value)) return value.some((item) => typeof item === "string" && meaningful(item))
  return typeof value === "string" && meaningful(value)
}

function meaningful(value: string): boolean {
  return value.trim().length > 0 && !/^(?:unknown|unverified|not checked|not run|n\/a)$/i.test(value.trim())
}

export * as ComprehensionGate from "./comprehension"
