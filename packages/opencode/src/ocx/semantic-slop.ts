import { Effect } from "effect"
import {
  SlopDetection,
  SlopFinding as SDKSlopFinding,
  detectSlop,
} from "@opencode-ai/llm/semantic"

// ── Types ───────────────────────────────────────────────────────────────────

export type SlopFinding = {
  readonly rule: string
  readonly severity: "warning" | "blocker"
  readonly evidence: string
  readonly fix: string
}

// ── Category Mapping ─────────────────────────────────────────────────────────

const CATEGORY_TO_RULE: Record<string, string> = {
  engagement_bait: "S-engagement-bait",
  filler_hedge: "S-filler-hedge",
  hype_word: "HYPE_WORD",
  prose_tell: "PROSE_TELL",
  sycophancy: "SYCOPHANCY",
  self_cheer: "SELF_CHEER",
  fake_success: "FAKE_SUCCESS",
  placeholder_contact: "PLACEHOLDER_CONTACT",
  dead_link: "DEAD_LINKS",
  hotlinked_image: "HOTLINKED_IMAGES",
  dead_image_service: "DEAD_IMAGE_SERVICE",
  unverified_asset_claim: "UNVERIFIED_ASSET_CLAIM",
  default_font: "DEFAULT_FONT_PAIRING",
  glassmorphism: "GLASSMORPHISM_CLUSTER",
  emoji_abuse: "EMOJI_AS_ICON",
  bold_overload: "S-bold-overload",
  decorative_gradient: "DECORATIVE_GRADIENT",
  hover_bounce: "HOVER_BOUNCE",
  heading_formula: "KICKER_TITLE_FORMULA",
  form_label_heading: "FORM_LABEL_HEADING_TREATMENT",
  repeated_opener: "P-repeat-opener",
  emdash_density: "P-emdash-density",
  ocx_jargon: "P-ocx-jargon",
  apology_loop: "S-apology-loop",
}

// ── Bridge API ───────────────────────────────────────────────────────────────

/**
 * Detect slop patterns using the semantic SDK.
 * Returns findings in the same format as the regex-based scanner.
 */
export function detectSlopSemantic(
  text: string,
): Effect.Effect<SlopFinding[], never> {
  return detectSlop(text).pipe(
    Effect.map((detection) =>
      detection.findings.map((finding) => ({
        rule: CATEGORY_TO_RULE[finding.category] ?? finding.category,
        severity: finding.severity,
        evidence: finding.evidence,
        fix: finding.fix,
      }))
    ),
    Effect.catch(() => Effect.succeed([])),
  )
}

export * as SemanticSlop from "./semantic-slop"
