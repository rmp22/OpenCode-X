import type { ActivityLease } from "./types"
import { selectPrimary as runtimeSelectPrimary } from "./runtime"

export function selectPrimaryActivity(sessionID: string): ActivityLease | undefined {
  return runtimeSelectPrimary(sessionID)
}

export * as ActivitySelector from "./selector"
