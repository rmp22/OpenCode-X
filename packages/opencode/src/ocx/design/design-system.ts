export * as DesignSystem from "./design-system"

export type DesignSystemLayer = {
  readonly spacing: SpacingSystem
  readonly typography: TypographySystem
  readonly color: ColorSystem
  readonly radius: RadiusSystem
  readonly elevation: ElevationSystem
  readonly density: DensitySystem
  readonly motion: MotionSystem
  readonly layout: LayoutSystem
  readonly components: readonly string[]
  readonly tokens: readonly DesignToken[]
}

export type SpacingSystem = {
  readonly base: number
  readonly scale: readonly number[]
  readonly tokens: Record<string, number>
}

export type TypographySystem = {
  readonly fontFamily: string
  readonly monoFamily: string
  readonly sizes: Record<string, number>
  readonly weights: Record<string, number>
  readonly lineHeights: Record<string, number>
  readonly letterSpacings: Record<string, number>
  readonly roles: readonly string[]
}

export type ColorSystem = {
  readonly base: string
  readonly roles: Record<string, string>
  readonly semantic: Record<string, string>
  readonly surface: Record<string, string>
  readonly border: Record<string, string>
}

export type RadiusSystem = {
  readonly sm: number
  readonly md: number
  readonly lg: number
  readonly xl: number
  readonly full: number
}

export type ElevationSystem = {
  readonly levels: readonly number[]
  readonly shadows: Record<string, string>
}

export type DensitySystem = {
  readonly level: "low" | "medium" | "medium-high" | "high"
  readonly rowHeight: number
  readonly padding: number
  readonly gap: number
}

export type MotionSystem = {
  readonly duration: Record<string, number>
  readonly easing: string
  readonly reducedMotion: boolean
}

export type LayoutSystem = {
  readonly gridColumns: number
  readonly maxWidth: number
  readonly breakpoints: Record<string, number>
  readonly gutters: number
}

export type DesignToken = {
  readonly name: string
  readonly value: string | number
  readonly category: string
  readonly description?: string
}

export function createDefaultDesignSystem(): DesignSystemLayer {
  return {
    spacing: {
      base: 4,
      scale: [0, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96],
      tokens: { "4": 4, "8": 8, "12": 12, "16": 16, "20": 20, "24": 24, "32": 32, "40": 40, "48": 48, "64": 64, "80": 80, "96": 96 },
    },
    typography: {
      fontFamily: "system-ui, -apple-system, sans-serif",
      monoFamily: "ui-monospace, SFMono-Regular, monospace",
      sizes: { display: 32, headline: 24, title: 18, body: 14, label: 12, caption: 11, code: 13 },
      weights: { display: 700, headline: 600, title: 600, body: 400, label: 500, caption: 400, code: 400 },
      lineHeights: { display: 1.2, headline: 1.3, title: 1.4, body: 1.5, label: 1.4, caption: 1.4, code: 1.5 },
      letterSpacings: { display: -0.02, headline: 0, title: 0, body: 0, label: 0.01, caption: 0.02, code: 0 },
      roles: ["display", "headline", "title", "body", "label", "caption", "code"],
    },
    color: {
      base: "#ffffff",
      roles: { primary: "#0066ff", secondary: "#6c757d", accent: "#00a878", warning: "#ffaa00", error: "#ff4444", success: "#00aa55" },
      semantic: { bg: "#ffffff", surface: "#f5f5f5", border: "#dee2e6", text: "#212529", muted: "#6c757d" },
      surface: { default: "#ffffff", hover: "#f8f9fa", active: "#e9ecef", disabled: "#f8f9fa" },
      border: { default: "#dee2e6", focus: "#0066ff", error: "#ff4444" },
    },
    radius: { sm: 4, md: 8, lg: 12, xl: 16, full: 9999 },
    elevation: { levels: [0, 1, 2, 4, 8, 16], shadows: { 1: "0 1px 2px rgba(0,0,0,0.05)", 2: "0 2px 4px rgba(0,0,0,0.1)", 4: "0 4px 8px rgba(0,0,0,0.12)", 8: "0 8px 16px rgba(0,0,0,0.15)", 16: "0 16px 32px rgba(0,0,0,0.2)" } },
    density: { level: "medium", rowHeight: 32, padding: 12, gap: 8 },
    motion: { duration: { fast: 150, normal: 250, slow: 400 }, easing: "cubic-bezier(0.4, 0, 0.2, 1)", reducedMotion: false },
    layout: { gridColumns: 12, maxWidth: 1200, breakpoints: { sm: 640, md: 768, lg: 1024, xl: 1280 }, gutters: 24 },
    components: [],
    tokens: [],
  }
}

export function adaptDesignSystem(system: DesignSystemLayer, intent: { readonly density: string; readonly platform: string; readonly character: string }): DesignSystemLayer {
  const density = intent.density as "low" | "medium" | "medium-high" | "high" | undefined
  const adaptedSpacing = density === "high"
    ? { ...system.spacing, tokens: { "2": 2, "4": 4, "8": 8, "12": 12, "16": 16, "20": 20, "24": 24 } }
    : density === "low"
      ? { ...system.spacing, tokens: { "4": 4, "8": 8, "12": 12, "16": 16, "20": 20, "24": 24, "32": 32, "40": 40, "48": 48, "64": 64, "80": 80, "96": 96 } }
      : system.spacing
  const adaptedDensity = density === "high"
    ? { level: "high" as const, rowHeight: 28, padding: 8, gap: 4 }
    : density === "low"
      ? { level: "low" as const, rowHeight: 40, padding: 16, gap: 12 }
      : system.density
  const adaptedLayout = intent.platform === "mobile"
    ? { ...system.layout, maxWidth: 480, breakpoints: { sm: 320, md: 375, lg: 768, xl: 1024 } }
    : system.layout
  const adaptedTypography = intent.character === "technical" || intent.character.includes("precise")
    ? { ...system.typography, fontFamily: "system-ui, -apple-system, sans-serif", monoFamily: "ui-monospace, SFMono-Regular, monospace" }
    : system.typography

  return {
    ...system,
    spacing: adaptedSpacing,
    density: adaptedDensity,
    layout: adaptedLayout,
    typography: adaptedTypography,
  }
}

export function validateDesignSystem(system: DesignSystemLayer): readonly string[] {
  const issues: string[] = []
  if (system.typography.sizes.display <= system.typography.sizes.headline) issues.push("display size must be larger than headline")
  if (system.typography.sizes.body <= system.typography.sizes.caption) issues.push("body size must be larger than caption")
  if (system.spacing.base < 2) issues.push("spacing base should be at least 2")
  if (system.radius.sm < 0 || system.radius.md < system.radius.sm) issues.push("radius values must be non-negative and ascending")
  if (system.density.rowHeight < 20) issues.push("row height should be at least 20px for touch targets")
  return issues
}
