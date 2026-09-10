
export type Breakpoint = {
  readonly width: number
  readonly columns: number
  readonly layout: "sidebar-main" | "main-only" | "stacked" | "tabs" | "drawer"
}

export type ResponsiveResult = {
  readonly breakpoint: number
  readonly columns: number
  readonly layout: string
  readonly overflow: boolean
  readonly density: "low" | "medium" | "high"
}

export const DEFAULT_BREAKPOINTS: readonly Breakpoint[] = [
  { width: 360, columns: 2, layout: "stacked" },
  { width: 390, columns: 2, layout: "stacked" },
  { width: 768, columns: 4, layout: "tabs" },
  { width: 1024, columns: 8, layout: "sidebar-main" },
  { width: 1440, columns: 12, layout: "sidebar-main" },
  { width: 1920, columns: 12, layout: "sidebar-main" },
]

export function simulateResponsive(
  elements: readonly { readonly id: string; readonly width: number; readonly minWidth?: number }[],
  breakpoints: readonly Breakpoint[] = DEFAULT_BREAKPOINTS,
): readonly ResponsiveResult[] {
  return breakpoints.map((bp) => {
    const overflow = elements.some((el) => (el.minWidth ?? el.width) > bp.width)
    const totalWidth = elements.reduce((sum, el) => sum + el.width, 0)
    const columns = Math.max(1, Math.floor(bp.width / 200))
    const density = totalWidth > bp.width * 0.8 ? "high" : totalWidth > bp.width * 0.5 ? "medium" : "low"

    return {
      breakpoint: bp.width,
      columns,
      layout: bp.layout,
      overflow,
      density,
    }
  })
}

