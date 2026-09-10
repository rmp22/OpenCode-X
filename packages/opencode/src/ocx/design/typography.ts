
export type TypographyToken = {
  readonly role: "display" | "headline" | "title" | "body" | "label" | "caption" | "code"
  readonly size: number
  readonly weight: string
  readonly lineHeight: number
  readonly letterSpacing: number
  readonly usage: string
}

export type TypographySystem = {
  readonly fontFamily: string
  readonly monoFamily: string
  readonly sizes: Record<string, number>
  readonly weights: Record<string, number>
  readonly lineHeights: Record<string, number>
  readonly letterSpacings: Record<string, number>
  readonly roles: readonly string[]
  readonly tokens: readonly TypographyToken[]
}

export function createDefaultTypographySystem(): TypographySystem {
  return {
    fontFamily: "system-ui, -apple-system, sans-serif",
    monoFamily: "ui-monospace, SFMono-Regular, monospace",
    sizes: { display: 32, headline: 24, title: 18, body: 14, label: 12, caption: 11, code: 13 },
    weights: { display: 700, headline: 600, title: 600, body: 400, label: 500, caption: 400, code: 400 },
    lineHeights: { display: 1.2, headline: 1.3, title: 1.4, body: 1.5, label: 1.4, caption: 1.4, code: 1.5 },
    letterSpacings: { display: -0.02, headline: 0, title: 0, body: 0, label: 0.01, caption: 0.02, code: 0 },
    roles: ["display", "headline", "title", "body", "label", "caption", "code"],
    tokens: [
      { role: "display", size: 32, weight: "700", lineHeight: 1.2, letterSpacing: -0.02, usage: "page titles" },
      { role: "headline", size: 24, weight: "600", lineHeight: 1.3, letterSpacing: 0, usage: "section headings" },
      { role: "title", size: 18, weight: "600", lineHeight: 1.4, letterSpacing: 0, usage: "component titles" },
      { role: "body", size: 14, weight: "400", lineHeight: 1.5, letterSpacing: 0, usage: "primary text" },
      { role: "label", size: 12, weight: "500", lineHeight: 1.4, letterSpacing: 0.01, usage: "form labels" },
      { role: "caption", size: 11, weight: "400", lineHeight: 1.4, letterSpacing: 0.02, usage: "helper text" },
      { role: "code", size: 13, weight: "400", lineHeight: 1.5, letterSpacing: 0, usage: "code snippets" },
    ],
  }
}

export function validateTypography(system: TypographySystem): readonly string[] {
  const issues: string[] = []
  if (system.sizes.display <= system.sizes.headline) issues.push("display size must be larger than headline")
  if (system.sizes.body <= system.sizes.caption) issues.push("body size must be larger than caption")
  if (system.tokens.length > 7) issues.push("too many typography roles; consolidate to 5-7")
  return issues
}

