import type { InterventionRequest, InterventionResponse } from "./types"

export class HitlInterventionCoordinator {
  private pendingRequests = new Map<string, {
    request: InterventionRequest
    resolve: (resp: InterventionResponse) => void
  }>()

  requestApproval(request: InterventionRequest): Promise<InterventionResponse> {
    return new Promise((resolve) => {
      this.pendingRequests.set(request.id, { request, resolve })
    })
  }

  submitResponse(requestId: string, response: InterventionResponse): boolean {
    const pending = this.pendingRequests.get(requestId)
    if (!pending) return false
    this.pendingRequests.delete(requestId)
    pending.resolve(response)
    return true
  }

  getPendingRequests(): InterventionRequest[] {
    return Array.from(this.pendingRequests.values()).map((p) => p.request)
  }

  clear(): void {
    for (const pending of this.pendingRequests.values()) {
      pending.resolve({ approved: false, feedback: "Coordinator cleared" })
    }
    this.pendingRequests.clear()
  }
}

export const defaultHitlCoordinator = new HitlInterventionCoordinator()
