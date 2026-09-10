export * as DesignIntent from "./intent"

export type DesignIntent = {
  readonly product: string
  readonly user: string
  readonly primaryAction: string
  readonly primaryInformation: string
  readonly frequency: "low" | "medium" | "high" | "constant"
  readonly expertise: "novice" | "intermediate" | "expert" | "mixed"
  readonly density: "low" | "medium" | "medium-high" | "high" | "compact"
  readonly decoration: "none" | "minimal" | "moderate" | "rich"
  readonly character: string
  readonly platform: string
  readonly devices: readonly string[]
  readonly accessibilityNeeds: readonly string[]
  readonly primary: readonly string[]
  readonly secondary: readonly string[]
  readonly tertiary: readonly string[]
}

export type IntentInput = {
  readonly product?: string
  readonly user?: string
  readonly primaryAction?: string
  readonly primaryInformation?: string
  readonly frequency?: string
  readonly expertise?: string
  readonly density?: string
  readonly decoration?: string
  readonly character?: string
  readonly platform?: string
  readonly devices?: readonly string[]
  readonly accessibilityNeeds?: readonly string[]
}

const DEFAULT_DENSITY_BY_PLATFORM: Record<string, DesignIntent["density"]> = {
  ide: "high",
  terminal: "high",
  settings: "medium-high",
  dashboard: "high",
  monitoring: "high",
  "mobile app": "medium",
  "consumer web": "medium",
  marketing: "medium",
  "developer tool": "high",
  "desktop utility": "high",
  "creative tool": "medium",
  "data table": "high",
  "admin panel": "high",
  "ecommerce": "medium",
  "social": "medium",
  "messaging": "medium",
  "finance": "medium",
  "game": "medium",
}

export function classifyIntent(input: IntentInput): DesignIntent {
  const product = input.product ?? "unknown"
  const user = input.user ?? "unknown"
  const platform = input.platform ?? "unknown"
  const frequency = parseFrequency(input.frequency)
  const expertise = parseExpertise(input.expertise)
  const density = parseDensity(input.density) ?? DEFAULT_DENSITY_BY_PLATFORM[product.toLowerCase()] ?? "medium"
  const decoration = parseDecoration(input.decoration) ?? "minimal"

  const primary = input.primaryInformation
    ? [input.primaryInformation]
    : input.primaryAction
      ? [input.primaryAction]
      : []

  return {
    product,
    user,
    primaryAction: input.primaryAction ?? "",
    primaryInformation: input.primaryInformation ?? "",
    frequency,
    expertise,
    density,
    decoration,
    character: input.character ?? inferCharacter(product, user),
    platform,
    devices: input.devices ?? [],
    accessibilityNeeds: input.accessibilityNeeds ?? [],
    primary,
    secondary: [],
    tertiary: [],
  }
}

function parseFrequency(value: string | undefined): DesignIntent["frequency"] {
  if (!value) return "medium"
  const lower = value.toLowerCase()
  if (lower === "constant" || lower === "continuous") return "constant"
  if (lower === "high" || lower === "frequent") return "high"
  if (lower === "low" || lower === "rare" || lower === "occasional") return "low"
  return "medium"
}

function parseExpertise(value: string | undefined): DesignIntent["expertise"] {
  if (!value) return "mixed"
  const lower = value.toLowerCase()
  if (lower === "expert" || lower === "advanced") return "expert"
  if (lower === "novice" || lower === "beginner") return "novice"
  if (lower === "intermediate") return "intermediate"
  return "mixed"
}

function parseDensity(value: string | undefined): DesignIntent["density"] | undefined {
  if (!value) return undefined
  const lower = value.toLowerCase()
  if (lower === "compact" || lower === "high") return "high"
  if (lower === "medium-high" || lower === "dense") return "medium-high"
  if (lower === "medium") return "medium"
  if (lower === "low") return "low"
  return undefined
}

function parseDecoration(value: string | undefined): DesignIntent["decoration"] | undefined {
  if (!value) return undefined
  const lower = value.toLowerCase()
  if (lower === "none") return "none"
  if (lower === "minimal" || lower === "restrained") return "minimal"
  if (lower === "moderate") return "moderate"
  if (lower === "rich" || lower === "heavy") return "rich"
  return undefined
}

function inferCharacter(product: string, user: string): string {
  const p = product.toLowerCase()
  if (p.includes("ide") || p.includes("editor") || p.includes("code")) return "technical, precise, quiet"
  if (p.includes("dashboard") || p.includes("monitor")) return "informative, dense, status-driven"
  if (p.includes("marketing") || p.includes("landing")) return "visual, spacious, persuasive"
  if (p.includes("settings") || p.includes("config")) return "functional, compact, clear"
  if (user === "developer") return "technical, precise, efficient"
  return "balanced, functional, clean"
}
