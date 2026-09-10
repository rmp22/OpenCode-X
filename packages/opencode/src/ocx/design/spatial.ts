export * as SpatialReasoning from "./spatial"

export type Box = {
  readonly id: string
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly minWidth?: number
  readonly maxWidth?: number
  readonly minHeight?: number
  readonly maxHeight?: number
  readonly padding: { readonly top: number; readonly right: number; readonly bottom: number; readonly left: number }
  readonly margin: { readonly top: number; readonly right: number; readonly bottom: number; readonly left: number }
  readonly gap: number
  readonly alignment: "start" | "center" | "end" | "stretch" | "baseline"
  readonly baseline?: number
  readonly overflow: "visible" | "hidden" | "scroll" | "auto"
  readonly scrollBehavior: "none" | "smooth" | "auto"
  readonly responsive: ResponsiveBehavior
  readonly direction: "horizontal" | "vertical" | "grid" | "stack"
  readonly children: readonly Box[]
}

export type ResponsiveBehavior = {
  readonly breakpoints: readonly Breakpoint[]
  readonly collapseStrategy: "stack" | "hide" | "drawer" | "modal" | "collapse"
}

export type Breakpoint = {
  readonly width: number
  readonly columns: number
  readonly layout: "sidebar-main" | "main-only" | "stacked" | "tabs" | "drawer"
}

export type LayoutConstraint = {
  readonly type: "left-align" | "right-align" | "width-equal" | "height-equal" | "gap" | "center" | "baseline" | "span"
  readonly targetA: string
  readonly targetB?: string
  readonly value?: number
  readonly token?: string
}

export type AlignmentGroup = {
  readonly x: number
  readonly items: readonly string[]
}

export type SpacingRelationship = {
  readonly from: string
  readonly to: string
  readonly gap: number
  readonly role: "intra-group" | "inter-group" | "section" | "page"
}

export type VisualHierarchy = {
  readonly level: 1 | 2 | 3 | 4 | 5
  readonly id: string
  readonly size?: number
  readonly weight?: "light" | "regular" | "medium" | "bold" | "black"
  readonly contrast?: number
  readonly saturation?: number
  readonly position?: "primary" | "secondary" | "tertiary" | "decorative"
  readonly whitespace?: number
  readonly elevation?: number
}

export type TypographyToken = {
  readonly role: "display" | "headline" | "title" | "body" | "label" | "caption" | "code"
  readonly size: number
  readonly weight: string
  readonly lineHeight: number
  readonly letterSpacing: number
  readonly usage: string
}

export type DesignTokens = {
  readonly spacing: readonly number[]
  readonly typography: readonly TypographyToken[]
  readonly colorRoles: readonly string[]
  readonly radius: { readonly sm: number; readonly md: number; readonly lg: number; readonly xl: number }
  readonly elevation: readonly number[]
  readonly density: "low" | "medium" | "medium-high" | "high"
}

export type SpatialError = {
  readonly type: "overflow" | "collision" | "bad-gap" | "misalignment" | "touch-failure" | "text-risk" | "density-failure" | "bad-measure"
  readonly element: string
  readonly detail: string
  readonly severity: "error" | "warning" | "info"
}

export function buildBoxTree(id: string, children: readonly Box[]): Box {
  return {
    id,
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
    gap: 0,
    alignment: "stretch",
    overflow: "visible",
    scrollBehavior: "none",
    responsive: { breakpoints: [], collapseStrategy: "stack" },
    direction: "vertical",
    children,
  }
}

export function detectOverflow(box: Box, viewportWidth: number, viewportHeight: number): readonly SpatialError[] {
  const errors: SpatialError[] = []
  if (box.x + box.width > viewportWidth) {
    errors.push({ type: "overflow", element: box.id, detail: `right edge ${box.x + box.width} exceeds viewport ${viewportWidth}`, severity: "error" })
  }
  if (box.y + box.height > viewportHeight) {
    errors.push({ type: "overflow", element: box.id, detail: `bottom edge ${box.y + box.height} exceeds viewport ${viewportHeight}`, severity: "error" })
  }
  for (const child of box.children) {
    errors.push(...detectOverflow(child, viewportWidth, viewportHeight))
  }
  return errors
}

export function detectMisalignment(box: Box, tolerance: number = 4): readonly SpatialError[] {
  const errors: SpatialError[] = []
  const groups = collectAlignmentGroups(box)
  const boxMap = new Map(box.children.map((b) => [b.id, b]))
  for (const group of groups) {
    if (group.items.length < 2) continue
    const firstBox = boxMap.get(group.items[0])
    if (!firstBox) continue
    const firstX = firstBox.x
    for (const itemId of group.items) {
      const item = boxMap.get(itemId)
      if (!item) continue
      if (Math.abs(item.x - firstX) > tolerance) {
        errors.push({ type: "misalignment", element: item.id, detail: `x=${item.x} deviates from group x=${firstX} by ${Math.abs(item.x - firstX)}px`, severity: "error" })
      }
    }
  }
  for (const child of box.children) {
    errors.push(...detectMisalignment(child, tolerance))
  }
  return errors
}

function collectAlignmentGroups(box: Box): AlignmentGroup[] {
  const groups: AlignmentGroup[] = []
  const byX = new Map<number, Box[]>()
  for (const child of box.children) {
    const key = Math.round(child.x / 8) * 8
    const existing = byX.get(key) ?? []
    existing.push(child)
    byX.set(key, existing)
  }
  for (const [x, items] of byX) {
    if (items.length >= 2) {
      groups.push({ x, items: items.map((b) => b.id) })
    }
  }
  return groups
}

export function detectSpacingIssues(box: Box, tokens: readonly number[]): readonly SpatialError[] {
  const errors: SpatialError[] = []
  const gaps = collectGaps(box)
  for (const gap of gaps) {
    const isToken = tokens.some((t) => Math.abs(gap.gap - t) < 2)
    if (!isToken && gap.gap > 0) {
      errors.push({ type: "bad-gap", element: `${gap.from}->${gap.to}`, detail: `gap of ${gap.gap}px does not match any spacing token`, severity: "warning" })
    }
  }
  for (const child of box.children) {
    errors.push(...detectSpacingIssues(child, tokens))
  }
  return errors
}

function collectGaps(box: Box): SpacingRelationship[] {
  const gaps: SpacingRelationship[] = []
  for (let i = 0; i < box.children.length - 1; i++) {
    gaps.push({ from: box.children[i].id, to: box.children[i + 1].id, gap: box.children[i + 1].y - (box.children[i].y + box.children[i].height), role: "inter-group" })
  }
  return gaps
}

export function checkTouchTargets(box: Box, minSize: number = 44): readonly SpatialError[] {
  const errors: SpatialError[] = []
  if (box.width < minSize || box.height < minSize) {
    errors.push({ type: "touch-failure", element: box.id, detail: `size ${box.width}x${box.height} is below minimum ${minSize}x${minSize}`, severity: "error" })
  }
  for (const child of box.children) {
    errors.push(...checkTouchTargets(child, minSize))
  }
  return errors
}

export function checkTextRisk(box: Box, avgCharsPerLine: number = 80): readonly SpatialError[] {
  const errors: SpatialError[] = []
  const estimatedChars = Math.floor(box.width / 8)
  if (estimatedChars > avgCharsPerLine * 2) {
    errors.push({ type: "text-risk", element: box.id, detail: `estimated ${estimatedChars} chars exceeds recommended ${avgCharsPerLine * 2}`, severity: "warning" })
  }
  for (const child of box.children) {
    errors.push(...checkTextRisk(child, avgCharsPerLine))
  }
  return errors
}

export function checkDensityFailure(box: Box, maxItemsPerRow: number = 6): readonly SpatialError[] {
  const errors: SpatialError[] = []
  if (box.direction === "horizontal" && box.children.length > maxItemsPerRow) {
    errors.push({ type: "density-failure", element: box.id, detail: `${box.children.length} items in horizontal row exceeds max ${maxItemsPerRow}`, severity: "warning" })
  }
  for (const child of box.children) {
    errors.push(...checkDensityFailure(child, maxItemsPerRow))
  }
  return errors
}

export function simulateResponsive(box: Box, breakpoints: readonly number[]): Record<number, string> {
  const results: Record<number, string> = {}
  for (const bp of breakpoints) {
    const columns = bp >= 1024 ? 12 : bp >= 768 ? 8 : bp >= 360 ? 4 : 2
    const overflow = box.x + box.width > bp ? "overflow" : "fit"
    results[bp] = `${columns}col ${overflow}`
  }
  return results
}