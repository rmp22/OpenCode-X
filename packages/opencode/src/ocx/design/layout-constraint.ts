
export type Constraint = {
  readonly type: "left-align" | "right-align" | "width-equal" | "height-equal" | "gap" | "center" | "baseline" | "span"
  readonly targetA: string
  readonly targetB?: string
  readonly value?: number
  readonly token?: string
}

export type LayoutConstraintGraph = {
  readonly nodes: readonly string[]
  readonly constraints: readonly Constraint[]
  readonly violations: readonly string[]
}

export function buildConstraintGraph(nodes: readonly string[], constraints: readonly Constraint[]): LayoutConstraintGraph {
  const violations: string[] = []

  for (const constraint of constraints) {
    if (!nodes.includes(constraint.targetA)) {
      violations.push(`constraint references unknown node "${constraint.targetA}"`)
    }
    if (constraint.targetB && !nodes.includes(constraint.targetB)) {
      violations.push(`constraint references unknown node "${constraint.targetB}"`)
    }
  }

  return { nodes, constraints, violations }
}

export function checkConstraints(graph: LayoutConstraintGraph): readonly string[] {
  const violations: string[] = []

  for (const constraint of graph.constraints) {
    if (constraint.type === "gap" && constraint.value !== undefined && constraint.value < 0) {
      violations.push(`negative gap between "${constraint.targetA}" and "${constraint.targetB}"`)
    }
    if (constraint.type === "width-equal" && constraint.targetA === constraint.targetB) {
      violations.push(`width-equal constraint references the same node "${constraint.targetA}"`)
    }
  }

  return violations
}

