import type { GraphEvent, ReconstructedGraphState } from "./types"

export function reconstructState(
  sessionID: string,
  events: readonly GraphEvent[],
  initialNodeId?: string,
): ReconstructedGraphState {
  let currentNode = initialNodeId ?? ""
  const visitedNodes: string[] = initialNodeId ? [initialNodeId] : []
  const accumulatedEvidence: { readonly id: string; readonly kind: string; readonly detail?: string }[] = []
  const verifiedClaims: string[] = []
  let isSuspended = false
  let activeSuspensionReason: string | undefined

  for (const ev of events) {
    if (sessionID && sessionID !== "default" && ev.sessionID && ev.sessionID !== sessionID) {
      continue
    }
    switch (ev.type) {
      case "node_entered": {
        const nodeId = (ev as any).nodeId as string | undefined
        if (nodeId) {
          currentNode = nodeId
          if (!visitedNodes.includes(nodeId)) visitedNodes.push(nodeId)
        }
        break
      }
      case "node_transition": {
        const payload = ev.payload as { to?: string } | undefined
        const target = payload?.to ?? ((ev as any).nodeId as string | undefined)
        if (target) {
          currentNode = target
          if (!visitedNodes.includes(target)) visitedNodes.push(target)
        }
        break
      }
      case "evidence_recorded":
      case "evidence_collected": {
        const payload = ev.payload as { id?: string; kind?: string; detail?: string } | undefined
        const evId = payload?.id ?? ((ev as any).evidenceId as string | undefined)
        const evKind = payload?.kind ?? ((ev as any).kind as string | undefined)
        const evDetail = payload?.detail ?? ((ev as any).detail as string | undefined)
        if (evId && evKind) {
          accumulatedEvidence.push({
            id: evId,
            kind: evKind,
            detail: evDetail,
          })
        }
        break
      }
      case "claim_verified": {
        const claimId = (ev.payload as any)?.claimId ?? ((ev as any).claimId as string | undefined)
        if (claimId && !verifiedClaims.includes(claimId)) {
          verifiedClaims.push(claimId)
        }
        break
      }
      case "suspended": {
        isSuspended = true
        activeSuspensionReason = (ev.payload as any)?.reason ?? ((ev as any).reason as string | undefined)
        break
      }
      case "resumed": {
        isSuspended = false
        activeSuspensionReason = undefined
        break
      }
      default:
        break
    }
  }

  const state: ReconstructedGraphState = {
    currentNode,
    visitedNodes,
    accumulatedEvidence,
    verifiedClaims,
    isSuspended,
    activeSuspensionReason,
  }
  return state
}

export class GraphRecoveryEngine {
  static replay(
    events: readonly GraphEvent[],
    initialNodeId = "plan",
  ): ReconstructedGraphState {
    const targetSession = events.find((e) => e.sessionID)?.sessionID ?? "default"
    const state = reconstructState(targetSession, events, initialNodeId)
    return state
  }
}

export * as GraphRecoveryModule from "./recovery"
