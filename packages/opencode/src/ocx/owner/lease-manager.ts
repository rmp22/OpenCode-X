import { randomUUID } from "node:crypto"
import type { OwnerID, OwnerPathLease, PathLeaseResult } from "./types"

function normalizePath(rawPath: string): string {
  return rawPath.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/+$/, "")
}

export function pathsOverlap(pathA: string, pathB: string): boolean {
  const normA = normalizePath(pathA)
  const normB = normalizePath(pathB)
  if (!normA || normA === "." || !normB || normB === ".") return true
  if (normA === normB) return true
  if (normB.startsWith(`${normA}/`)) return true
  if (normA.startsWith(`${normB}/`)) return true
  return false
}

export class PathLeaseManager {
  private readonly leases = new Map<string, OwnerPathLease>()
  readonly defaultTtlMs: number

  constructor(defaultTtlMs = 300_000) {
    this.defaultTtlMs = defaultTtlMs
  }

  private purgeExpired(): void {
    const now = Date.now()
    for (const [id, lease] of this.leases.entries()) {
      if (lease.expiresAt <= now) {
        this.leases.delete(id)
      }
    }
  }

  acquirePathLease(
    pathPrefix: string,
    ownerId: OwnerID,
    sessionID: string,
    ttlMs?: number
  ): PathLeaseResult {
    this.purgeExpired()
    const normPath = normalizePath(pathPrefix)
    const now = Date.now()

    for (const active of this.leases.values()) {
      if (active.sessionID === sessionID) continue
      if (pathsOverlap(active.pathPrefix, normPath)) {
        const failure: PathLeaseResult = {
          success: false,
          reason: `Conflict with active lease ${active.leaseId} held by ${active.ownerId} on ${active.pathPrefix}`,
          currentLease: active,
        }
        return failure
      }
    }

    const id = randomUUID().slice(0, 8)
    const lease: OwnerPathLease = {
      leaseId: `lease-${id}`,
      pathPrefix: normPath,
      ownerId,
      sessionID,
      acquiredAt: now,
      expiresAt: now + (ttlMs ?? this.defaultTtlMs),
    }

    this.leases.set(lease.leaseId, lease)
    const success: PathLeaseResult = {
      success: true,
      lease,
    }
    return success
  }

  releasePathLease(leaseId: string): boolean {
    return this.leases.delete(leaseId)
  }

  releaseAllForSession(sessionID: string): number {
    let released = 0
    for (const [id, lease] of this.leases.entries()) {
      if (lease.sessionID === sessionID) {
        this.leases.delete(id)
        released++
      }
    }
    return released
  }

  extendLease(leaseId: string, additionalMs: number): boolean {
    const lease = this.leases.get(leaseId)
    if (!lease) return false
    const updated: OwnerPathLease = {
      ...lease,
      expiresAt: lease.expiresAt + additionalMs,
    }
    this.leases.set(leaseId, updated)
    return true
  }

  isPathLeased(path: string, excludeSessionID?: string): boolean {
    this.purgeExpired()
    const norm = normalizePath(path)
    for (const lease of this.leases.values()) {
      if (excludeSessionID && lease.sessionID === excludeSessionID) continue
      if (pathsOverlap(lease.pathPrefix, norm)) return true
    }
    return false
  }

  listActiveLeases(): readonly OwnerPathLease[] {
    this.purgeExpired()
    return Array.from(this.leases.values())
  }

  canScheduleNode(scopePaths: readonly string[], sessionID: string): boolean {
    this.purgeExpired()
    for (const p of scopePaths) {
      if (this.isPathLeased(p, sessionID)) return false
    }
    return true
  }

  acquireNodeLeases(
    _nodeId: string,
    ownerId: OwnerID,
    scopePaths: readonly string[],
    sessionID: string
  ): { readonly acquired: boolean; readonly leaseIds: readonly string[]; readonly conflictPath?: string } {
    this.purgeExpired()
    const acquiredLeases: string[] = []

    for (const path of scopePaths) {
      const res = this.acquirePathLease(path, ownerId, sessionID)
      if (!res.success) {
        for (const id of acquiredLeases) {
          this.releasePathLease(id)
        }
        const failResult = {
          acquired: false,
          leaseIds: [],
          conflictPath: path,
        }
        return failResult
      }
      acquiredLeases.push(res.lease.leaseId)
    }

    const okResult = {
      acquired: true,
      leaseIds: acquiredLeases,
    }
    return okResult
  }
}

export * as LeaseManager from "./lease-manager"
