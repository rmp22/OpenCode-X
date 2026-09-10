
export type AlignmentGroup = {
  readonly x: number
  readonly items: readonly string[]
}

export type AlignmentFinding = {
  readonly element: string
  readonly expected: number
  readonly actual: number
  readonly deviation: number
}

export function detectMisalignment(
  elements: readonly { readonly id: string; readonly x: number }[],
  tolerance: number = 4,
): readonly AlignmentFinding[] {
  const findings: AlignmentFinding[] = []
  const groups = new Map<number, readonly string[]>()

  for (const el of elements) {
    const key = Math.round(el.x / 8) * 8
    const existing = groups.get(key) ?? []
    groups.set(key, [...existing, el.id])
  }

  for (const [x, ids] of groups) {
    if (ids.length < 2) continue
    for (const id of ids) {
      const el = elements.find((e) => e.id === id)
      if (el && Math.abs(el.x - x) > tolerance) {
        findings.push({
          element: id,
          expected: x,
          actual: el.x,
          deviation: Math.abs(el.x - x),
        })
      }
    }
  }

  return findings
}

