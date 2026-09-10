import type { DesignIntent } from "./intent"
import type { Box } from "./spatial"

export type DesignCritique = {
  readonly hierarchyOk: boolean
  readonly alignmentOk: boolean
  readonly spacingOk: boolean
  readonly densityOk: boolean
  readonly coherenceOk: boolean
  readonly issues: readonly string[]
}

/**
 * Geometry-level critique only. Taste, hierarchy meaning, density suitability and
 * product character are semantic review concerns because a box tree cannot infer them.
 */
export function critique(
  _intent: DesignIntent,
  boxTree: Box,
  tokens: { readonly spacing: readonly number[]; readonly typography: readonly string[] },
): DesignCritique {
  const issues: string[] = []
  const invalidGeometry = flatten(boxTree).filter((box) => box.width < 0 || box.height < 0)
  if (invalidGeometry.length > 0) issues.push(`${invalidGeometry.length} element(s) have invalid negative dimensions`)

  const negativePositions = flatten(boxTree).filter((box) => box.x < 0)
  if (negativePositions.length > 0) issues.push(`${negativePositions.length} element(s) extend left of the layout origin`)

  const spacingTokens = tokens.spacing.filter((value) => Number.isFinite(value) && value >= 0)
  if (spacingTokens.length === 0) issues.push("no usable spacing scale is available")

  return {
    hierarchyOk: true,
    alignmentOk: negativePositions.length === 0,
    spacingOk: spacingTokens.length > 0,
    densityOk: true,
    coherenceOk: issues.length === 0,
    issues,
  }
}

function flatten(root: Box): readonly Box[] {
  return [root, ...root.children.flatMap((child) => flatten(child))]
}
