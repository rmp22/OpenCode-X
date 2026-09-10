
export type CoherenceResult = {
  readonly coherent: boolean
  readonly conflicts: readonly string[]
  readonly warnings: readonly string[]
}

export function checkCoherence(
  theme: { readonly density: string; readonly shape: string; readonly color: string; readonly typography: string; readonly motion: string },
  candidate: { readonly shape?: string; readonly color?: string; readonly typography?: string; readonly density?: string; readonly motion?: string },
): CoherenceResult {
  const conflicts: string[] = []
  const warnings: string[] = []

  if (candidate.shape && theme.shape !== candidate.shape) {
    conflicts.push(`shape "${candidate.shape}" conflicts with theme shape "${theme.shape}"`)
  }
  if (candidate.density && theme.density !== candidate.density) {
    conflicts.push(`density "${candidate.density}" conflicts with theme density "${theme.density}"`)
  }
  if (candidate.color && theme.color !== candidate.color) {
    warnings.push(`color "${candidate.color}" may conflict with theme color "${theme.color}"`)
  }
  if (candidate.motion && theme.motion !== candidate.motion) {
    warnings.push(`motion "${candidate.motion}" may conflict with theme motion "${theme.motion}"`)
  }

  return {
    coherent: conflicts.length === 0,
    conflicts,
    warnings,
  }
}

