export * as ReferenceRetrieval from "./retrieval"

export type ReferenceQuery = {
  readonly productType?: string
  readonly platform?: readonly string[]
  readonly density?: string
  readonly interactionModel?: string
  readonly visualCharacter?: readonly string[]
  readonly roles?: readonly string[]
  readonly tags?: readonly string[]
  readonly existingDesignSystem?: boolean
}

export type ReferenceResult = {
  readonly reference: HumanReference
  readonly score: number
  readonly usedFor: readonly string[]
}

export type ReferenceRole = "layout" | "typography" | "color" | "spacing" | "interaction" | "density" | "shape" | "elevation" | "motion" | "personality" | "anti-pattern" | "theme" | "component"

export type HumanReference = {
  readonly id: string
  readonly name: string
  readonly source: string
  readonly category: string
  readonly platform: readonly string[]
  readonly density: "low" | "medium" | "medium-high" | "high"
  readonly visualCharacter: readonly string[]
  readonly interactionModel: string
  readonly roles: readonly string[]
  readonly grammar: DesignGrammar
  readonly quality: ReferenceQuality
  readonly tags: readonly string[]
}

export type DesignGrammar = {
  readonly layout: readonly string[]
  readonly density: string
  readonly typography: readonly string[]
  readonly spacing: readonly string[]
  readonly color: readonly string[]
  readonly shape: string
  readonly elevation: string
  readonly motion: string
  readonly personality: string
  readonly antiPatterns: readonly string[]
}

export type ReferenceQuality = {
  readonly productFit: number
  readonly platformFit: number
  readonly interactionFit: number
  readonly usabilityQuality: number
  readonly visualCoherence: number
  readonly densityMatch: number
  readonly sourceQuality: number
  readonly relevance: number
  readonly accessibilityQuality: number
  readonly feasibility: number
}

export type ThemeBrief = {
  readonly product: string
  readonly desiredFeeling: string
  readonly referenceFamily: string
  readonly density: string
  readonly surfaceStrategy: string
  readonly shape: string
  readonly color: string
  readonly typography: string
  readonly motion: string
  readonly texture: string
  readonly decorativeElements: string
  readonly distinctiveElement: string
  readonly avoid: readonly string[]
}

const REFERENCE_LIBRARY: readonly HumanReference[] = [
  {
    id: "ref-vscode",
    name: "VS Code",
    source: "Microsoft",
    category: "developer tools",
    platform: ["web", "desktop"],
    density: "high",
    visualCharacter: ["technical", "precise", "quiet", "neutral"],
    interactionModel: "master-detail",
    roles: ["layout", "typography", "density", "interaction"],
    grammar: {
      layout: ["persistent sidebar", "large working canvas", "contextual panel on demand"],
      density: "high",
      typography: ["compact sans", "code mono for source", "small number of levels"],
      spacing: ["tight within groups", "larger between regions"],
      color: ["neutral surfaces", "accent for active state", "semantic for status"],
      shape: "low-to-medium radius",
      elevation: "minimal",
      motion: "brief and functional",
      personality: "technical, precise, quiet",
      antiPatterns: ["large hero", "floating glass cards", "decorative metric row"],
    },
    quality: { productFit: 0.95, platformFit: 0.9, interactionFit: 0.9, usabilityQuality: 0.95, visualCoherence: 0.9, densityMatch: 0.95, sourceQuality: 0.95, relevance: 0.95, accessibilityQuality: 0.85, feasibility: 0.95 },
    tags: ["ide", "editor", "developer", "technical"],
  },
  {
    id: "ref-apple-settings",
    name: "Apple Settings",
    source: "Apple",
    category: "settings",
    platform: ["ios", "macos"],
    density: "medium",
    visualCharacter: ["clean", "minimal", "neutral", "soft"],
    interactionModel: "settings",
    roles: ["layout", "typography", "spacing", "shape"],
    grammar: {
      layout: ["grouped sections", "clear hierarchy", "inline editing"],
      density: "medium",
      typography: ["system font", "clear hierarchy", "generous sizing"],
      spacing: ["generous between sections", "tight within groups"],
      color: ["system colors", "semantic status", "minimal accent"],
      shape: "rounded",
      elevation: "subtle",
      motion: "smooth and native",
      personality: "clean, minimal, human",
      antiPatterns: ["dense data tables", "excessive decoration"],
    },
    quality: { productFit: 0.9, platformFit: 0.95, interactionFit: 0.85, usabilityQuality: 0.95, visualCoherence: 0.95, densityMatch: 0.9, sourceQuality: 0.95, relevance: 0.9, accessibilityQuality: 0.95, feasibility: 0.9 },
    tags: ["settings", "apple", "platform", "native"],
  },
  {
    id: "ref-github",
    name: "GitHub",
    source: "GitHub/Microsoft",
    category: "productivity",
    platform: ["web"],
    density: "high",
    visualCharacter: ["neutral", "technical", "information-dense"],
    interactionModel: "feed",
    roles: ["layout", "typography", "density", "interaction"],
    grammar: {
      layout: ["left navigation", "main content area", "contextual panels"],
      density: "high",
      typography: ["system font stack", "clear hierarchy", "code in monospace"],
      spacing: ["compact rows", "clear section breaks"],
      color: ["neutral base", "blue accent", "semantic colors for status"],
      shape: "low radius",
      elevation: "minimal",
      motion: "subtle transitions",
      personality: "functional, information-rich",
      antiPatterns: ["excessive whitespace", "decorative gradients"],
    },
    quality: { productFit: 0.9, platformFit: 0.85, interactionFit: 0.85, usabilityQuality: 0.9, visualCoherence: 0.9, densityMatch: 0.95, sourceQuality: 0.95, relevance: 0.9, accessibilityQuality: 0.8, feasibility: 0.95 },
    tags: ["productivity", "feed", "information-dense", "web"],
  },
]

const CATEGORY_PRODUCT_MAP: Record<string, readonly string[]> = {
  "developer tools": ["ide", "terminal", "editor", "debugger", "build-tool"],
  "productivity": ["settings", "dashboard", "admin", "workspace"],
  "creative": ["canvas", "design", "video", "audio", "photo"],
  "communication": ["messaging", "social", "video", "email"],
  "commerce": ["ecommerce", "checkout", "catalog", "cart"],
  "finance": ["banking", "trading", "budget", "invoice"],
  "media": ["streaming", "music", "podcast", "video-player"],
  "system": ["file-manager", "terminal", "control-center", "preferences"],
}

export function retrieveReferences(query: ReferenceQuery): readonly ReferenceResult[] {
  const matches = REFERENCE_LIBRARY.filter((ref) => {
    if (query.productType && !ref.category.includes(query.productType.toLowerCase()) && !CATEGORY_PRODUCT_MAP[query.productType.toLowerCase()]?.some((c) => ref.category.includes(c))) return false
    if (query.platform && !query.platform.some((p) => ref.platform.includes(p.toLowerCase()))) return false
    if (query.density && ref.density !== query.density) return false
    if (query.roles && query.roles.some((r) => !ref.roles.includes(r))) return false
    if (query.tags && query.tags.some((t) => !ref.tags.includes(t.toLowerCase()))) return false
    return true
  })

  return matches
    .map((ref) => ({ reference: ref, score: scoreReference(ref, query), usedFor: ref.roles }))
    .sort((a, b) => b.score - a.score)
}

function scoreReference(ref: HumanReference, query: ReferenceQuery): number {
  let score = 0
  if (query.productType) {
    const cat = CATEGORY_PRODUCT_MAP[query.productType.toLowerCase()]
    if (cat && cat.some((c) => ref.category.includes(c))) score += 3
    if (ref.category.includes(query.productType.toLowerCase())) score += 2
  }
  if (query.platform) score += query.platform.filter((p) => ref.platform.includes(p.toLowerCase())).length
  if (query.density && ref.density === query.density) score += 1
  if (query.roles) score += query.roles.filter((r) => ref.roles.includes(r)).length
  if (query.tags) score += query.tags.filter((t) => ref.tags.includes(t.toLowerCase())).length
  return score + ref.quality.productFit * 0.5
}

export function extractGrammar(ref: HumanReference): DesignGrammar {
  return ref.grammar
}

export function synthesizeGrammar(references: readonly HumanReference[]): DesignGrammar {
  if (references.length === 0) return emptyGrammar()
  if (references.length === 1) return references[0].grammar
  return {
    layout: deduplicate(references.flatMap((r) => r.grammar.layout)),
    density: references[0].grammar.density,
    typography: deduplicate(references.flatMap((r) => r.grammar.typography)),
    spacing: deduplicate(references.flatMap((r) => r.grammar.spacing)),
    color: deduplicate(references.flatMap((r) => r.grammar.color)),
    shape: references[0].grammar.shape,
    elevation: references[0].grammar.elevation,
    motion: references[0].grammar.motion,
    personality: references[0].grammar.personality,
    antiPatterns: deduplicate(references.flatMap((r) => r.grammar.antiPatterns)),
  }
}

export function compileThemeBrief(intent: { readonly product: string; readonly desiredFeeling: string; readonly referenceFamily: string; readonly density: string; readonly surfaceStrategy: string; readonly shape: string; readonly color: string; readonly typography: string; readonly motion: string }): ThemeBrief {
  return {
    product: intent.product,
    desiredFeeling: intent.desiredFeeling,
    referenceFamily: intent.referenceFamily,
    density: intent.density,
    surfaceStrategy: intent.surfaceStrategy,
    shape: intent.shape,
    color: intent.color,
    typography: intent.typography,
    motion: intent.motion,
    texture: "none",
    decorativeElements: "minimal",
    distinctiveElement: "",
    avoid: ["generic SaaS dashboard language", "glassmorphism", "oversized cards", "marketing hero structure"],
  }
}

function deduplicate(items: readonly string[]): readonly string[] {
  return [...new Set(items)]
}

function emptyGrammar(): DesignGrammar {
  return { layout: [], density: "medium", typography: [], spacing: [], color: [], shape: "low radius", elevation: "minimal", motion: "functional", personality: "", antiPatterns: [] }
}