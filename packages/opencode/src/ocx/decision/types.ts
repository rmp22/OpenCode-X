export interface DecisionRecord {
  id: string
  title: string
  rationale: string
  alternativesConsidered: string[]
  chosenAlternative: string
  timestamp: number
  invariants: string[]
}

export interface SourceCoverageEntry {
  filePath: string
  readTimestamp: number
  readLinesCount?: number
  readByteSize?: number
}

export class BlindMutationError extends Error {
  readonly _tag = "BlindMutationError"
  constructor(public readonly filePath: string) {
    super(`Cannot mutate file '${filePath}' before reading it in this session. Blind mutations are prohibited.`)
  }
}
