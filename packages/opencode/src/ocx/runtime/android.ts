
export type ViewNode = {
  readonly id: string
  readonly type: string
  readonly bounds: { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number }
  readonly visibility: "visible" | "invisible" | "gone"
  readonly text?: string
  readonly contentDescription?: string
  readonly children: readonly ViewNode[]
}

export type AndroidInspectionResult = {
  readonly nodes: readonly ViewNode[]
  readonly bounds: readonly { readonly id: string; readonly left: number; readonly top: number; readonly right: number; readonly bottom: number }[]
  readonly accessibilityHierarchy: readonly { readonly id: string; readonly role: string; readonly label: string }[]
  readonly issues: readonly string[]
}

export function inspectAndroid(root: ViewNode): AndroidInspectionResult {
  const nodes: ViewNode[] = []
  const bounds: { readonly id: string; readonly left: number; readonly top: number; readonly right: number; readonly bottom: number }[] = []
  const accessibilityHierarchy: { readonly id: string; readonly role: string; readonly label: string }[] = []
  const issues: string[] = []

  function traverse(node: ViewNode): void {
    nodes.push(node)
    bounds.push({
      id: node.id,
      left: node.bounds.left,
      top: node.bounds.top,
      right: node.bounds.right,
      bottom: node.bounds.bottom,
    })

    if (node.type === "Button" || node.type === "Clickable") {
      accessibilityHierarchy.push({
        id: node.id,
        role: "button",
        label: node.contentDescription ?? node.text ?? "",
      })
    }

    if (node.type === "TextView") {
      accessibilityHierarchy.push({
        id: node.id,
        role: "text",
        label: node.text ?? "",
      })
    }

    for (const child of node.children) {
      traverse(child)
    }
  }

  traverse(root)

  // Check for touch targets that are too small
  for (const bound of bounds) {
    const width = bound.right - bound.left
    const height = bound.bottom - bound.top
    if (width < 44 || height < 44) {
      issues.push(`element "${bound.id}" touch target ${width}x${height} is below minimum 44x44`)
    }
  }

  // Check for elements outside screen bounds (assuming 1080x1920)
  for (const bound of bounds) {
    if (bound.right > 1080 || bound.bottom > 1920) {
      issues.push(`element "${bound.id}" extends beyond screen bounds`)
    }
  }

  return { nodes, bounds, accessibilityHierarchy, issues }
}

