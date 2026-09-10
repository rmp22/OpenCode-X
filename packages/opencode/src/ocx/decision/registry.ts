import type { DecisionRecord } from "./types"

export class DecisionRegistry {
  private decisions = new Map<string, DecisionRecord>()

  recordDecision(decision: {
    id: string
    title: string
    rationale: string
    alternativesConsidered: string[]
    chosenAlternative: string
    invariants?: string[]
  }): DecisionRecord {
    const record: DecisionRecord = {
      id: decision.id,
      title: decision.title,
      rationale: decision.rationale,
      alternativesConsidered: [...decision.alternativesConsidered],
      chosenAlternative: decision.chosenAlternative,
      timestamp: Date.now(),
      invariants: decision.invariants ? [...decision.invariants] : [],
    }
    this.decisions.set(decision.id, record)
    return record
  }

  getDecision(id: string): DecisionRecord | undefined {
    return this.decisions.get(id)
  }

  getAllDecisions(): DecisionRecord[] {
    return Array.from(this.decisions.values())
  }

  clear(): void {
    this.decisions.clear()
  }
}

export const defaultDecisionRegistry = new DecisionRegistry()
