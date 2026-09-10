import { Effect } from "effect"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import type { Provider } from "@/provider/provider"
import type { LLM } from "@/session/llm"
import { HardRuleChecker, type HardCheckResult, type HardViolation } from "./antislop/hard-rule-checker"
import {
  STYLE_POLICY_VERSION,
  STYLE_REVIEW_PROMPT_VERSION,
  STYLE_REWRITE_PROMPT_VERSION,
  STYLE_SCHEMA_VERSION,
  type StyleGateMode,
  type StylePolicy,
} from "./antislop/style-policy"
import { type ReviewResult, type StyleViolation } from "./antislop/style-contract"
import { SpanProtector, type ProtectedSpan } from "./antislop/span-protector"
import { StyleReviewer, type StyleReviewResult } from "./antislop/style-reviewer"
import { StyleRewriter, type StyleRewriteResult } from "./antislop/style-rewriter"
import { TargetedRewriter } from "./antislop/targeted-rewriter"

export type { StyleGateMode } from "./antislop/style-policy"

export type GateOutcome =
  | "pass"
  | "pass_after_rewrite"
  | "pass_with_soft_warnings"
  | "block_hard_violation"
  | "review_unavailable"

export type StyleGateInput = {
  readonly mode: StyleGateMode
  readonly reply: string
  readonly userPrompt?: string
  readonly strictOutput?: boolean
  readonly commentsRequested?: boolean
  readonly added?: ReadonlyMap<string, readonly string[]>
  readonly protectedSpans?: readonly ProtectedSpan[]
  readonly requiredAnnotations?: readonly string[]
  readonly nearbyCode?: readonly { readonly path: string; readonly content: string }[]
  readonly policy?: StylePolicy
  readonly timeoutMs?: number
}

export type StyleGateDeps = {
  readonly llm: LLM.Interface
  readonly user: SessionV1.User
  readonly model: Provider.Model
  readonly sessionID: string
}

export type StyleGateMetadata = {
  readonly policyVersion: number
  readonly reviewPromptVersion: number
  readonly rewritePromptVersion: number
  readonly schemaVersion: number
  readonly reviewCount: number
  readonly rewriteCount: number
  readonly retryCount: number
  readonly inputChars: number
  readonly outputChars: number
  readonly latencyMs: number
  readonly invalidReviewerJson: number
  readonly protectedSpanViolation: boolean
}

export type GateResult = {
  readonly outcome: GateOutcome
  readonly text: string
  readonly changed: boolean
  readonly shouldContinue: boolean
  readonly allowClose: boolean
  readonly hardViolations: readonly HardViolation[]
  readonly violations: readonly StyleViolation[]
  readonly protectedSpans: readonly ProtectedSpan[]
  readonly reviewCount: number
  readonly rewriteCount: number
  readonly metadata: StyleGateMetadata
}

const REWRITEABLE_CATEGORIES = new Set<StyleViolation["category"]>([
  "plain_language",
  "directness",
  "needless_abstraction",
  "filler",
  "repetition",
  "technical_explanation",
])

export const run = Effect.fn("OCXStyleGate.run")(function* (deps: StyleGateDeps, input: StyleGateInput) {
  const started = Date.now()
  const spans = input.protectedSpans ?? SpanProtector.protect({ text: input.reply })
  if (input.mode === "off") return result(input, spans, started, { outcome: "pass" })

  const hard = HardRuleChecker.check({
    draft: input.reply,
    strictOutput: input.strictOutput,
    added: input.added,
    commentsRequested: input.commentsRequested,
    requiredAnnotations: input.requiredAnnotations,
    protectedSpans: spans,
    protectedBefore: input.reply,
    protectedAfter: input.reply,
  })
  if (!hard.pass) return blocked(input, spans, started, hard, 0, 0, 0)

  const review = yield* StyleReviewer.review(
    { llm: deps.llm, user: deps.user, model: deps.model, sessionID: deps.sessionID },
    {
      draft: input.reply,
      protectedSpans: spans,
      ...(input.userPrompt ? { userPrompt: input.userPrompt } : {}),
      surface: "prose",
      ...(input.policy ? { policy: input.policy } : {}),
      ...(input.nearbyCode ? { nearbyCode: input.nearbyCode } : {}),
      ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
    },
  )
  if (review.status === "unavailable") return unavailable(input, spans, started, review, undefined)

  const semantic = review.review!
  if (semantic.violations.length === 0)
    return result(input, spans, started, {
      outcome: "pass",
      reviewCount: 1,
      retryCount: review.metadata.retryCount,
      outputChars: review.metadata.outputChars,
      review: semantic,
      invalidReviewerJson: review.metadata.retryCount,
    })

  const semanticHard = semantic.violations.filter((violation) => violation.severity === "hard")
  if (semanticHard.length > 0)
    return blocked(
      input,
      spans,
      started,
      hardResult(semanticHard),
      1,
      0,
      review.metadata.retryCount,
      semantic,
      review.metadata.outputChars,
      false,
      review.metadata.retryCount,
    )

  const rewriteable = semantic.violations.filter((violation) => REWRITEABLE_CATEGORIES.has(violation.category))
  if (input.mode === "shadow" || rewriteable.length === 0)
    return result(input, spans, started, {
      outcome: "pass_with_soft_warnings",
      reviewCount: 1,
      retryCount: review.metadata.retryCount,
      outputChars: review.metadata.outputChars,
      review: semantic,
      invalidReviewerJson: review.metadata.retryCount,
    })

  const rewrite = yield* StyleRewriter.rewrite(
    { llm: deps.llm, user: deps.user, model: deps.model, sessionID: deps.sessionID },
    {
      draft: input.reply,
      protectedSpans: spans,
      violations: rewriteable,
      ...(input.policy ? { policy: input.policy } : {}),
      ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
    },
  )
  if (rewrite.status === "unavailable") return unavailable(input, spans, started, review, rewrite)

  const applied = TargetedRewriter.apply({
    draft: input.reply,
    edits: rewrite.edits,
    violations: rewriteable,
    protectedSpans: spans,
  })
  if (!applied.pass) {
    const protectedViolation = applied.errors.some((error) => /protected/i.test(error))
    const rewriteHard: HardCheckResult = {
      pass: false,
      violations: [
        {
          ruleId: "rewrite.invalid",
          severity: "hard",
          message: applied.errors.join("; "),
          evidence: applied.errors[0],
        },
      ],
    }
    return blocked(
      input,
      spans,
      started,
      rewriteHard,
      1,
      1,
      review.metadata.retryCount + rewrite.metadata.retryCount,
      semantic,
      review.metadata.outputChars + rewrite.metadata.outputChars,
      protectedViolation,
    )
  }
  if (!applied.applied)
    return result(input, spans, started, {
      outcome: "pass_with_soft_warnings",
      reviewCount: 1,
      rewriteCount: 1,
      retryCount: review.metadata.retryCount + rewrite.metadata.retryCount,
      outputChars: review.metadata.outputChars + rewrite.metadata.outputChars,
      review: semantic,
      invalidReviewerJson: review.metadata.retryCount + rewrite.metadata.retryCount,
    })

  const rewrittenHard = HardRuleChecker.check({
    draft: applied.text,
    strictOutput: input.strictOutput,
    added: input.added,
    commentsRequested: input.commentsRequested,
    requiredAnnotations: input.requiredAnnotations,
    protectedSpans: spans,
    protectedBefore: input.reply,
    protectedAfter: applied.text,
  })
  if (!rewrittenHard.pass)
    return blocked(
      input,
      spans,
      started,
      rewrittenHard,
      1,
      1,
      review.metadata.retryCount + rewrite.metadata.retryCount,
      semantic,
      review.metadata.outputChars + rewrite.metadata.outputChars,
      rewrittenHard.violations.some((violation) => violation.ruleId === "protected_text.changed"),
      review.metadata.retryCount + rewrite.metadata.retryCount,
    )

  const verification = yield* StyleReviewer.review(
    { llm: deps.llm, user: deps.user, model: deps.model, sessionID: deps.sessionID },
    {
      draft: applied.text,
      protectedSpans: spans,
      ...(input.userPrompt ? { userPrompt: input.userPrompt } : {}),
      surface: "prose",
      ...(input.policy ? { policy: input.policy } : {}),
      ...(input.nearbyCode ? { nearbyCode: input.nearbyCode } : {}),
      ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
    },
  )
  if (verification.status === "unavailable") return unavailable(input, spans, started, review, rewrite)

  const verified = verification.review!
  const reviewCount = 2
  const retryCount = review.metadata.retryCount + rewrite.metadata.retryCount + verification.metadata.retryCount
  const outputChars = review.metadata.outputChars + rewrite.metadata.outputChars + verification.metadata.outputChars
  const verificationHard = verified.violations.filter((violation) => violation.severity === "hard")
  if (verificationHard.length > 0)
    return blocked(
      input,
      spans,
      started,
      hardResult(verificationHard),
      reviewCount,
      1,
      retryCount,
      verified,
      outputChars,
      false,
      review.metadata.retryCount + rewrite.metadata.retryCount + verification.metadata.retryCount,
    )
  if (!verified.pass || verified.violations.length > 0)
    return result(input, spans, started, {
      outcome: "pass_with_soft_warnings",
      text: applied.text,
      changed: applied.text !== input.reply,
      reviewCount,
      rewriteCount: 1,
      retryCount,
      outputChars,
      review: verified,
      invalidReviewerJson: review.metadata.retryCount + rewrite.metadata.retryCount + verification.metadata.retryCount,
    })
  return result(input, spans, started, {
    outcome: "pass_after_rewrite",
    text: applied.text,
    changed: applied.text !== input.reply,
    reviewCount,
    rewriteCount: 1,
    retryCount,
    outputChars,
    review: verified,
    invalidReviewerJson: review.metadata.retryCount + rewrite.metadata.retryCount + verification.metadata.retryCount,
  })
})

type ResultOptions = {
  readonly outcome: GateOutcome
  readonly text?: string
  readonly changed?: boolean
  readonly reviewCount?: number
  readonly rewriteCount?: number
  readonly retryCount?: number
  readonly outputChars?: number
  readonly review?: ReviewResult
  readonly hardViolations?: readonly HardViolation[]
  readonly invalidReviewerJson?: number
  readonly protectedSpanViolation?: boolean
}

function result(
  input: StyleGateInput,
  spans: readonly ProtectedSpan[],
  started: number,
  options: ResultOptions,
): GateResult {
  const text = options.text ?? input.reply
  const shouldContinue = options.outcome === "block_hard_violation" && input.mode !== "shadow"
  return {
    outcome: options.outcome,
    text,
    changed: options.changed ?? text !== input.reply,
    shouldContinue,
    allowClose: !shouldContinue,
    hardViolations: options.hardViolations ?? [],
    violations: options.review?.violations ?? [],
    protectedSpans: [...spans],
    reviewCount: options.reviewCount ?? 0,
    rewriteCount: options.rewriteCount ?? 0,
    metadata: {
      policyVersion: input.policy?.version ?? STYLE_POLICY_VERSION,
      reviewPromptVersion: STYLE_REVIEW_PROMPT_VERSION,
      rewritePromptVersion: STYLE_REWRITE_PROMPT_VERSION,
      schemaVersion: STYLE_SCHEMA_VERSION,
      reviewCount: options.reviewCount ?? 0,
      rewriteCount: options.rewriteCount ?? 0,
      retryCount: options.retryCount ?? 0,
      inputChars: input.reply.length,
      outputChars: options.outputChars ?? 0,
      latencyMs: Math.max(0, Date.now() - started),
      invalidReviewerJson: options.invalidReviewerJson ?? 0,
      protectedSpanViolation: options.protectedSpanViolation ?? false,
    },
  }
}

function blocked(
  input: StyleGateInput,
  spans: readonly ProtectedSpan[],
  started: number,
  hard: HardCheckResult,
  reviewCount: number,
  rewriteCount: number,
  retryCount: number,
  review?: ReviewResult,
  outputChars = 0,
  protectedSpanViolation = false,
  invalidReviewerJson = 0,
): GateResult {
  return result(input, spans, started, {
    outcome: "block_hard_violation",
    reviewCount,
    rewriteCount,
    retryCount,
    review,
    outputChars,
    hardViolations: hard.violations,
    protectedSpanViolation,
    invalidReviewerJson,
  })
}

function unavailable(
  input: StyleGateInput,
  spans: readonly ProtectedSpan[],
  started: number,
  review: StyleReviewResult,
  rewrite: StyleRewriteResult | undefined,
): GateResult {
  return result(input, spans, started, {
    outcome: "review_unavailable",
    reviewCount: review.metadata.attempts > 0 ? 1 : 0,
    rewriteCount: rewrite ? 1 : 0,
    retryCount: review.metadata.retryCount + (rewrite?.metadata.retryCount ?? 0),
    outputChars: review.metadata.outputChars + (rewrite?.metadata.outputChars ?? 0),
    ...(review.review ? { review: review.review } : {}),
    invalidReviewerJson: invalidJsonAttempts(review) + (rewrite ? invalidJsonAttempts(rewrite) : 0),
  })
}

function invalidJsonAttempts(result: StyleReviewResult | StyleRewriteResult): number {
  return result.metadata.retryCount + (result.failure === "invalid_json" ? 1 : 0)
}

function hardResult(violations: readonly StyleViolation[] | readonly HardViolation[]): HardCheckResult {
  return {
    pass: violations.length === 0,
    violations: violations.map((violation) => {
      if ("ruleId" in violation) return violation
      return {
        ruleId: `semantic.${violation.id}`,
        severity: "hard" as const,
        message: violation.reason,
        evidence: violation.span,
      }
    }),
  }
}

export * as StyleGate from "./style-gate"
