import type {
  DomainFact,
  DomainLease,
  LeaseResult,
  HITLApprovalRequest,
  HITLResolution,
} from "./types"

export class OwnerStateManager {
  private readonly leases = new Map<string, DomainLease>()
  private readonly facts = new Map<string, DomainFact[]>()
  private readonly approvalRequests = new Map<string, HITLApprovalRequest>()
  private readonly maxFactsPerDomain: number

  constructor(maxFactsPerDomain = 50) {
    this.maxFactsPerDomain = maxFactsPerDomain
  }

  acquireLease(domain: string, sessionID: string, ttlMs = 60000): LeaseResult {
    const existing = this.leases.get(domain)
    const now = Date.now()

    if (existing && existing.expiresAt > now && existing.sessionID !== sessionID) {
      const failedResult: LeaseResult = {
        success: false,
        reason: "Domain \"" + domain + "\" is currently leased to session \"" + existing.sessionID + "\" until " + new Date(existing.expiresAt).toISOString(),
        currentLease: existing,
      }
      return failedResult
    }

    const lease: DomainLease = {
      domain,
      sessionID,
      acquiredAt: now,
      expiresAt: now + ttlMs,
    }
    this.leases.set(domain, lease)
    const successResult: LeaseResult = {
      success: true,
      lease,
    }
    return successResult
  }

  releaseLease(domain: string, sessionID: string): boolean {
    const existing = this.leases.get(domain)
    if (!existing || existing.sessionID !== sessionID) {
      return false
    }
    this.leases.delete(domain)
    return true
  }

  activeLease(domain: string): DomainLease | undefined {
    const existing = this.leases.get(domain)
    if (!existing) return undefined
    if (existing.expiresAt <= Date.now()) {
      this.leases.delete(domain)
      return undefined
    }
    return existing
  }

  recordFact(
    domain: string,
    category: string,
    key: string,
    value: string,
    isTransient = false,
  ): DomainFact {
    const list = this.facts.get(domain) ?? []
    const updatedFact: DomainFact = {
      domain,
      category,
      key,
      value,
      updatedAt: Date.now(),
      isTransient,
    }
    const filtered = list.filter((f) => !(f.category === category && f.key === key))
    filtered.push(updatedFact)

    if (filtered.length > this.maxFactsPerDomain) {
      filtered.sort((a, b) => a.updatedAt - b.updatedAt)
      filtered.shift()
    }

    this.facts.set(domain, filtered)
    return updatedFact
  }

  factsForDomain(domain: string): readonly DomainFact[] {
    const list = this.facts.get(domain) ?? []
    return [...list]
  }

  decayTransientFacts(domain: string, maxAgeMs = 1000 * 60 * 15): number {
    const list = this.facts.get(domain) ?? []
    const now = Date.now()
    const beforeCount = list.length
    const retained = list.filter((f) => !f.isTransient || now - f.updatedAt < maxAgeMs)
    this.facts.set(domain, retained)
    return beforeCount - retained.length
  }

  compactDomainState(domain: string): { readonly retainedFactsCount: number; readonly evictedCount: number } {
    const list = this.facts.get(domain) ?? []
    const beforeCount = list.length
    const now = Date.now()
    const valid = list.filter((f) => !f.isTransient || now - f.updatedAt < 1000 * 60 * 30)

    if (valid.length > this.maxFactsPerDomain) {
      valid.sort((a, b) => b.updatedAt - a.updatedAt)
      valid.length = this.maxFactsPerDomain
    }

    this.facts.set(domain, valid)
    const result = {
      retainedFactsCount: valid.length,
      evictedCount: beforeCount - valid.length,
    }
    return result
  }

  requestApproval(request: Omit<HITLApprovalRequest, "id" | "timestamp">): HITLApprovalRequest {
    const id = "hitl_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7)
    const record: HITLApprovalRequest = {
      ...request,
      id,
      timestamp: Date.now(),
    }
    this.approvalRequests.set(id, record)
    return record
  }

  resolveApproval(requestId: string, approved: boolean, feedback?: string): HITLResolution {
    const request = this.approvalRequests.get(requestId)
    if (!request) {
      throw new Error("Approval request \"" + requestId + "\" not found")
    }

    if (approved) {
      const resolution: HITLResolution = {
        status: "approved",
        action: request.proposedAction,
      }
      return resolution
    }

    const alt = request.alternativesConsidered.length > 0 ? request.alternativesConsidered[0] : "replan"
    const resolution: HITLResolution = {
      status: "rejected",
      alternativePath: alt,
      feedback,
    }
    return resolution
  }

  clear(): void {
    this.leases.clear()
    this.facts.clear()
    this.approvalRequests.clear()
  }
}

export const defaultOwnerStateManager = new OwnerStateManager()

export * as OwnerStateManagerModule from "./state-manager"
