import type { Tool as AITool } from "ai"
import type { SessionV1 } from "@opencode-ai/core/v1/session"

import { DebugLoop } from "@/ocx/debug-loop"
import { isToolAllowed } from "@/ocx/graph/capabilities"
import { PolicyEngine } from "@/ocx/policy"
import type { GraphNode } from "@/ocx/graph/types"
import { defaultFindingLedger } from "@/ocx/findings/ledger"

type ToolMap = Record<string, AITool>

export function apply(
  gated: boolean,
  step: number,
  tools: ToolMap,
  options: {
    readonly workflow?: string
    readonly phase?: string
    readonly phases?: ReadonlyArray<{ readonly id: string; readonly goal?: string; readonly gate?: string }>
    readonly messages?: ReadonlyArray<SessionV1.WithParts>
    readonly planAccepted?: boolean
    readonly node?: Pick<GraphNode, "allowedTools" | "deniedTools">
  } = {},
): void {
  for (const name of Object.keys(tools)) {
    if (options.node) {
      const nodeCheck = isToolAllowed(options.node, name)
      if (!nodeCheck.allowed) {
        delete tools[name]
        continue
      }
    }
    const policyDecision = PolicyEngine.evaluate(name)
    if (!policyDecision.allowed) {
      delete tools[name]
    }
  }
  if (options.workflow !== "debugging" || !options.messages) return
  const locked = new Set(DebugLoop.lockedTools(options.messages))
  for (const name of Object.keys(tools)) if (locked.has(name.toLowerCase())) delete tools[name]
}

export function shouldHaltRepair(targetFile: string): boolean {
  const halt = defaultFindingLedger.shouldHaltRepair(targetFile)
  return halt
}

export function getOscillationReport(targetFile: string): string | undefined {
  const report = defaultFindingLedger.getOscillationReport(targetFile)
  return report
}

export * as Gate from "./gate"
