
export type DomNode = {
  readonly tag: string
  readonly id?: string
  readonly className: string
  readonly boundingRect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
  readonly computedStyle: Record<string, string>
  readonly children: readonly DomNode[]
  readonly accessibleName?: string
  readonly role?: string
}

export type DomInspectionResult = {
  readonly nodes: readonly DomNode[]
  readonly boundingRects: readonly { readonly id: string; readonly x: number; readonly y: number; readonly width: number; readonly height: number }[]
  readonly layoutDrift: boolean
  readonly issues: readonly string[]
}

export function inspectDom(root: DomNode): DomInspectionResult {
  const nodes: DomNode[] = []
  const boundingRects: { readonly id: string; readonly x: number; readonly y: number; readonly width: number; readonly height: number }[] = []
  const issues: string[] = []

  function traverse(node: DomNode): void {
    nodes.push(node)
    if (node.id) {
      boundingRects.push({
        id: node.id,
        x: node.boundingRect.x,
        y: node.boundingRect.y,
        width: node.boundingRect.width,
        height: node.boundingRect.height,
      })
    }
    for (const child of node.children) {
      traverse(child)
    }
  }

  traverse(root)

  // Check for overlapping elements
  for (let i = 0; i < boundingRects.length; i++) {
    for (let j = i + 1; j < boundingRects.length; j++) {
      const a = boundingRects[i]
      const b = boundingRects[j]
      const overlapX = a.x < b.x + b.width && a.x + a.width > b.x
      const overlapY = a.y < b.y + b.height && a.y + a.height > b.y
      if (overlapX && overlapY) {
        issues.push(`elements "${a.id}" and "${b.id}" overlap`)
      }
    }
  }

  return { nodes, boundingRects, layoutDrift: issues.length > 0, issues }
}

