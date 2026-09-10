import { AttentionPromptProtocol } from "./prompt"
import { ContextSegmenter } from "./segmenter"
import { AttentionStateMachine } from "./state-machine"
import {
  type AttentionMask,
  type AttentionMode,
  type AttentionScaffold,
  type AttentionSegment,
} from "./types"

export interface CoordinatedAttention {
  readonly attentionMask: AttentionMask
  readonly scaffold: AttentionScaffold
  readonly segmentDirectory: string
  readonly dualFocusAnchor: string
  readonly segments: readonly AttentionSegment[]
}

export class AttentionCoordinator {
  private static segmenter = new ContextSegmenter({ targetChunkSize: 2048, blockSize: 16 })

  static extractSegmentsFromMessages(messages: readonly any[]): readonly AttentionSegment[] {
    const segments: AttentionSegment[] = []

    for (let msgIndex = 0; msgIndex < messages.length; msgIndex++) {
      const msg = messages[msgIndex]
      const parts = msg.parts ?? []

      for (const part of parts) {
        if (part.type === "tool" && part.state?.status === "completed") {
          const callId = part.callID ?? part.id ?? `tool-${msgIndex}`
          const toolName = part.tool || "unknown"
          const rawOutput = typeof part.state.output === "string" ? part.state.output : JSON.stringify(part.state.output ?? "")

          const created = this.segmenter.fromToolResult(toolName, callId, rawOutput)
          for (const seg of created) {
            segments.push({
              ...seg,
              turnRegistered: msgIndex,
              lastAccessedTurn: msgIndex,
            })
          }
        }
      }
    }

    return segments
  }

  static extractLastDeclaredAttention(messages: readonly any[]): {
    readonly mode?: AttentionMode
    readonly targetSegmentIds: readonly string[]
  } {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      const role = msg.info?.role ?? msg.role
      if (role === "assistant") {
        const parts = msg.parts ?? []
        for (const p of parts) {
          if (p.type === "text" && typeof p.text === "string") {
            const sm = new AttentionStateMachine(
              { systemInstruction: "", userQuery: "", protocolDirective: "", tokenCount: 0 },
              [],
            )
            const decls = sm.parseAllDeclarations(p.text)
            if (decls.length > 0) {
              const last = decls[decls.length - 1]
              return {
                mode: last.mode,
                targetSegmentIds: last.targetSegmentIds,
              }
            }
          }
        }
      }
    }

    return { mode: undefined, targetSegmentIds: [] }
  }

  static coordinate(input: {
    readonly messages: readonly any[]
    readonly userQuery?: string
    readonly globalObjective?: string
    readonly activeTargetFile?: string
    readonly callerPerimeter?: readonly string[]
    readonly acceptanceCriteria?: readonly string[]
  }): CoordinatedAttention {
    const segments = this.extractSegmentsFromMessages(input.messages)
    const declared = this.extractLastDeclaredAttention(input.messages)

    const scaffold = AttentionPromptProtocol.createScaffold({
      systemInstruction: "You are OpenCoder-X, an autonomous agentic software engineering harness.",
      userQuery: input.userQuery || "Execute requested engineering task.",
      globalObjective: input.globalObjective,
      activeTargetFile: input.activeTargetFile,
      callerPerimeter: input.callerPerimeter,
      acceptanceCriteria: input.acceptanceCriteria,
      segments,
    })

    const stateMachine = new AttentionStateMachine(scaffold, segments)
    const attentionMask =
      declared.mode === "focus" || declared.mode === "local"
        ? stateMachine.transition(declared.mode, declared.targetSegmentIds)
        : stateMachine.computeMask()

    const segmentDirectory = AttentionPromptProtocol.renderSegmentDirectory(segments)
    const dualFocusAnchor = AttentionPromptProtocol.renderDualFocusAnchor({
      globalObjective: input.globalObjective || input.userQuery || "Execute requested engineering task.",
      activeTargetFile: input.activeTargetFile,
      callerPerimeter: input.callerPerimeter,
      acceptanceCriteria: input.acceptanceCriteria,
    })

    return {
      attentionMask,
      scaffold,
      segmentDirectory,
      dualFocusAnchor,
      segments,
    }
  }
}
