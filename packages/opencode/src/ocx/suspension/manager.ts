import type { SuspensionKind, SuspensionRecord, ResumeResult } from "./types"

export class SuspensionManager {
  private readonly records = new Map<string, SuspensionRecord>()

  create(options: {
    readonly sessionID: string
    readonly kind: SuspensionKind
    readonly nodeId?: string
    readonly prompt?: string
    readonly reason?: string
    readonly schema?: unknown
  }): SuspensionRecord {
    const record = this.suspend({
      sessionID: options.sessionID,
      kind: options.kind,
      nodeId: options.nodeId ?? "node_default",
      prompt: options.prompt ?? options.reason ?? "",
      schema: options.schema,
    })
    return record
  }

  suspend(options: {
    readonly sessionID: string
    readonly kind: SuspensionKind
    readonly nodeId: string
    readonly prompt: string
    readonly schema?: unknown
  }): SuspensionRecord {
    const id = `susp_${options.sessionID}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    const record: SuspensionRecord = {
      id,
      kind: options.kind,
      nodeId: options.nodeId,
      sessionID: options.sessionID,
      prompt: options.prompt,
      schema: options.schema,
      createdAt: Date.now(),
      status: "active",
    }
    this.records.set(id, record)
    return record
  }

  activeSuspensions(sessionID: string): readonly SuspensionRecord[] {
    const list: SuspensionRecord[] = []
    for (const record of this.records.values()) {
      if (record.sessionID === sessionID && record.status === "active") {
        list.push(record)
      }
    }
    return list
  }

  get(suspensionId: string): SuspensionRecord | undefined {
    return this.records.get(suspensionId)
  }

  validatePayload(kind: SuspensionKind, payload: unknown): { readonly valid: boolean; readonly reason?: string } {
    if (payload === undefined || payload === null) {
      if (kind === "rate_limit") return { valid: true }
      return { valid: false, reason: "Payload cannot be null or undefined" }
    }

    switch (kind) {
      case "user_input": {
        if (typeof payload === "string" && payload.trim().length > 0) return { valid: true }
        if (typeof payload === "object" && typeof (payload as any).answer === "string") return { valid: true }
        return { valid: false, reason: "user_input requires non-empty string or object with answer property" }
      }
      case "permission": {
        if (typeof payload === "object" && typeof (payload as any).approved === "boolean") return { valid: true }
        return { valid: false, reason: "permission requires object with boolean approved property" }
      }
      case "approval":
      case "review_approval": {
        if (typeof payload === "object" && typeof (payload as any).approved === "boolean") return { valid: true }
        return { valid: false, reason: "approval requires object with boolean approved property" }
      }
      case "review": {
        if (typeof payload === "object" || typeof payload === "string") return { valid: true }
        return { valid: false, reason: "review requires string feedback or review object" }
      }
      case "verification_failure": {
        if (typeof payload === "object" || typeof payload === "string") return { valid: true }
        return { valid: false, reason: "verification_failure requires waiver reason or resolution payload" }
      }
      case "circuit_breaker": {
        if (typeof payload === "object" && typeof (payload as any).reset === "boolean") return { valid: true }
        return { valid: false, reason: "circuit_breaker requires object with boolean reset property" }
      }
      case "rate_limit":
        return { valid: true }
      default:
        return { valid: true }
    }
  }

  resume(sessionID: string, suspensionId: string, payload: unknown): ResumeResult {
    const record = this.records.get(suspensionId)
    if (!record) {
      return { success: false, reason: `Suspension ${suspensionId} not found` }
    }
    if (record.sessionID !== sessionID) {
      return { success: false, reason: `Suspension ${suspensionId} does not belong to session ${sessionID}` }
    }
    if (record.status !== "active") {
      return { success: false, reason: `Suspension ${suspensionId} is already ${record.status}` }
    }

    const validation = this.validatePayload(record.kind, payload)
    if (!validation.valid) {
      return { success: false, reason: validation.reason ?? "Invalid payload" }
    }

    const updated: SuspensionRecord = {
      ...record,
      status: "resumed",
      resumedAt: Date.now(),
      resumePayload: payload,
    }
    this.records.set(suspensionId, updated)
    return { success: true, suspension: updated }
  }

  cancel(sessionID: string, suspensionId: string): boolean {
    const record = this.records.get(suspensionId)
    if (!record || record.sessionID !== sessionID || record.status !== "active") {
      return false
    }
    this.records.set(suspensionId, {
      ...record,
      status: "cancelled",
    })
    return true
  }

  cancelStale(sessionID: string, maxAgeMs = 3600000): number {
    const now = Date.now()
    let count = 0
    for (const [id, record] of this.records.entries()) {
      if (record.sessionID === sessionID && record.status === "active") {
        if (now - record.createdAt >= maxAgeMs) {
          this.records.set(id, {
            ...record,
            status: "cancelled",
          })
          count++
        }
      }
    }
    return count
  }
}

export const defaultSuspensionManager = new SuspensionManager()

export * as SuspensionManagerModule from "./manager"
