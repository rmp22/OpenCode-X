export type FailureRecord = {
  readonly id: string
  readonly failure: string
  readonly cause: string
  readonly prevention: string
  readonly regressionEval: string
  readonly timestamp: number
}

export type FailureLibrary = {
  readonly record: (failure: string, cause: string, prevention: string, regressionEval: string) => FailureRecord
  readonly get: (id: string) => FailureRecord | undefined
  readonly list: () => readonly FailureRecord[]
  readonly toEvals: () => readonly string[]
}

export function createFailureLibrary(): FailureLibrary {
  const records = new Map<string, FailureRecord>()
  return {
    record: (failure, cause, prevention, regressionEval) => {
      const id = `failure-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const record: FailureRecord = { id, failure, cause, prevention, regressionEval, timestamp: Date.now() }
      records.set(id, record)
      return record
    },
    get: (id) => records.get(id),
    list: () => [...records.values()],
    toEvals: () => [...records.values()].map((r) => r.regressionEval).filter((r): r is string => r.length > 0),
  }
}