import {
  type AttentionScaffold,
  type AttentionSegment,
  estimateTokens,
} from "./types"

export class AttentionPromptProtocol {
  static renderDualFocusAnchor(input: {
    readonly globalObjective: string
    readonly activeTargetFile?: string
    readonly callerPerimeter?: readonly string[]
    readonly acceptanceCriteria?: readonly string[]
  }): string {
    const lines: string[] = [
      "=== DUAL-FOCUS ATTENTION ANCHOR (ANTI-TUNNEL FRAME) ===",
      `[GLOBAL OBJECTIVE]: ${input.globalObjective}`,
    ]
    if (input.activeTargetFile) {
      lines.push(`[LOCAL FOCUS TARGET]: ${input.activeTargetFile}`)
    }
    if (input.callerPerimeter && input.callerPerimeter.length > 0) {
      lines.push(`[PERIMETER / CALLERS]: ${input.callerPerimeter.join(", ")}`)
    }
    if (input.acceptanceCriteria && input.acceptanceCriteria.length > 0) {
      lines.push("[ACCEPTANCE INVARIANTS]:")
      for (const criterion of input.acceptanceCriteria) {
        lines.push(`  - ${criterion}`)
      }
    }
    lines.push(
      "Anti-Tunnel Rule: Keep both anchors in working memory. Do not make isolated edits that break the caller perimeter or diverge from the global objective.",
    )
    lines.push("=== END DUAL-FOCUS ANCHOR ===")
    return lines.join("\n")
  }

  static createScaffold(input: {
    readonly systemInstruction: string
    readonly userQuery: string
    readonly globalObjective?: string
    readonly activeTargetFile?: string
    readonly callerPerimeter?: readonly string[]
    readonly acceptanceCriteria?: readonly string[]
    readonly segments?: readonly AttentionSegment[]
  }): AttentionScaffold {
    const directive = [
      "=== DECLARATIVE ATTENTION PROTOCOL (DA) ===",
      "You have direct control over your attention span to minimize context and KV-cache overhead.",
      "Reason through the context segments using three modes:",
      "",
      "| Mode | What you can see | Use it when |",
      "| :--- | :--- | :--- |",
      "| <global> (default) | All context segments | You are identifying which segment to focus on next. Briefly explain why; do not reason about the answer itself in global mode. |",
      "| <focus segments=\"K\"> | Only segment K (plus values already extracted) | You are pulling verbatim code, signatures, or values out of segment K. |",
      "| <local> | Only values already extracted (zero context segments) | You are planning over the request, doing calculations, or synthesizing the final answer. |",
      "",
      "Strategy Guidelines:",
      "1. Use at least one <focus> block to pull the exact values/code into your attention before concluding. Skipping focus and guessing from memory is the most common failure mode.",
      "2. End with a <local> block that names the single value, result, or summary you will commit to. This is the commitment step: without it, retrieved values get mixed up and the wrong one is reported.",
      "3. Do not recall segment contents from memory in <local>. Once you open <local>, segments are no longer visible and anything unextracted is a guess. If missing data, close </local>, open <global>, and identify the next segment to focus on.",
      "Common valid sequence: <local> (plan) -> <global> (locate) -> <focus segments=\"K\"> (extract) -> <local> (synthesize/commit).",
      "Always close declared spans with matching </global>, </focus>, or </local> tags.",
    ].join("\n")

    const anchor = this.renderDualFocusAnchor({
      globalObjective: input.globalObjective || input.userQuery,
      activeTargetFile: input.activeTargetFile,
      callerPerimeter: input.callerPerimeter,
      acceptanceCriteria: input.acceptanceCriteria,
    })

    const fullScaffoldText = `${input.systemInstruction}\n\n${anchor}\n\n${directive}\n\nUser Query: ${input.userQuery}`
    const tokenCount = estimateTokens(fullScaffoldText)

    return {
      systemInstruction: input.systemInstruction,
      userQuery: input.userQuery,
      protocolDirective: `${anchor}\n\n${directive}`,
      tokenCount,
    }
  }

  static renderSegmentDirectory(segments: readonly AttentionSegment[]): string {
    if (segments.length === 0) return "No context segments registered."
    const lines: string[] = ["=== AVAILABLE CONTEXT SEGMENTS (MAGIC CHUNKS) ==="]
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]
      const chunkNum = i + 1
      lines.push(`- Magic Chunk ${chunkNum} [id="${seg.id}"]: ${seg.name} (~${seg.tokenCount} tokens) - ${seg.summary}`)
    }
    lines.push("=== END SEGMENT DIRECTORY ===")
    return lines.join("\n")
  }
}
