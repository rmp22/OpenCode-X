export type ObservationKind = "file_read" | "shell_output"

export interface ObservationRecord {
  readonly id: string
  readonly kind: ObservationKind
  readonly key: string
  readonly content: string
  readonly hash: string
  readonly timestamp: number
  readonly metadata?: Readonly<Record<string, unknown>>
}

export * as ObservationTypes from "./types"
