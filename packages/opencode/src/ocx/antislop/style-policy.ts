export const STYLE_CATEGORIES = [
  "plain_language",
  "directness",
  "needless_abstraction",
  "filler",
  "repetition",
  "technical_explanation",
  "naming",
  "explanatory_comment",
  "protected_text",
  "output_contract",
] as const

export type StyleCategory = (typeof STYLE_CATEGORIES)[number]

export const STYLE_SEVERITIES = ["hard", "soft"] as const
export type StyleSeverity = (typeof STYLE_SEVERITIES)[number]

export const STYLE_SURFACES = ["prose", "code_diff", "plan", "structured"] as const
export type StyleSurface = (typeof STYLE_SURFACES)[number]

export const STYLE_GATE_MODES = ["off", "shadow", "rewrite_prose", "enforce"] as const
export type StyleGateMode = (typeof STYLE_GATE_MODES)[number]

export type StyleRule = {
  readonly id: string
  readonly category: StyleCategory
  readonly severity: StyleSeverity
  readonly appliesTo: readonly StyleSurface[]
  readonly description: string
}

export type StylePolicy = {
  readonly version: number
  readonly rules: readonly StyleRule[]
  readonly protectedReasons: readonly string[]
}

export type StylePolicyInput = {
  readonly version?: number
  readonly rules?: readonly StyleRule[]
  readonly protectedReasons?: readonly string[]
}

export const STYLE_POLICY_VERSION = 1
export const STYLE_REVIEW_PROMPT_VERSION = 1
export const STYLE_REWRITE_PROMPT_VERSION = 1
export const STYLE_SCHEMA_VERSION = 1

export const DEFAULT_STYLE_POLICY: StylePolicy = {
  version: STYLE_POLICY_VERSION,
  rules: [
    {
      id: "plain_language.first_read",
      category: "plain_language",
      severity: "soft",
      appliesTo: ["prose", "plan"],
      description: "Use clear, direct wording that a reader can understand on the first reading.",
    },
    {
      id: "directness.answer_first",
      category: "directness",
      severity: "soft",
      appliesTo: ["prose", "plan"],
      description: "Put the answer, action, or important fact first.",
    },
    {
      id: "plain_language.concrete_words",
      category: "plain_language",
      severity: "soft",
      appliesTo: ["prose", "plan"],
      description: "Prefer familiar concrete words without weakening correct technical terms.",
    },
    {
      id: "filler.remove",
      category: "filler",
      severity: "soft",
      appliesTo: ["prose", "plan"],
      description: "Remove filler, praise, service narration, and words that add no meaning.",
    },
    {
      id: "repetition.remove",
      category: "repetition",
      severity: "soft",
      appliesTo: ["prose", "plan"],
      description: "State each fact once unless repeating it helps the reader act.",
    },
    {
      id: "needless_abstraction.avoid",
      category: "needless_abstraction",
      severity: "soft",
      appliesTo: ["prose", "code_diff", "plan"],
      description: "Prefer a known action, state, value, method, or file over a vague abstraction.",
    },
    {
      id: "technical_explanation.cause",
      category: "technical_explanation",
      severity: "soft",
      appliesTo: ["prose", "plan"],
      description: "When useful, explain what happens, why it happens, and what must change.",
    },
    {
      id: "naming.local_context",
      category: "naming",
      severity: "soft",
      appliesTo: ["code_diff"],
      description: "Review only names introduced or changed by the current task against nearby code.",
    },
    {
      id: "explanatory_comment.requested",
      category: "explanatory_comment",
      severity: "soft",
      appliesTo: ["code_diff"],
      description: "Flag explanatory comments added without a user request, except required metadata and directives.",
    },
    {
      id: "protected_text.exact",
      category: "protected_text",
      severity: "hard",
      appliesTo: ["prose", "code_diff", "plan", "structured"],
      description: "Keep protected paths, commands, IDs, markers, literals, quotes, evidence, and references exact.",
    },
    {
      id: "output_contract.valid",
      category: "output_contract",
      severity: "hard",
      appliesTo: ["prose", "structured"],
      description: "Keep required output markers and structured responses valid.",
    },
  ],
  protectedReasons: [
    "code",
    "path",
    "file_line",
    "command",
    "id",
    "marker",
    "literal",
    "quote",
    "evidence",
    "explicit",
  ],
}

export function createStylePolicy(input: StylePolicyInput = {}): StylePolicy {
  return {
    version: input.version ?? DEFAULT_STYLE_POLICY.version,
    rules: input.rules ? [...input.rules] : DEFAULT_STYLE_POLICY.rules,
    protectedReasons: input.protectedReasons ? [...input.protectedReasons] : DEFAULT_STYLE_POLICY.protectedReasons,
  }
}

export function parseStyleGateMode(value: unknown): StyleGateMode {
  if (typeof value !== "string") return "off"
  const mode = value.trim()
  return (STYLE_GATE_MODES as readonly string[]).includes(mode) ? (mode as StyleGateMode) : "off"
}

export function renderStylePolicy(policy: StylePolicy = DEFAULT_STYLE_POLICY): string {
  const lines = [
    `policy_version: ${policy.version}`,
    ...STYLE_CATEGORIES.flatMap((category) => {
      const rules = policy.rules.filter((rule) => rule.category === category)
      return rules.length === 0
        ? []
        : [
            `${category}:`,
            ...rules.map(
              (rule) => `- ${rule.id} [${rule.severity}] (${rule.appliesTo.join(", ")}): ${rule.description}`,
            ),
          ]
    }),
    `protected_reasons: ${policy.protectedReasons.join(", ")}`,
  ]
  return lines.join("\n")
}

export * as StylePolicy from "./style-policy"
