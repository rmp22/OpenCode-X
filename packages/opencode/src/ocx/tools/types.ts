import type { EvidenceItem } from "../evidence/types"

export type ToolStatus = "success" | "failure" | "partial"

export interface ToolTelemetry {
  durationMs: number
  bytesTransferred?: number
  linesProcessed?: number
}

export interface ToolErrorPayload {
  code: string
  message: string
  recoverable: boolean
  recoveryHint?: string
  rawError?: unknown
}

export interface TypedToolResult<T = unknown> {
  status: ToolStatus
  data?: T
  error?: ToolErrorPayload
  evidence: EvidenceItem
  telemetry: ToolTelemetry
  continuationToken?: string
  truncated?: boolean
}

export interface ToolCapabilityDefinition<TInput = unknown, TOutput = unknown> {
  name: string
  description: string
  requiredCapabilities: string[]
  maxOutputBytes?: number
  execute: (input: TInput) => Promise<TOutput>
}
