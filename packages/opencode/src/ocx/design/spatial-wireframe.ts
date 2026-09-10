
export type WireframeNode = {
  readonly id: string
  readonly label: string
  readonly kind: "container" | "component" | "text" | "image" | "input" | "button" | "navigation" | "data"
  readonly children: readonly WireframeNode[]
  readonly persistent: boolean
  readonly scrollable: boolean
  readonly dominates: boolean
  readonly groupedWith: readonly string[]
}

export function buildWireframe(root: WireframeNode): readonly WireframeNode[] {
  const nodes: WireframeNode[] = []
  function traverse(node: WireframeNode): void {
    nodes.push(node)
    for (const child of node.children) {
      traverse(child)
    }
  }
  traverse(root)
  return nodes
}

export function validateWireframe(root: WireframeNode): readonly string[] {
  const issues: string[] = []
  const nodes = buildWireframe(root)

  const hasPrimary = nodes.some((n) => n.dominates)
  if (!hasPrimary) {
    issues.push("wireframe has no primary/dominant node")
  }

  const scrollableCount = nodes.filter((n) => n.scrollable).length
  if (scrollableCount > 3) {
    issues.push("too many scrollable regions; consider consolidating")
  }

  const containerNodes = nodes.filter((n) => n.kind === "container")
  for (const container of containerNodes) {
    if (container.children.length === 0) {
      issues.push(`container "${container.id}" has no children`)
    }
  }

  return issues
}

