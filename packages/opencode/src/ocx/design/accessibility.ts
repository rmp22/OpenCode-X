
export type A11yFinding = {
  readonly type: "keyboard" | "focus" | "touch" | "text-scale" | "screen-reader" | "contrast" | "motion" | "state"
  readonly element: string
  readonly message: string
  readonly severity: "error" | "warning" | "info"
}

export function checkAccessibility(
  elements: readonly {
    readonly id: string
    readonly interactive: boolean
    readonly tabIndex?: number
    readonly ariaLabel?: string
    readonly role?: string
    readonly minWidth?: number
    readonly minHeight?: number
    readonly focusable?: boolean
  }[],
): readonly A11yFinding[] {
  const findings: A11yFinding[] = []

  for (const el of elements) {
    if (el.interactive && !el.tabIndex && el.tabIndex !== 0) {
      findings.push({
        type: "keyboard",
        element: el.id,
        message: "interactive element is not keyboard-focusable",
        severity: "error",
      })
    }

    if (el.interactive && !el.ariaLabel && !el.role) {
      findings.push({
        type: "screen-reader",
        element: el.id,
        message: "interactive element missing aria-label or role",
        severity: "warning",
      })
    }

    if (el.minWidth !== undefined && el.minWidth < 44) {
      findings.push({
        type: "touch",
        element: el.id,
        message: `touch target ${el.minWidth}px is below minimum 44px`,
        severity: "error",
      })
    }

    if (el.minHeight !== undefined && el.minHeight < 44) {
      findings.push({
        type: "touch",
        element: el.id,
        message: `touch target ${el.minHeight}px is below minimum 44px`,
        severity: "error",
      })
    }
  }

  return findings
}

