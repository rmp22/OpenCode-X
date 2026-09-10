
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

export function compileThemeBrief(intent: {
  readonly product: string
  readonly desiredFeeling: string
  readonly referenceFamily: string
  readonly density: string
  readonly surfaceStrategy: string
  readonly shape: string
  readonly color: string
  readonly typography: string
  readonly motion: string
}): ThemeBrief {
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

