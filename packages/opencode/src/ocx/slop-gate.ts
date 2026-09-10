import { Effect } from "effect"
import { SemanticSlop } from "./semantic-slop"

const GLASS_CLUSTER_MIN = 3
const EMOJI_ICON_MIN = 2
const CENTERED_HEADING_MIN = 4
const FONT_SIZE_COUNT_MAX = 6
const TOKEN_DRIFT_MAX_DISTANCE = 60
const TOKEN_DRIFT_HUE_FAMILY_MAX_DEG = 30
const COLOR_SATURATION_MIN = 30
const COLOR_VALUE_MIN = 60
const KICKER_FORMULA_MIN = 3
const LABEL_MAX_REM = 1.75
const LABEL_MAX_PX = 28


export type SlopFinding = {
  readonly rule: string
  readonly severity: "warning" | "blocker"
  readonly evidence: string
  readonly fix: string
}

const maxFindings = 12

const hypeWord =
  /\b(seamless(?:ly)?|world-class|cutting-edge|state-of-the-art|game-changers?|revolutionary|breathtaking|supercharg\w*|effortless(?:ly)?|blazing[- ]fast|next-generation|beyond perfection|engineered without compromise|pure intention|harness the power of|unlock the potential)\b/gi
const swallowedError =
  /catch\s*\([^)]*\)\s*\{\s*(?:\/\/[^\n]*\n\s*)*(?:return\s*(?:null|undefined|\[\]|\{\}|"")\s*;?\s*)?\}/gi
const proseTell = /\b(?:delve|tapestry|testament to)\b|\bit(?:'| i)s not just\b/gi
const cheerStandalone = /(?:^|\n)[ \t]*(?:good|great|excellent|perfect|awesome|nice)[ \t]*[!.]/gi
const cheerPhrase = /\bgreat progress\b|\b(?:excellent|perfect|awesome)!/gi
const sycophancy = /(?:^|\n)[ \t]*(?:great question|certainly|of course|i apologize)[ \t]*[!,.]/gi
const fakeSuccess =
  /\byour (?:inquiry|message|request|email) has been sent\b|\bwe will (?:contact|get back to) you within\b|\bmessage sent successfully\b/gi
const placeholderContact =
  /\b\(\d{3}\) ?\d{3}[- ]\d{4}\b|\b123 [a-z]+ (?:drive|street|avenue|road|lane)\b/gi
const deadLink = /href="#"/g
const cardShell = /class="[^"]*\b[\w-]*card[\w-]*[^"]*"/g
const hoverLift = /:hover[^{]*\{[^}]*?(?:translateY\(-|scale\(1\.0[3-9]\))/g
const decorativeGradient = /(?:linear|radial)-gradient\(/gi
const kickerHeadingPair =
  /<(\w+)([^>]*)class="[^"]*\b(?:kicker|eyebrow|overline)\b[^"]*"[^>]*>[^<]{0,120}<\/\1>\s*<h[1-6][\s>]/gi
const cssBlock = /([^{}]+)\{([^}]*)\}/g
const afterBlock = /([\w.#][\w.#>: .-]*)::after\s*\{([^}]*)\}/g
const googleFontsUrl = /https:\/\/fonts\.googleapis\.com\/[^"' )\n]+/g
const googleFontFamily = /[?&]family=([^&"' )\n]+)/g
const cssFontStacks = /font-family\s*:\s*([^;}{]+)/gi

const hotlinkedImage =
  /\b(?:images\.unsplash\.com|source\.unsplash\.com|images\.pexels\.com|cdn\.pixabay\.com|picsum\.photos)\b/gi

const imgSrc = /<img[^>]*\ssrc="(https?:[^"]+)"/gi

const deadImageService = /\bsource\.unsplash\.com\b/gi

function hexHue(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  if (max === min) return 0
  const d = max - min
  const base = max === r ? (g - b) / d : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return (base * 60 + 360) % 360
}

function sameHueFamily(a: string, b: string): boolean {
  const diff = Math.abs(hexHue(a) - hexHue(b))
  return Math.min(diff, 360 - diff) <= TOKEN_DRIFT_HUE_FAMILY_MAX_DEG
}

function tokenDriftEvidence(text: string): string | undefined {
  const hexes = [...new Set([...text.matchAll(/#[0-9a-fA-F]{6}\b/g)].map((m) => m[0].toLowerCase()))]
    .filter((hex) => {
      const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16)
      const max = Math.max(r, g, b), min = Math.min(r, g, b)
      return max - min > COLOR_SATURATION_MIN && max > COLOR_VALUE_MIN
    })
  for (let i = 0; i < hexes.length; i++)
    for (let j = i + 1; j < hexes.length; j++) {
      const a = hexes[i], b = hexes[j]
      if (!sameHueFamily(a, b)) continue
      const channel = (hex: string, at: number) => parseInt(hex.slice(at, at + 2), 16)
      const d =
        Math.abs(channel(a, 1) - channel(b, 1)) +
        Math.abs(channel(a, 3) - channel(b, 3)) +
        Math.abs(channel(a, 5) - channel(b, 5))
      if (d > 0 && d <= TOKEN_DRIFT_MAX_DISTANCE) return `${a} and ${b} are near-duplicates`
    }
  return undefined
}

function duplicatePhotoEvidence(text: string): string | undefined {
  const counts = new Map<string, number>()
  for (const match of text.matchAll(imgSrc)) {
    const base = match[1].split("?")[0]
    counts.set(base, (counts.get(base) ?? 0) + 1)
  }
  for (const [base, count] of counts) if (count >= 3) return `${base} x${count}`
  return undefined
}

const unverifiedAssetClaim =
  /\b(?:these are|this is|they are|both are)\s+(?:all\s+)?(?:real|valid|working|verified)\b[^.\n]{0,80}\b(?:unsplash|pexels|pixabay|photo|image|url)s?\b/i

const defaultFontFamilies = [
  "Playfair Display",
  "Lato",
  "Poppins",
  "Montserrat",
  "Manrope",
  "DM Sans",
  "Space Grotesk",
  "Inter",
  "Instrument Serif",
]

function firstMatch(text: string, pattern: RegExp): string | undefined {
  const found = pattern.exec(text)
  pattern.lastIndex = 0
  return found?.[0]
}

function quotedEvidence(text: string, pattern: RegExp, limit = 60): string {
  const match = firstMatch(text, pattern)
  if (!match) return ""
  const clean = match.replace(/\s+/g, " ").trim()
  return clean.length > limit ? `${clean.slice(0, limit)}...` : clean
}

function fontMentions(text: string): string[] {
  const names: string[] = []
  for (const urlMatch of text.matchAll(googleFontsUrl)) {
    for (const familyMatch of urlMatch[0].matchAll(googleFontFamily)) {
      const family = decodeURIComponent(familyMatch[1]).split(":")[0]
      names.push(family.replaceAll("+", " ").trim())
    }
  }
  for (const match of text.matchAll(cssFontStacks)) {
    for (const part of match[1].split(",")) {
      names.push(part.trim().replace(/['"]/g, "").split(":")[0].trim())
    }
  }
  return names
}

function headingUnderlineSelector(text: string): string | undefined {
  for (const match of text.matchAll(afterBlock)) {
    const body = match[2]
    const emptyContent = /content\s*:\s*["']{2}/.test(body)
    const painted = /background(?:-color)?\s*:/.test(body)
    const width = /width\s*:\s*([\d.]+)(px|rem)/.exec(body)
    const small = !!width && Number(width[1]) <= (width[2] === "rem" ? 6.25 : 100)
    if (emptyContent && painted && small) return match[1].trim()
  }
  return undefined
}

const PROSE_CANDIDATES: [string, RegExp][] = [
  ["P-arrows", /(?:->|=>|→)/],
  ["P-proofed", /\b\w+-proof(?:ed)?\b/i],
]

const ENGAGEMENT_BAIT =
  /\b(?:would you like me to|let me know if|feel free to|hope this (?:helps|clarified)|don'?t hesitate to)\b/i
const FILLER_HEDGE =
  /\b(?:it(?:'?s| is) (?:important|worth) (?:to note|noting(?: that)?)|please (?:keep in mind|note)(?: that)?|in today'?s fast-paced\b)/i
const APOLOGY_WORD = /\b(?:i apologize|my apologies|sorry)\b/gi
const APOLOGY_MIN = 3
const EMOJI_GLYPH = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu
const EMOJI_PROSE_MIN = 4
const BOLD_SPAN = /\*\*[^*\n]{1,80}\*\*/g
const BOLD_MAX = 10

export const STYLE_RULES = [
  "S-engagement-bait",
  "S-filler-hedge",
  "S-apology-loop",
  "S-emoji-prose",
  "S-bold-overload",
] as const

function styleCandidates(text: string): SlopFinding[] {
  const out: SlopFinding[] = []
  if (ENGAGEMENT_BAIT.test(text))
    out.push({
      rule: "S-engagement-bait",
      evidence: firstMatch(text, new RegExp(ENGAGEMENT_BAIT.source, "i")) ?? "",
      severity: "warning",
      fix: "end at the answer; drop service-bot offers and sign-offs",
    })
  if (FILLER_HEDGE.test(text))
    out.push({
      rule: "S-filler-hedge",
      evidence: firstMatch(text, new RegExp(FILLER_HEDGE.source, "i")) ?? "",
      severity: "warning",
      fix: "state the point directly; delete throat-clearing hedges",
    })
  const apologies = [...text.matchAll(APOLOGY_WORD)].length
  if (apologies >= APOLOGY_MIN)
    out.push({
      rule: "S-apology-loop",
      evidence: `${apologies} apologies`,
      severity: "warning",
      fix: "one acknowledgment at most; repeated apologizing reads as a loop",
    })
  const emoji = [...text.matchAll(EMOJI_GLYPH)].length
  if (emoji >= EMOJI_PROSE_MIN)
    out.push({
      rule: "S-emoji-prose",
      evidence: `${emoji} emoji glyphs`,
      severity: "warning",
      fix: "remove decorative emoji from reply text; keep icons in markup only",
    })
  const boldSpans = [...text.matchAll(BOLD_SPAN)].length
  if (boldSpans >= BOLD_MAX)
    out.push({
      rule: "S-bold-overload",
      evidence: `${boldSpans} bold spans`,
      severity: "warning",
      fix: "emphasis everywhere is emphasis nowhere; cut to plain text or a real structure",
    })
  return out.filter((finding) => finding.evidence !== "")
}

const OCX_JARGON = [
  "contract loop",
  "evidence ledger",
  "repair round",
  "stage row",
  "pre-pass",
  "pull model",
  "verdict cascade",
]

function proseCandidates(text: string): SlopFinding[] {
  const out: SlopFinding[] = []
  for (const [rule, pattern] of PROSE_CANDIDATES) {
    const match = pattern.exec(text)
    if (match) out.push({ rule, evidence: match[0], severity: "warning", fix: "rewrite in plain words" })
  }
  for (const term of OCX_JARGON) {
    if (text.toLowerCase().includes(term))
      out.push({ rule: "P-ocx-jargon", evidence: term, severity: "warning", fix: "spell out the idea in plain words" })
  }
  const words = text.split(/\s+/).filter(Boolean).length
  const dashes = (text.match(/—/g) ?? []).length
  if (words > 60 && dashes >= 3)
    out.push({ rule: "P-emdash-density", evidence: `${dashes} em dashes`, severity: "warning", fix: "use periods or commas instead" })
  const paragraphs = text.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean)
  const openers = new Map<string, number>()
  for (const block of paragraphs) {
    const first = block.split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]/g, "")
    if (!first || first.length < 3) continue
    openers.set(first, (openers.get(first) ?? 0) + 1)
  }
  for (const [opener, count] of openers)
    if (count >= 3)
      out.push({ rule: "P-repeat-opener", evidence: `${opener} x${count}`, severity: "warning", fix: "vary how sections start" })
  return out
}

function formLabelEvidence(text: string): string | undefined {
  for (const match of text.matchAll(cssBlock)) {
    if (!/\blabel\b/i.test(match[1])) continue
    const body = match[2]
    const size = /font-size\s*:\s*([0-9.]+)\s*(px|rem)/i.exec(body)
    if (size && Number(size[1]) >= (size[2] === "rem" ? LABEL_MAX_REM : LABEL_MAX_PX)) return match[0]
    const family = /font-family\s*:\s*([^;}]+)/i.exec(body)
    if (family && defaultFontFamilies.some((name) => family[1].toLowerCase().includes(name.toLowerCase())))
      return match[0]
  }
  return undefined
}

export function scanText(text: string): SlopFinding[] {
  const findings: SlopFinding[] = []
  const push = (finding: SlopFinding) => {
    if (!findings.some((existing) => existing.rule === finding.rule) && findings.length < maxFindings)
      findings.push(finding)
  }

  const hype = quotedEvidence(text, hypeWord)
  if (hype) push({ rule: "HYPE_WORD", severity: "warning", evidence: hype, fix: "replace the hype word with the specific fact it hides" })

  const swallowed = quotedEvidence(text, swallowedError)
  if (swallowed) push({ rule: "SWALLOWED_ERROR", severity: "warning", evidence: swallowed, fix: "do not silently swallow errors; log with context or rethrow a domain error" })

  const tell = quotedEvidence(text, proseTell)
  if (tell) push({ rule: "PROSE_TELL", severity: "warning", evidence: tell, fix: "rewrite the sentence in plain words" })

  const cheer = quotedEvidence(text, cheerStandalone) ?? quotedEvidence(text, cheerPhrase)
  if (cheer)
    push({
      rule: "SELF_CHEER",
      severity: "warning",
      evidence: cheer,
      fix: "delete self-directed praise and state the result or next step instead",
    })

  const flattery = quotedEvidence(text, sycophancy)
  if (flattery)
    push({ rule: "SYCOPHANCY", severity: "warning", evidence: flattery, fix: "start with the answer, not praise or apologies" })

  const fakeSend = quotedEvidence(text, fakeSuccess)
  if (fakeSend)
    push({
      rule: "FAKE_SUCCESS",
      severity: "blocker",
      evidence: fakeSend,
      fix: "show success only after a real submission confirmation; otherwise use an honest unavailable state",
    })

  const contact = quotedEvidence(text, placeholderContact)
  if (contact)
    push({
      rule: "PLACEHOLDER_CONTACT",
      severity: "warning",
      evidence: contact,
      fix: "omit invented addresses and phone numbers or label them clearly as sample data",
    })

  const deadLinks = [...text.matchAll(deadLink)]
  if (deadLinks.length >= 1)
    push({
      rule: "DEAD_LINKS",
      severity: "blocker",
      evidence: `href="#" x${deadLinks.length}`,
      fix: "point every link at a real anchor id or use disabled non-link element with honest label",
    })

  const cards = [...text.matchAll(cardShell)]
  if (cards.length === 3 || cards.length >= 6)
    push({
      rule: "EQUAL_CARDS",
      severity: "blocker",
      evidence: `${cards.length} card shells in uniform grid trope`,
      fix: "break the uniform grid: vary size and grouping by content, or design content-driven layout",
    })

  const lift = quotedEvidence(text, hoverLift)
  if (lift)
    push({
      rule: "HOVER_BOUNCE",
      severity: "warning",
      evidence: lift,
      fix: "replace motion-everywhere hovers with one purposeful feedback per interaction",
    })

  const gradient = quotedEvidence(text, decorativeGradient)
  if (gradient)
    push({
      rule: "DECORATIVE_GRADIENT",
      severity: "warning",
      evidence: gradient,
      fix: "use a flat overlay tuned for text contrast instead of a decorative linear or radial gradient",
    })

  const underline = headingUnderlineSelector(text)
  if (underline)
    push({
      rule: "HEADING_UNDERLINE_DECOR",
      severity: "warning",
      evidence: `${underline}::after`,
      fix: "remove the accent bar repeated under every section heading",
    })

  const hotlink = quotedEvidence(text, hotlinkedImage)
  if (hotlink)
    push({
      rule: "HOTLINKED_IMAGES",
      severity: "blocker",
      evidence: hotlink,
      fix: "download licensed assets into the working directory or use local placeholders; never ship guessed CDN URLs",
    })

  const duplicate = duplicatePhotoEvidence(text)
  if (duplicate)
    push({
      rule: "DUPLICATE_PHOTO",
      severity: "warning",
      evidence: duplicate,
      fix: "use a distinct verified image per section; crops of one photo read as the same picture everywhere",
    })

  const drift = tokenDriftEvidence(text)
  if (drift)
    push({
      rule: "TOKEN_DRIFT",
      severity: "warning",
      evidence: drift,
      fix: "collapse near-duplicate accent colors into one design token; two golds is an accident, not a palette",
    })

  const remoteFont = quotedEvidence(
    text,
    /(?:fonts\.googleapis\.com\/(?:css2?|icon)|fonts\.gstatic\.com|cdn\.jsdelivr\.net\/npm\/material-icons|fonts\.materialicons)/gi,
  )
  if (remoteFont)
    push({
      rule: "REMOTE_FONT_CSS",
      severity: "warning",
      evidence: remoteFont,
      fix: "vendor the fonts/icons: download woff2/svg into assets/fonts and use @font-face; keep remote link only if the user asked",
    })

  const dead = quotedEvidence(text, deadImageService)
  if (dead)
    push({
      rule: "DEAD_IMAGE_SERVICE",
      severity: "blocker",
      evidence: dead,
      fix: "source.unsplash.com is shut down and returns errors; download licensed images into the project or use local placeholders",
    })

  const claim = quotedEvidence(text, unverifiedAssetClaim)
  if (claim)
    push({
      rule: "UNVERIFIED_ASSET_CLAIM",
      severity: "blocker",
      evidence: claim,
      fix: "verify the asset actually loads and shows the right subject, or say it is unverified",
    })

  const families = [...new Set(fontMentions(text).filter((name) => defaultFontFamilies.includes(name)))]
  if (families.includes("Space Grotesk") && families.includes("Instrument Serif"))
    push({
      rule: "DEFAULT_FONT_PAIRING",
      severity: "warning",
      evidence: "Space Grotesk + Instrument Serif",
      fix: "the AI-slop Space Grotesk + Instrument Serif pairing is an overused cliché reflex; pick a researched typography system with deliberate voice",
    })
  else if (families.includes("Playfair Display") && families.includes("Inter"))
    push({
      rule: "DEFAULT_FONT_PAIRING",
      severity: "warning",
      evidence: families.join(" + "),
      fix: "the reflex elegant-serif-over-Inter pairing shipped unreviewed in logged sessions; pick a researched pairing and record why",
    })
  else if (families.includes("Space Grotesk") && families.includes("Inter"))
    push({
      rule: "DEFAULT_FONT_PAIRING",
      severity: "warning",
      evidence: families.join(" + "),
      fix: "the AI-slop Space Grotesk + Inter pairing is a generic reflex; pick a researched typography system with deliberate voice",
    })
  else if (families.includes("Playfair Display") && families.includes("Lato"))
    push({
      rule: "DEFAULT_FONT_PAIRING",
      severity: "warning",
      evidence: families.join(" + "),
      fix: "pick a researched pairing that fits this product; record why in the typography table",
    })
  else if (families.length > 0)
    push({
      rule: "DEFAULT_FONT_FAMILY",
      severity: "warning",
      evidence: families.join(", "),
      fix: "justify each family against the product or choose a researched alternative",
    })

  const gradientText =
    quotedEvidence(
      text,
      /(?:background(?:-clip)?\s*:\s*[^;}]*text[^;}]*|background-clip\s*:\s*text)[^;}]*?(?:linear|radial)-gradient/gi,
    ) ??
    quotedEvidence(
      text,
      /(?:linear|radial)-gradient\([^)]+\)[^;}]*?(?:-webkit-)?background-clip\s*:\s*text/gi,
    )
  if (gradientText)
    push({
      rule: "GRADIENT_TEXT_HEADING",
      severity: "warning",
      evidence: gradientText,
      fix: "use solid, high-contrast text colors for headings; avoid gradient-clipped text headings",
    })

  const inlineBypass =
    quotedEvidence(
      text,
      /<a\b[^>]*\bonclick\s*=\s*["'][^"']*return\s+false;?["'][^>]*>/gi,
    ) ??
    quotedEvidence(
      text,
      /<a\b[^>]*\bhref\s*=\s*["']#[^"']*["'][^>]*\bonclick\s*=\s*["'][^"']*(?:innerHTML|innerText|textContent)\s*=/gi,
    )
  if (inlineBypass)
    push({
      rule: "INLINE_ONCLICK_LINK_BYPASS",
      severity: "blocker",
      evidence: inlineBypass,
      fix: "do not disguise dummy links with inline onclick hacks; wire a real functional control, modal, or honest static badge",
    })

  const misdirectedLink = quotedEvidence(
    text,
    /<a\b[^>]*\bhref\s*=\s*["']#(?:cta|hero|features|gallery|about|specs)["'][^>]*>\s*(?:privacy|terms|support|press|legal|cookies|help|status|careers)\s*<\/a>/gi,
  )
  if (misdirectedLink)
    push({
      rule: "MISDIRECTED_NAVIGATION",
      severity: "blocker",
      evidence: misdirectedLink,
      fix: "do not point unrelated legal, terms, or support links to random sections like #cta; render them as non-link spans or honest unavailable dialogs",
    })

  const glassMatches = (text.match(/backdrop-filter:\s*blur|\bglass-card\b|\bbackdrop-blur(?=[\s"'）-])/gi) ?? []).length
  if (glassMatches >= GLASS_CLUSTER_MIN)
    push({
      rule: "GLASSMORPHISM_CLUSTER",
      severity: "warning",
      evidence: `backdrop blur x${glassMatches}`,
      fix: "replace frosted panels with solid surfaces and 1px borders; reserve blur for one overlay at most",
    })

  const darkGlassCard = quotedEvidence(text, /(?:\.[\w-]*card[^{]*\{[^}]*backdrop-filter:\s*blur|\bglass-card\b)/gi)
  if (darkGlassCard)
    push({
      rule: "GLASSMORPHISM_CLICHE",
      severity: "warning",
      evidence: darkGlassCard,
      fix: "replace dark glassmorphism cards with solid, content-informed elevation and surfaces",
    })

  const gradientBorder = quotedEvidence(text, /(?:-webkit-)?mask-composite\s*:\s*(?:xor|exclude)|\bgradient-border\b/gi)
  if (gradientBorder)
    push({
      rule: "GRADIENT_BORDER_MASK",
      severity: "warning",
      evidence: gradientBorder,
      fix: "remove decorative gradient borders via CSS masks; use clean deliberate border tokens or whitespace",
    })

  const shimmer = quotedEvidence(text, /@keyframes\s+shimmer|\btext-shimmer\b/gi)
  if (shimmer)
    push({
      rule: "SHIMMER_TEXT",
      severity: "warning",
      evidence: shimmer,
      fix: "remove animated text shimmer on headings; typography should be legible and steady, not animated with decorative gradients",
    })

  const floatAnim = quotedEvidence(text, /@keyframes\s+float|\bfloat-anim\b/gi)
  if (floatAnim)
    push({
      rule: "FLOAT_HERO_ANIMATION",
      severity: "warning",
      evidence: floatAnim,
      fix: "remove idle floating/bobbing animations on hero cards; motion should serve interaction feedback or real page transitions",
    })

  const noise = quotedEvidence(text, /feTurbulence|fractalNoise|\bclass="[^"]*\bnoise\b[^"]*"/gi)
  if (noise)
    push({
      rule: "NOISE_OVERLAY_TEXTURE",
      severity: "warning",
      evidence: noise,
      fix: "remove synthetic SVG noise textures; rely on real photography, materials, and typography",
    })

  const scrollbar = quotedEvidence(text, /::-webkit-scrollbar-thumb\s*\{[^}]*background/gi)
  if (scrollbar)
    push({
      rule: "CUSTOM_TINTED_SCROLLBAR",
      severity: "warning",
      evidence: scrollbar,
      fix: "avoid custom tinted scrollbar overrides that degrade platform accessibility",
    })

  const remoteCdn = quotedEvidence(
    text,
    /<script\b[^>]*\ssrc=["']https?:\/\/(?:cdn\.tailwindcss\.com|cdnjs\.cloudflare\.com|unpkg\.com|cdn\.jsdelivr\.net\/npm\/[^"']+)["']/gi,
  )
  if (remoteCdn)
    push({
      rule: "REMOTE_CDN_SCRIPT",
      severity: "blocker",
      evidence: remoteCdn,
      fix: "do not ship CDN scripts (e.g. cdn.tailwindcss.com or cdnjs GSAP) in production markup; bundle dependencies or vendor assets locally",
    })

  const aiMarketingCopy = quotedEvidence(
    text,
    /\b(?:The Next Dimension of Mobile|Beyond Smartphone|The phone that thinks before you speak|Quad-prism sensor|HyperCharge|pure intention|harness the power of intelligence)\b/gi,
  )
  if (aiMarketingCopy)
    push({
      rule: "AI_MARKETING_SLOP",
      severity: "blocker",
      evidence: aiMarketingCopy,
      fix: "eliminate pretentious AI slogans and fabricated tech specs; use truthful, grounded product copy",
    })

  const arbitrarySleep = quotedEvidence(text, /\b(?:sleep\s*\(\s*\d{3,}\s*\)|setTimeout\s*\(\s*[^,]+,\s*\d{3,}\s*\))\b/gi)
  if (arbitrarySleep)
    push({
      rule: "ARBITRARY_SLEEP",
      severity: "warning",
      evidence: arbitrarySleep,
      fix: "do not use arbitrary delays/sleep for synchronization; use event-driven, polling with conditions, or promise coordination",
    })

  const emojiIcons = [...text.matchAll(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu)].length
  if (emojiIcons >= EMOJI_ICON_MIN)
    push({
      rule: "EMOJI_AS_ICON",
      severity: "warning",
      evidence: `${emojiIcons} emoji glyphs`,
      fix: "use a real icon set or SVG marks; emoji as icons reads as unreviewed output",
    })

  const fontSizes = new Set(
    [...text.matchAll(/font-size:\s*([0-9.]+)(?:px|rem)\b/gi)].map((m) => m[1]),
  )
  if (fontSizes.size > FONT_SIZE_COUNT_MAX)
    push({
      rule: "FONT_SIZE_DRIFT",
      severity: "warning",
      evidence: `${fontSizes.size} distinct font sizes`,
      fix: "declare a type ramp (one ratio, 5-6 steps) and map every size to it",
    })

  const centeredHeadings = [...text.matchAll(/<h2[^>]*(?:text-align:\s*center|class="[^"]*\btext-center\b[^"]*")[^>]*>/gi)].length
  if (centeredHeadings >= CENTERED_HEADING_MIN)
    push({
      rule: "UNIFORM_CENTERED_HEADINGS",
      severity: "warning",
      evidence: `${centeredHeadings} centered h2 headings`,
      fix: "vary section composition: left-align sections, change scale or kicker treatment; one centered moment per viewport",
    })

  const kickerPairs = [...text.matchAll(kickerHeadingPair)].length
  if (kickerPairs >= KICKER_FORMULA_MIN)
    push({
      rule: "KICKER_TITLE_FORMULA",
      severity: "warning",
      evidence: `${kickerPairs} kicker+heading pairs`,
      fix: "drop the repeated eyebrow-over-heading formula; let sections open differently by content",
    })

  const label = formLabelEvidence(text)
  if (label)
    push({
      rule: "FORM_LABEL_HEADING_TREATMENT",
      severity: "warning",
      evidence: label.replace(/\s+/g, " ").trim().slice(0, 60),
      fix: "style form labels as UI copy at reading size in the body face, not as display headlines",
    })

  for (const candidate of [...proseCandidates(text), ...styleCandidates(text)]) {
    if (!findings.some((existing) => existing.rule === candidate.rule))
      findings.push(candidate)
  }
  return findings
}

export function scanArtifact(text: string): SlopFinding[] {
  const proseRules = new Set<string>([
    ...PROSE_CANDIDATES.map(([rule]) => rule),
    "P-ocx-jargon",
    "P-emdash-density",
    "P-repeat-opener",
    ...STYLE_RULES,
  ])
  const findings = scanText(text).filter((finding) => !proseRules.has(finding.rule))
  return findings.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "blocker" ? -1 : 1))
}

export function directive(findings: readonly SlopFinding[]): string | undefined {
  if (findings.length === 0) return undefined
  const lines = [
    "=== OCX OUTPUT GATE ===",
    `The latest output trips ${findings.length} banned-pattern check${findings.length === 1 ? "" : "s"}.`,
    "Fix each item before you finish, or justify the exception in the final summary.",
    ...findings.map((finding) => `- ${finding.rule} (${finding.severity}): "${finding.evidence}" -> ${finding.fix}`),
    "=== END OCX OUTPUT GATE ===",
  ]
  return lines.join("\n")
}

type GateMessage = {
  readonly info: { readonly role: string }
  readonly parts: ReadonlyArray<{ readonly type: string; readonly text?: string }>
}

const thrashMarkers = /\b(?:actually|wait|let me try|on second thought|scratch that|never ?mind)\b/gi
const thrashThreshold = 8

export function reasoningThrashFeedback(messages: ReadonlyArray<GateMessage>): string | undefined {
  const lastAssistant = messages.findLast((message) => message.info.role === "assistant")
  const reasoning = (lastAssistant?.parts ?? [])
    .filter((part) => part.type === "reasoning")
    .map((part) => part.text ?? "")
    .join("\n")
  if (!reasoning) return undefined
  const count = [...reasoning.matchAll(thrashMarkers)].length
  if (count < thrashThreshold) return undefined
  return [
    "=== OCX REASONING GUARD ===",
    `Your thinking cycled ${count} times this turn ("actually", "let me try", ...).`,
    "Pick the most promising approach and carry it through. If it fails twice, state the fallback you will ship instead and switch once. Do not keep re-deriving the same plan.",
    "=== END OCX REASONING GUARD ===",
  ].join("\n")
}

const minScanLength = 80

function extractScanTexts(parts: ReadonlyArray<unknown>): string[] {
  const texts: string[] = []
  for (const part of parts) {
    if (!part || typeof part !== "object") continue
    const p = part as Record<string, unknown>
    if (p.type === "text" && typeof p.text === "string") {
      texts.push(p.text)
    } else if (p.type === "tool" && p.state && typeof p.state === "object") {
      const state = p.state as Record<string, unknown>
      const input = state.input && typeof state.input === "object" ? (state.input as Record<string, unknown>) : undefined
      if (input) {
        if (typeof input.content === "string") texts.push(input.content)
        if (typeof input.newString === "string") texts.push(input.newString)
        if (typeof input.patch === "string") texts.push(input.patch)
      }
    }
  }
  return texts
}

export function gateDirectiveFromMessages(messages: ReadonlyArray<GateMessage>): string | undefined {
  const lastUser = messages.findLast((message) => message.info.role === "user")
  if (!lastUser) return undefined
  const start = messages.indexOf(lastUser)
  const text = messages
    .slice(start + 1)
    .flatMap((message) => (message.info.role === "assistant" ? extractScanTexts(message.parts) : []))
    .join("\n")
  if (text.trim().length < minScanLength) return undefined
  return directive(scanText(text))
}

export * as OCXGate from "./slop-gate"

// ── Async SDK-based scanning ─────────────────────────────────────────────────

export function scanTextAsync(text: string): Effect.Effect<SlopFinding[], never> {
  return SemanticSlop.detectSlopSemantic(text)
}

export function gateDirectiveFromMessagesAsync(
  messages: ReadonlyArray<GateMessage>,
): Effect.Effect<string | undefined, never> {
  const lastUser = messages.findLast((message) => message.info.role === "user")
  if (!lastUser) return Effect.succeed(undefined)
  const start = messages.indexOf(lastUser)
  const text = messages
    .slice(start + 1)
    .flatMap((message) => (message.info.role === "assistant" ? extractScanTexts(message.parts) : []))
    .join("\n")
  if (text.trim().length < minScanLength) return Effect.succeed(undefined)
  return scanTextAsync(text).pipe(Effect.map((findings) => directive(findings)))
}
