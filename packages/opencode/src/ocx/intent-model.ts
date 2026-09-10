export type IntentKind = "mutation" | "inquiry" | "exploration" | "verification" | "refactoring"

export type WorkState = "admitted" | "planned" | "executed" | "verified"

export interface AcceptanceCriteria {
  id: string
  description: string
  verified: boolean
  evidence?: string
}

export interface Requirement {
  id: string
  description: string
  intentKind: IntentKind
  criteria: AcceptanceCriteria[]
  state: WorkState
}

export interface MutationLink {
  mutationId: string
  filePath: string
  requirementIds: string[]
  timestamp: number
}

export interface StateTransitionRecord {
  requirementId: string
  from: WorkState
  to: WorkState
  evidence: string
  timestamp: number
}

export class IntentWorkModel {
  private requirements = new Map<string, Requirement>()
  private mutationLinks: MutationLink[] = []
  private transitions: StateTransitionRecord[] = []

  addRequirement(req: {
    id: string
    description: string
    intentKind: IntentKind
    criteria?: Array<{ id: string; description: string }>
  }): Requirement {
    const requirement: Requirement = {
      id: req.id,
      description: req.description,
      intentKind: req.intentKind,
      criteria: (req.criteria ?? []).map((c) => ({
        id: c.id,
        description: c.description,
        verified: false,
      })),
      state: "admitted",
    }
    this.requirements.set(req.id, requirement)
    return requirement
  }

  transition(requirementId: string, to: WorkState, evidence: string): Requirement {
    const req = this.requirements.get(requirementId)
    if (!req) {
      throw new Error(`Requirement ${requirementId} not found`)
    }

    const validTransitions: Record<WorkState, WorkState[]> = {
      admitted: ["planned"],
      planned: ["executed"],
      executed: ["verified", "planned"],
      verified: [],
    }

    if (req.state !== to && !validTransitions[req.state].includes(to)) {
      throw new Error(`Invalid work state transition from ${req.state} to ${to}`)
    }

    this.transitions.push({
      requirementId,
      from: req.state,
      to,
      evidence,
      timestamp: Date.now(),
    })

    req.state = to
    return req
  }

  linkMutation(mutation: {
    mutationId: string
    filePath: string
    requirementIds: string[]
  }): MutationLink {
    for (const reqId of mutation.requirementIds) {
      if (!this.requirements.has(reqId)) {
        throw new Error(`Requirement ${reqId} not found for mutation link`)
      }
    }

    const link: MutationLink = {
      mutationId: mutation.mutationId,
      filePath: mutation.filePath,
      requirementIds: [...mutation.requirementIds],
      timestamp: Date.now(),
    }
    this.mutationLinks.push(link)
    return link
  }

  verifyCriteria(requirementId: string, criteriaId: string, evidence: string): boolean {
    const req = this.requirements.get(requirementId)
    if (!req) return false
    const criterion = req.criteria.find((c) => c.id === criteriaId)
    if (!criterion) return false
    criterion.verified = true
    criterion.evidence = evidence

    if (req.criteria.length > 0 && req.criteria.every((c) => c.verified)) {
      if (req.state === "executed") {
        this.transition(requirementId, "verified", `All criteria verified. Last: ${evidence}`)
      }
    }
    return true
  }

  getRequirement(id: string): Requirement | undefined {
    return this.requirements.get(id)
  }

  getMutationLinksForFile(filePath: string): MutationLink[] {
    return this.mutationLinks.filter((l) => l.filePath === filePath)
  }

  getTransitions(requirementId: string): StateTransitionRecord[] {
    return this.transitions.filter((t) => t.requirementId === requirementId)
  }
}

export * as IntentModel from "./intent-model"
