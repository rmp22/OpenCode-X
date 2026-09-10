type SessionMetadata = {
  readonly metadata?: unknown
}

export function isInternal(info: SessionMetadata): boolean {
  const metadata = info.metadata
  if (typeof metadata !== "object" || metadata === null) return false
  const ocx = (metadata as Record<string, unknown>).ocx
  return typeof ocx === "object" && ocx !== null && (ocx as Record<string, unknown>).sessionKind === "owner"
}

export * as OwnerSession from "./session-filter"
