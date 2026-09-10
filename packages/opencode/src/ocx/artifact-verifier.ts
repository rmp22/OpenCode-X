import path from "node:path"
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { Duration, Effect, Stream } from "effect"
import { LLMEvent } from "@opencode-ai/llm"
import type { LLM } from "@/session/llm"
import type { Provider } from "@/provider/provider"
import type { SessionV1 } from "@opencode-ai/core/v1/session"

export type ArtifactFinding = {
  readonly id: string
  readonly message: string
  readonly span?: string
}

type Input = {
  readonly cwd: string
  readonly changed: readonly string[]
  readonly reply: string
  readonly userPrompt?: string
  readonly toolEvidence?: readonly { readonly name: string; readonly completed: boolean; readonly hasEvidence: boolean }[]
}

export type SemanticVerificationInput = Input & {
  readonly llm?: LLM.Interface
  readonly model?: Provider.Model
  readonly user?: SessionV1.User
  readonly sessionID?: string
  readonly timeoutMs?: number
  readonly enabled?: boolean
}

const WEB_SOURCE = /\.(?:html?|css|js|jsx|mjs|ts|tsx)$/i
const FONT = /\.(?:woff2?|ttf|otf)$/i
const ASSET = /\.(?:avif|gif|jpe?g|png|svg|webp|woff2?|ttf|otf)$/i
const MOTION = /requestAnimationFrame|addEventListener\s*\(\s*["']scroll|(?:animation|transition)\s*:|style\.transform/i
const REDUCED_MOTION = /prefers-reduced-motion/i
const PLACEHOLDER_LINK = /\bhref\s*=\s*["'](?:#|javascript:void\(0\))["']/gi
const INTERACTIVE = /<(?:a|button|input|select|textarea)\b/i
const FOCUS_STYLE = /:(?:focus|focus-visible)\b/i
const FIXED_OVERLAY = /position\s*:\s*(?:fixed|sticky)\b/i

function text(pathValue: string): string | undefined {
  try {
    return readFileSync(pathValue, "utf8")
  } catch {
    return undefined
  }
}

function relative(cwd: string, value: string): string {
  const rel = path.relative(cwd, value)
  return rel && !rel.startsWith("..") ? rel : value
}

function walk(root: string, maxFiles = 160): string[] {
  if (!existsSync(root)) return []
  const found: string[] = []
  const pending = [root]
  while (pending.length > 0 && found.length < maxFiles) {
    const current = pending.shift()!
    let names: string[]
    try {
      names = readdirSync(current)
    } catch {
      continue
    }
    for (const name of names) {
      if (found.length >= maxFiles) break
      const item = path.join(current, name)
      try {
        if (statSync(item).isDirectory()) pending.push(item)
        else found.push(item)
      } catch {
        continue
      }
    }
  }
  return found
}

function validFont(pathValue: string): boolean {
  let data: Buffer
  try {
    data = readFileSync(pathValue)
  } catch {
    return false
  }
  if (data.length < 4) return false
  const magic = data.subarray(0, 4)
  const ascii = magic.toString("ascii")
  if (/\.woff2$/i.test(pathValue)) return ascii === "wOF2"
  if (/\.woff$/i.test(pathValue)) return ascii === "wOFF"
  if (/\.otf$/i.test(pathValue)) return ascii === "OTTO"
  if (/\.ttf$/i.test(pathValue))
    return magic.equals(Buffer.from([0x00, 0x01, 0x00, 0x00])) || ascii === "true" || ascii === "typ1"
  return true
}

function validImage(pathValue: string): boolean {
  let data: Buffer
  try {
    data = readFileSync(pathValue)
  } catch {
    return false
  }
  if (data.length < 12) return false
  if (/\.jpe?g$/i.test(pathValue)) return data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff
  if (/\.png$/i.test(pathValue)) return data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  if (/\.gif$/i.test(pathValue)) return data.subarray(0, 4).toString("ascii") === "GIF8"
  if (/\.webp$/i.test(pathValue)) return data.subarray(0, 4).toString("ascii") === "RIFF" && data.subarray(8, 12).toString("ascii") === "WEBP"
  return true
}

function htmlReferences(content: string): Set<string> {
  const refs = new Set<string>()
  const pattern = /(?:src|href)\s*=\s*["']([^"'#?]+)["']|url\(\s*["']?([^"')?#]+)["']?\s*\)/gi
  for (const match of content.matchAll(pattern)) {
    const value = (match[1] ?? match[2])?.trim()
    if (value && !/^(?:https?:|data:|mailto:|tel:)/i.test(value)) refs.add(normalizeReference(value))
  }
  return refs
}

function normalizeReference(value: string): string {
  return value.replace(/^\.\//, "").replace(/^\/+/, "")
}

function citedNames(content: string): string[] {
  return [...content.matchAll(/<cite\b[^>]*>([\s\S]*?)<\/cite>/gi)]
    .map((match) => match[1]?.replace(/<[^>]+>/g, "").replace(/^[\s—-]+/, "").trim() ?? "")
    .filter(Boolean)
}

function blockquoteAttributions(content: string): string[] {
  const out: string[] = []
  for (const match of content.matchAll(
    /<blockquote[\s\S]*?<\/blockquote>[\s\S]{0,1200}?<(?:span|p|div|figcaption)[^>]*>([^<]{3,120})<\/(?:span|p|div|figcaption)>/gi,
  )) {
    const value = match[1]?.trim() ?? ""
    if (/[A-Z][a-z]+,\s*[A-Z]|[—–-]\s*[A-Z][a-z]+/.test(value) && !out.includes(value)) out.push(value)
  }
  return out
}

function demoContentAllowed(prompt?: string): boolean {
  if (!prompt) return false
  return /\b(?:fictional|invented|mock content|sample (?:content|testimonial)|placeholder testimonial|test data)\b/i.test(prompt)
}

export function verify(input: Input): ArtifactFinding[] {
  const findings: ArtifactFinding[] = []
  const changed = input.changed.map((value) => path.resolve(input.cwd, value))
  const webFiles = changed.filter((value) => WEB_SOURCE.test(value))
  const htmlFiles = webFiles.filter((value) => /\.html?$/i.test(value))
  const contents = webFiles.flatMap((file) => {
    const value = text(file)
    return value === undefined ? [] : [{ file, value }]
  })
  const combined = contents.map((item) => item.value).join("\n")

  for (const { file, value } of contents) {
    if (/\.html?$/i.test(file)) {
      const placeholders = [...value.matchAll(PLACEHOLDER_LINK)]
      if (placeholders.length > 0)
        findings.push({
          id: "UI-DEAD-LINK",
          message: `${relative(input.cwd, file)} contains ${placeholders.length} placeholder link(s); remove the control, wire a real destination, or render an honest unavailable state`,
          span: placeholders[0]?.[0],
        })

      const names = [...citedNames(value), ...blockquoteAttributions(value)]
      if (names.length > 0 && !demoContentAllowed(input.userPrompt)) {
        const promptLower = input.userPrompt?.toLocaleLowerCase() ?? ""
        const unsupported = names.filter((name) => !promptLower.includes(name.toLocaleLowerCase()))
        if (unsupported.length > 0)
          findings.push({
            id: "UI-UNVERIFIED-TESTIMONIAL",
            message: `${relative(input.cwd, file)} presents testimonial-like attribution not supplied by the user or source evidence: ${unsupported.slice(0, 3).join(", ")}`,
            span: unsupported[0],
          })
      }
    }
  }

  if (MOTION.test(combined) && !REDUCED_MOTION.test(combined))
    findings.push({
      id: "UI-REDUCED-MOTION",
      message: "motion is implemented but no prefers-reduced-motion fallback was found in the changed web source",
    })

  if (INTERACTIVE.test(combined) && !FOCUS_STYLE.test(combined))
    findings.push({
      id: "UI-MISSING-FOCUS-STYLE",
      message: "interactive web controls were found without a focus or focus-visible style in the changed source",
    })

  const FAKE_PARALLAX_NAME = /@keyframes\s+[-\w]*?(?:kenburns|herozoom|zoom)[-\w]*/i
  const FAKE_PARALLAX_USE = /animation\s*:[^;]*?[-\w]*?(?:kenburns|herozoom|zoom)/i
  const SCROLL_PARALLAX_PROOF =
    /animation-timeline\s*:\s*scroll|background-attachment\s*:\s*fixed|addEventListener\s*\(\s*["']scroll/i
  if ((FAKE_PARALLAX_NAME.test(combined) || FAKE_PARALLAX_USE.test(combined)) && !SCROLL_PARALLAX_PROOF.test(combined)) {
    findings.push({
      id: "UI-FAKE-PARALLAX",
      message: "continuous CSS keyframe zoom animation detected as substitute for parallax; parallax requires scroll-driven or scroll-event translation",
    })
  }

  const FAKE_SUCCESS =
    /(?:onsubmit|onclick)\s*=\s*["'][^"']*preventDefault\(\)[^"']*(?:innerHTML|innerText)\s*=|this\.(?:innerHTML|innerText)\s*=\s*['"][^'"]*(?:Message sent|Request sent|success|be in touch)/i
  if (FAKE_SUCCESS.test(combined)) {
    findings.push({
      id: "UI-FAKE-SUCCESS",
      message: "client-only success message detected without network or persistence; wire real submission or render an honest unavailable state",
    })
  }

  const STAT_NUMBER = /(?:data-count\s*=\s*"\d+"|class\s*=\s*"[^"]*\bstat-num\b[^"]*"[^>]*>\s*\d+)/i
  if (STAT_NUMBER.test(combined) && !/data-source\s*=/i.test(combined) && !demoContentAllowed(input.userPrompt)) {
    findings.push({
      id: "UI-FABRICATED-NUMBER",
      message: "page statistics are presented without a data-source attribute or user-supplied evidence; cite the source or mark the numbers as illustrative",
    })
  }

  const fragmentLabels = new Map<string, Set<string>>()
  for (const match of combined.matchAll(/<a\b[^>]*\bhref\s*=\s*["'](#[A-Za-z][\w-]*)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = match[1]!.toLowerCase()
    const label = (match[2] ?? "").replace(/<[^>]+>/g, "").trim().toLowerCase()
    if (!label) continue
    const labels = fragmentLabels.get(href) ?? new Set<string>()
    labels.add(label)
    fragmentLabels.set(href, labels)
  }
  const misdirected = [...fragmentLabels.entries()].find(([, labels]) => labels.size >= 3)
  if (misdirected)
    findings.push({
      id: "UI-MISDIRECTED-LINK",
      message: `distinct links (${[...misdirected[1]].slice(0, 4).join(", ")}) share one fragment destination ${misdirected[0]}; give each link a real destination or render an honest unavailable state`,
      span: misdirected[0],
    })

  const WISPY_HEADING = /(?:h[1-6]|\.(?:hero|section|card)-title|\.cta-section\s+h[1-6])[^{]*\{[^}]*font-weight\s*:\s*300\b/i
  if (WISPY_HEADING.test(combined)) {
    findings.push({
      id: "UI-WISPY-HEADING",
      message: "headings using thin font-weight: 300 wash out on backgrounds; use deliberate weights (500-700) for headers",
    })
  }

  const AI_SLOP_SLOGANS = /(?:houses?\s+that\s+hold\s+you\s+briefly|a\s+house\s+that\s+understands\s+time|not\s+a\s+brand\.\s+it\s+is\s+a\s+way|the\s+silence\s+has\s+a\s+texture|homes?\s+designed\s+to\s+be\s+left\s+behind|stay\s+once[.,]\s*leave\s+differently|stay\s+briefly[.,]\s*remember\s+long\s+after|quiet\s+that\s+feels\s+borrowed|homes?\s+for\s+the\s+in-between|the\s+phone\s+that\s+thinks|not\s+a\s+tool[.,]\s*a\s+partner|built\s+for\s+intelligence|numbers\s+matter[.,]\s*but\s+context\s+matters\s+more)/i
  if (AI_SLOP_SLOGANS.test(combined)) {
    findings.push({
      id: "UI-AI-SLOP-COPY",
      message: "pretentious poetic AI slogans detected; replace with authentic commercial copy containing real specifications, nightly pricing, and amenities",
    })
  }

  const projectRoots = new Set(htmlFiles.map((file) => path.dirname(file)))
  for (const root of projectRoots) {
    const sources = walk(root, 160).filter((value) => WEB_SOURCE.test(value))
    const sourceText = sources.map((file) => text(file) ?? "").join("\n")
    const refs = htmlReferences(sourceText)
    for (const ref of refs) {
      if (ASSET.test(ref)) {
        const resolvedPath = path.resolve(root, ref)
        const cwdResolvedPath = path.resolve(input.cwd, ref)
        if (!existsSync(resolvedPath) && !existsSync(cwdResolvedPath)) {
          findings.push({
            id: "UI-MISSING-ASSET",
            message: `${ref} is referenced in markup/styles but does not exist on disk; download or generate the asset before delivering`,
            span: ref,
          })
        }
      }
    }
    const assetsRoot = path.join(root, "assets")
    for (const asset of walk(assetsRoot, 120).filter((value) => ASSET.test(value))) {
      const assetRel = path.relative(root, asset).replaceAll(path.sep, "/")
      const assetFromAssets = path.relative(assetsRoot, asset).replaceAll(path.sep, "/")
      if (FONT.test(asset) && !validFont(asset))
        findings.push({
          id: "UI-INVALID-FONT-ASSET",
          message: `${assetRel} does not match the binary signature required by its font extension`,
          span: assetRel,
        })
      if (/(?:avif|gif|jpe?g|png|webp)$/i.test(asset) && !validImage(asset))
        findings.push({
          id: "UI-INVALID-IMAGE-ASSET",
          message: `${assetRel} does not match the binary signature required by its image extension`,
          span: assetRel,
        })
      if (!refs.has(normalizeReference(assetRel)) && !refs.has(normalizeReference(assetFromAssets)) && !refs.has(normalizeReference(`assets/${assetFromAssets}`)))
        findings.push({
          id: "UI-UNUSED-ASSET",
          message: `${assetRel} is present under the page asset tree but is not referenced by the page source`,
          span: assetRel,
        })
    }
  }

  const hasVisualAuthority = (input.toolEvidence ?? []).some(
    (item) => item.completed && item.hasEvidence && /^(?:browser|screenshot|playwright|visual|screenshot-render|render-check)$/i.test(item.name),
  )
  if (!hasVisualAuthority && FIXED_OVERLAY.test(combined) && /\bSTATE:\s*done\b/i.test(input.reply))
    findings.push({
      id: "UI-OVERLAY-UNVERIFIED",
      message: "the artifact contains a fixed or sticky overlay but no successful scrolled render check was recorded",
    })
  if (
    !hasVisualAuthority &&
    /\b(?:visual(?:ly)?|responsive|render(?:ed|ing)?|layout)\b[^\n]{0,80}\b(?:pass(?:ed)?|verified|correct|works?)\b/i.test(
      input.reply,
    )
  )
    findings.push({
      id: "UI-VISUAL-CLAIM-WITHOUT-EVIDENCE",
      message: "the response claims rendered/responsive visual success without browser or screenshot evidence; report it as unverified instead",
    })

  return findings
}

export const BLOCKING_ARTIFACT_IDS = new Set([
  "UI-DEAD-LINK",
  "UI-UNVERIFIED-TESTIMONIAL",
  "UI-FAKE-SUCCESS",
  "UI-FAKE-PARALLAX",
  "UI-FABRICATED-NUMBER",
  "UI-MISDIRECTED-LINK",
  "UI-REDUCED-MOTION",
  "UI-MISSING-FOCUS-STYLE",
  "UI-MISSING-ASSET",
])

const REVIEW_PROMPT = `You are the OCX Artifact & Design Taste Verifier.
Review the supplied web artifacts against the user's request and world-class design taste standards.
Identify any visual craft flaws, AI slop, fake features, or accessibility defects.

INSPECTION CRITERIA:

1. Visual Craft & Typography:
- Reject thin/wispy font-weight 300 serif headings on dark or light surfaces that wash out and fail contrast. Headings (h1, h2, h3, card titles, section titles) must have confident weights (500–700) and high contrast against background (WCAG AA/AAA).
- Reject looping CSS keyframe zoom/scale animations (e.g. kenBurns, heroZoom) disguised as parallax. Real parallax requires scroll-driven or scroll-event translation.
- Reject uniform, repetitive card grids. Require varied scale, asymmetric Bento grids, or multi-column masonry.

2. Anti-Slop & Product Truth:
- Reject hollow, pretentious AI poetry slogans (e.g. "A house that understands time", "Houses that hold you briefly", "Transient is not a brand", "Homes designed to be left behind", "The silence has a texture").
- Require authentic commercial copy with transparent pricing (e.g. "$285 / night · 3 nights min"), specific amenities, real locations, and genuine booking details.
- Reject fabricated/invented testimonials and fake guest reviews (e.g. "— A guest, October 2025") not provided by the user.
- Reject dead links (href="#") or fake client-only success states ("this.innerText = 'Request sent'"). All CTAs must trigger real behavior (interactive booking modal/drawer, live price calculation, date selection, or real section anchor).

3. Accessibility & Motion:
- Require visible focus styles (:focus-visible) on all interactive controls.
- Require prefers-reduced-motion media query fallback when animations/transitions are used.
- Require meaningful alt text and declared dimensions on images.

Reply with JSON only:
{"findings": [{"id": "UI-AI-SLOP-COPY" | "UI-FAKE-PARALLAX" | "UI-FAKE-SUCCESS" | "UI-FABRICATED-NUMBER" | "UI-MISDIRECTED-LINK" | "UI-WISPY-HEADING" | "UI-DEAD-LINK" | "UI-UNVERIFIED-TESTIMONIAL" | "UI-MISSING-FOCUS-STYLE" | "UI-REDUCED-MOTION", "message": "concise description of issue and required fix", "span": "exact line or snippet"}]}`

function parseArtifactFindings(raw: string): ArtifactFinding[] {
  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return []
  try {
    const parsed = JSON.parse(jsonMatch[0])
    if (!Array.isArray(parsed.findings)) return []
    return parsed.findings
      .filter((item: any) => item && typeof item.message === "string")
      .map((item: any) => ({
        id: typeof item.id === "string" ? item.id : "UI-DESIGN-FLAW",
        message: item.message,
        ...(item.span ? { span: String(item.span).slice(0, 120) } : {}),
      }))
  } catch {
    return []
  }
}

export function verifySemantic(input: SemanticVerificationInput): Effect.Effect<ArtifactFinding[], never> {
  return Effect.gen(function* () {
    if (input.enabled !== true) return []
    const baseFindings = verify(input)
    if (!input.llm || !input.model || !input.user || !input.sessionID) {
      return baseFindings
    }

    const changed = input.changed.map((value) => path.resolve(input.cwd, value))
    const webFiles = changed.filter((value) => WEB_SOURCE.test(value))
    if (webFiles.length === 0) return baseFindings

    const filePayloads = webFiles
      .map((file) => {
        const content = text(file) ?? ""
        return `<file path="${relative(input.cwd, file)}">\n${content.slice(0, 12_000)}\n</file>`
      })
      .join("\n\n")

    const prompt = `${REVIEW_PROMPT}\n\n<user_request>\n${input.userPrompt}\n</user_request>\n\n<artifacts>\n${filePayloads}\n</artifacts>`

    const response = yield* Effect.suspend(() =>
      input.llm!
        .stream({
          user: input.user!,
          sessionID: input.sessionID!,
          model: input.model!,
          agent: {
            name: "ocx-artifact-verifier",
            mode: "primary" as const,
            hidden: true,
            native: true,
            temperature: 0.1,
            permission: [],
            options: {},
            prompt: "",
          },
          system: [],
          messages: [{ role: "user" as const, content: prompt }],
          tools: {},
          retries: 0,
        })
        .pipe(
          Stream.filter(LLMEvent.is.textDelta),
          Stream.map((event) => event.text),
          Stream.mkString,
          Effect.timeout(Duration.millis(input.timeoutMs ?? 15_000)),
          Effect.catch(() => Effect.succeed(undefined as string | undefined)),
        ),
    ).pipe(Effect.catchDefect(() => Effect.succeed(undefined as string | undefined)))

    if (!response) return baseFindings
    const semanticFindings = parseArtifactFindings(response)
    const existingIds = new Set(baseFindings.map((f) => f.id))
    const uniqueSemantic = semanticFindings.filter((f) => !existingIds.has(f.id))
    return [...baseFindings, ...uniqueSemantic]
  })
}

export * as ArtifactVerifier from "./artifact-verifier"
