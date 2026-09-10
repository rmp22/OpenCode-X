export type AnchorType = "constraint" | "objective" | "invariant" | "perimeter" | "stage_transition"
export type AnchorPriority = "critical" | "high" | "medium"
export type AnchorPlacement = "prefix" | "suffix" | "boundary"

export interface AttentionAnchor {
  readonly id: string
  readonly type: AnchorType
  readonly content: string
  readonly priority: AnchorPriority
  readonly placement: AnchorPlacement
  readonly stage?: string
}

export interface InjectionResult {
  readonly assembledContent: string
  readonly prefixAnchorsCount: number
  readonly suffixAnchorsCount: number
  readonly boundaryAnchorsCount: number
}

const PRIORITY_WEIGHTS: Record<AnchorPriority, number> = {
  critical: 3,
  high: 2,
  medium: 1,
}

export class AttentionSinkManager {
  private readonly anchors = new Map<string, AttentionAnchor>()

  registerAnchor(anchor: AttentionAnchor): void {
    this.anchors.set(anchor.id, anchor)
  }

  removeAnchor(id: string): void {
    this.anchors.delete(id)
  }

  getAnchor(id: string): AttentionAnchor | undefined {
    return this.anchors.get(id)
  }

  getAnchors(filter?: {
    readonly placement?: AnchorPlacement
    readonly stage?: string
    readonly minPriority?: AnchorPriority
  }): readonly AttentionAnchor[] {
    const minWeight = filter?.minPriority ? PRIORITY_WEIGHTS[filter.minPriority] : 0
    const filtered = Array.from(this.anchors.values()).filter((anchor) => {
      if (filter?.placement && anchor.placement !== filter.placement) return false
      if (filter?.stage && anchor.stage && anchor.stage !== filter.stage) return false
      if (PRIORITY_WEIGHTS[anchor.priority] < minWeight) return false
      return true
    })
    const sorted = filtered.sort((a, b) => PRIORITY_WEIGHTS[b.priority] - PRIORITY_WEIGHTS[a.priority])
    return sorted
  }

  refreshOnStageTransition(
    previousStage: string,
    newStage: string,
    activeObjectives: readonly string[],
  ): AttentionAnchor {
    const id = `stage_transition_${previousStage}_to_${newStage}_${Date.now()}`
    const content =
      "TRANSITION [" +
      previousStage +
      " -> " +
      newStage +
      "]:\n- " +
      (activeObjectives.length > 0 ? activeObjectives.join("\n- ") : "Continue execution")
    const anchor: AttentionAnchor = {
      id,
      type: "stage_transition",
      content,
      priority: "critical",
      placement: "suffix",
      stage: newStage,
    }
    this.registerAnchor(anchor)
    return anchor
  }

  formatAnchorText(anchor: AttentionAnchor): string {
    return `[${anchor.type.toUpperCase()}:${anchor.priority.toUpperCase()}] ${anchor.content}`
  }

  injectSinkMarkers(content: string, stage?: string): InjectionResult {
    const prefixAnchors = this.getAnchors({ placement: "prefix", stage })
    const suffixAnchors = this.getAnchors({ placement: "suffix", stage })
    const boundaryAnchors = this.getAnchors({ placement: "boundary", stage })

    let assembledContent = ""
    if (prefixAnchors.length > 0) {
      assembledContent +=
        "=== ATTENTION SINK: PREFIX ANCHORS ===\n" +
        prefixAnchors.map((a) => this.formatAnchorText(a)).join("\n") +
        "\n=== END PREFIX ANCHORS ===\n\n"
    }

    assembledContent += content

    if (boundaryAnchors.length > 0) {
      assembledContent +=
        "\n\n=== ATTENTION SINK: BOUNDARY ANCHORS ===\n" +
        boundaryAnchors.map((a) => this.formatAnchorText(a)).join("\n") +
        "\n=== END BOUNDARY ANCHORS ==="
    }

    if (suffixAnchors.length > 0) {
      assembledContent +=
        "\n\n=== ATTENTION SINK: SUFFIX ANCHORS ===\n" +
        suffixAnchors.map((a) => this.formatAnchorText(a)).join("\n") +
        "\n=== END SUFFIX ANCHORS ==="
    }

    const result: InjectionResult = {
      assembledContent,
      prefixAnchorsCount: prefixAnchors.length,
      suffixAnchorsCount: suffixAnchors.length,
      boundaryAnchorsCount: boundaryAnchors.length,
    }
    return result
  }

  clear(): void {
    this.anchors.clear()
  }
}
