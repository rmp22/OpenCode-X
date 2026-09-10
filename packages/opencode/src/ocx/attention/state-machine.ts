import {
  type AttentionConfig,
  type AttentionDeclaration,
  type AttentionMask,
  type AttentionMode,
  type AttentionScaffold,
  type AttentionSegment,
  type AttentionTelemetry,
  DEFAULT_ATTENTION_CONFIG,
} from "./types"

export class AttentionStateMachine {
  private readonly config: AttentionConfig
  private readonly segments = new Map<string, AttentionSegment>()
  private scaffold: AttentionScaffold
  private currentMode: AttentionMode
  private focusedIds: string[] = []
  private emittedModes: AttentionMode[] = []
  private streamBuffer = ""

  constructor(
    scaffold: AttentionScaffold,
    segments: readonly AttentionSegment[] = [],
    config: Partial<AttentionConfig> = {},
  ) {
    this.config = { ...DEFAULT_ATTENTION_CONFIG, ...config }
    this.scaffold = scaffold
    this.currentMode = this.config.defaultMode

    for (const seg of segments) {
      this.segments.set(seg.id, seg)
    }

    this.emittedModes.push(this.currentMode)
  }

  registerSegments(segments: readonly AttentionSegment[]): void {
    for (const seg of segments) {
      this.segments.set(seg.id, seg)
    }
  }

  updateScaffold(scaffold: AttentionScaffold): void {
    this.scaffold = scaffold
  }

  getSegments(): readonly AttentionSegment[] {
    return Array.from(this.segments.values())
  }

  getMode(): AttentionMode {
    return this.currentMode
  }

  getFocusedSegmentIds(): readonly string[] {
    return [...this.focusedIds]
  }

  transition(mode: AttentionMode, targetSegmentIds: readonly string[] = []): AttentionMask {
    const segmentList = Array.from(this.segments.values())

    if (mode === "focus" && targetSegmentIds.length > 0 && segmentList.length > 0) {
      const knownIds = new Set(segmentList.map((seg) => seg.id))
      const parentIds = new Set(
        segmentList.flatMap((seg) =>
          typeof seg.metadata?.parentSegmentId === "string" ? [seg.metadata.parentSegmentId as string] : [],
        ),
      )
      const anyKnown = targetSegmentIds.some((id) => {
        if (knownIds.has(id) || parentIds.has(id) || /^\d+$/.test(id)) return true
        for (const seg of segmentList) {
          if (seg.id.startsWith(id + ":") || seg.name.includes(id)) return true
        }
        return false
      })
      if (!anyKnown) {
        this.currentMode = "global"
        this.focusedIds = []
        this.emittedModes.push("global")
        return this.computeMask()
      }
    }

    this.currentMode = mode
    const resolved: string[] = []

    for (const id of targetSegmentIds) {
      if (/^\d+$/.test(id)) {
        const numIndex = parseInt(id, 10) - 1
        if (numIndex >= 0 && numIndex < segmentList.length) {
          resolved.push(segmentList[numIndex].id)
          continue
        }
      }
      if (this.segments.has(id)) {
        resolved.push(id)
      } else {
        for (const [segId, seg] of this.segments.entries()) {
          if (segId.startsWith(id + ":") || seg.metadata?.parentSegmentId === id || seg.name.includes(id)) {
            resolved.push(segId)
          }
        }
      }
    }
    this.focusedIds = resolved
    if (mode === "focus" && targetSegmentIds.length > 0 && resolved.length === 0 && segmentList.length > 0) {
      this.currentMode = "global"
      this.focusedIds = []
      this.emittedModes.push("global")
      return this.computeMask()
    }
    this.emittedModes.push(mode)
    return this.computeMask()
  }

  processChunk(chunk: string): { readonly changed: boolean; readonly mask: AttentionMask } {
    this.streamBuffer += chunk
    const MAX_STREAM_BUFFER = 8192
    if (this.streamBuffer.length > MAX_STREAM_BUFFER * 2) {
      this.streamBuffer = this.streamBuffer.slice(-MAX_STREAM_BUFFER)
    }
    let changed = false
    let matchedAny = true

    while (matchedAny) {
      matchedAny = false

      const focusMatch = this.streamBuffer.match(/<focus\s+(?:segments|magic_chunks)=["']([^"']+)["']\s*>/i)
      const localMatch = this.streamBuffer.match(/<local\s*>/i)
      const globalMatch = this.streamBuffer.match(/<global\s*>/i)
      const closeFocus = this.streamBuffer.match(/<\/focus\s*>/i)
      const closeLocal = this.streamBuffer.match(/<\/local\s*>/i)

      const matches: Array<{ type: string; index: number; length: number; match: RegExpMatchArray }> = []
      if (focusMatch && focusMatch.index !== undefined) matches.push({ type: "focus", index: focusMatch.index, length: focusMatch[0].length, match: focusMatch })
      if (localMatch && localMatch.index !== undefined) matches.push({ type: "local", index: localMatch.index, length: localMatch[0].length, match: localMatch })
      if (globalMatch && globalMatch.index !== undefined) matches.push({ type: "global", index: globalMatch.index, length: globalMatch[0].length, match: globalMatch })
      if (closeFocus && closeFocus.index !== undefined) matches.push({ type: "closeFocus", index: closeFocus.index, length: closeFocus[0].length, match: closeFocus })
      if (closeLocal && closeLocal.index !== undefined) matches.push({ type: "closeLocal", index: closeLocal.index, length: closeLocal[0].length, match: closeLocal })

      if (matches.length === 0) break

      matches.sort((a, b) => a.index - b.index)
      const earliest = matches[0]

      matchedAny = true
      this.streamBuffer = this.streamBuffer.slice(earliest.index + earliest.length)

      if (earliest.type === "focus") {
        const rawIds = earliest.match[1].split(/[,\s]+/).map((s) => s.trim()).filter(Boolean)
        this.transition("focus", rawIds)
        changed = true
      } else if (earliest.type === "local") {
        this.transition("local", [])
        changed = true
      } else if (earliest.type === "closeFocus" || earliest.type === "closeLocal") {
        this.transition("global", [])
        changed = true
      }
    }

    return { changed, mask: this.computeMask() }
  }

  parseAllDeclarations(text: string): readonly AttentionDeclaration[] {
    const declarations: AttentionDeclaration[] = []
    const tagRegex = /<(global|focus|local)(?:\s+(?:segments|magic_chunks)=["']([^"']+)["'])?\s*>([\s\S]*?)<\/\1>/gi
    let match: RegExpExecArray | null

    while ((match = tagRegex.exec(text)) !== null) {
      const rawMode = match[1].toLowerCase() as AttentionMode
      const rawTargetAttr = match[2]
      const body = match[3]?.trim()
      const targets = rawTargetAttr
        ? rawTargetAttr.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean)
        : []

      declarations.push({
        mode: rawMode,
        targetSegmentIds: targets,
        rationale: body ? body.slice(0, 160) : undefined,
        rawTag: match[0],
      })
    }

    if (declarations.length > 0) return declarations

    const unclosedRegex = /<(global|focus|local)(?:\s+(?:segments|magic_chunks)=["']([^"']+)["'])?\s*>/gi
    while ((match = unclosedRegex.exec(text)) !== null) {
      const rawMode = match[1].toLowerCase() as AttentionMode
      const rawTargetAttr = match[2]
      const targets = rawTargetAttr
        ? rawTargetAttr.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean)
        : []

      declarations.push({
        mode: rawMode,
        targetSegmentIds: targets,
        rationale: undefined,
        rawTag: match[0],
      })
    }

    return declarations
  }

  computeMask(): AttentionMask {
    const allSegments = Array.from(this.segments.values())
    const totalContextTokens = allSegments.reduce((sum, seg) => sum + seg.blockAlignedTokenCount, 0)
    const scaffoldTokens = this.scaffold.tokenCount

    let attendedSegments: AttentionSegment[] = []
    let maskedSegments: AttentionSegment[] = []

    if (this.currentMode === "global") {
      attendedSegments = allSegments
      maskedSegments = []
    } else if (this.currentMode === "focus") {
      const focusSet = new Set(this.focusedIds)
      for (const seg of allSegments) {
        if (focusSet.has(seg.id)) {
          attendedSegments.push(seg)
        } else {
          maskedSegments.push(seg)
        }
      }
    } else if (this.currentMode === "local") {
      attendedSegments = []
      maskedSegments = allSegments
    }

    const attendedContextTokens = attendedSegments.reduce((sum, seg) => sum + seg.blockAlignedTokenCount, 0)
    const totalAttendedTokens = scaffoldTokens + attendedContextTokens
    const maxPossibleTokens = scaffoldTokens + totalContextTokens
    const savedTokens = maxPossibleTokens - totalAttendedTokens
    const reductionRatio = maxPossibleTokens > 0 ? savedTokens / maxPossibleTokens : 0

    return {
      mode: this.currentMode,
      focusedSegmentIds: [...this.focusedIds],
      attendedSegments,
      maskedSegments,
      scaffoldTokens,
      totalContextTokens,
      attendedContextTokens,
      totalAttendedTokens,
      savedTokens,
      reductionRatio: Math.round(reductionRatio * 1000) / 1000,
    }
  }

  getTelemetry(sessionId: string, turnIndex: number): AttentionTelemetry {
    const mask = this.computeMask()
    return {
      sessionId,
      turnIndex,
      modesEmitted: [...this.emittedModes],
      segmentCount: this.segments.size,
      totalTokens: mask.scaffoldTokens + mask.totalContextTokens,
      attendedTokens: mask.totalAttendedTokens,
      savedTokens: mask.savedTokens,
      reductionRatio: mask.reductionRatio,
    }
  }
}
