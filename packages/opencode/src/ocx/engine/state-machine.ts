export type WorkflowStage =
  | "discover"
  | "plan"
  | "execute"
  | "verify"
  | "complete"
  | "blocked"
  | "needs_input"

export type WorkstreamStepStatus = "pending" | "ready" | "active" | "completed" | "blocked" | "failed"

export type CheckEvidence = {
  readonly checkID: string
  readonly status: "passed" | "failed"
  readonly evidenceRef: string
  readonly timestamp: number
  readonly message?: string
}

export type PlanStepDef = {
  readonly id: string
  readonly action: string
  readonly target?: string
  readonly checks: readonly string[]
  readonly dependencies?: readonly string[]
  readonly status: WorkstreamStepStatus
}

export type WorkstreamDef = {
  readonly id: string
  readonly goal: string
  readonly steps: readonly PlanStepDef[]
}

export type TaskState = {
  readonly sessionID: string
  readonly stage: WorkflowStage
  readonly revision: number
  readonly activeWorkstream?: string
  readonly activeStep?: string
  readonly authorizedPaths: readonly string[]
  readonly verifiedChecks: readonly CheckEvidence[]
  readonly workstreams: readonly WorkstreamDef[]
  readonly contextReady: boolean
  readonly blocker?: string
}

export type EngineEvent =
  | { readonly type: "TASK_INTAKE"; readonly prompt: string; readonly scopeRoots: readonly string[] }
  | { readonly type: "CONTEXT_READY"; readonly greenfield: boolean }
  | { readonly type: "PLAN_COMMITTED"; readonly goal: string; readonly workstreams: readonly WorkstreamDef[] }
  | { readonly type: "STEP_ACTIVATED"; readonly workstreamID: string; readonly stepID: string }
  | { readonly type: "PATH_AUTHORIZED"; readonly paths: readonly string[] }
  | { readonly type: "CHECK_RECORDED"; readonly workstreamID: string; readonly stepID: string; readonly evidence: CheckEvidence }
  | { readonly type: "STEP_COMPLETED"; readonly workstreamID: string; readonly stepID: string }
  | { readonly type: "STEP_BLOCKED"; readonly workstreamID: string; readonly stepID: string; readonly reason: string }
  | { readonly type: "STAGE_TRANSITIONED"; readonly from: WorkflowStage; readonly to: WorkflowStage; readonly reason?: string }
  | { readonly type: "TASK_FINALIZED"; readonly summary: string }

export function initial(sessionID: string): TaskState {
  return {
    sessionID,
    stage: "discover",
    revision: 0,
    authorizedPaths: [],
    verifiedChecks: [],
    workstreams: [],
    contextReady: false,
  }
}

export function reduce(state: TaskState, event: EngineEvent): TaskState {
  switch (event.type) {
    case "TASK_INTAKE":
      return {
        ...state,
        revision: state.revision + 1,
        authorizedPaths: [...new Set([...state.authorizedPaths, ...event.scopeRoots])],
      }

    case "CONTEXT_READY":
      return {
        ...state,
        revision: state.revision + 1,
        contextReady: true,
        stage: state.stage === "discover" ? "plan" : state.stage,
      }

    case "PLAN_COMMITTED": {
      const authorized = new Set(state.authorizedPaths)
      for (const ws of event.workstreams) {
        for (const step of ws.steps) {
          if (step.target) authorized.add(step.target)
        }
      }
      return {
        ...state,
        revision: state.revision + 1,
        workstreams: event.workstreams,
        authorizedPaths: [...authorized],
        stage: "execute",
      }
    }

    case "STEP_ACTIVATED": {
      const workstreams = state.workstreams.map((ws) => {
        if (ws.id !== event.workstreamID) return ws
        return {
          ...ws,
          steps: ws.steps.map((step) => (step.id === event.stepID ? { ...step, status: "active" as const } : step)),
        }
      })
      return {
        ...state,
        revision: state.revision + 1,
        activeWorkstream: event.workstreamID,
        activeStep: event.stepID,
        workstreams,
        stage: "execute",
      }
    }

    case "PATH_AUTHORIZED":
      return {
        ...state,
        revision: state.revision + 1,
        authorizedPaths: [...new Set([...state.authorizedPaths, ...event.paths])],
      }

    case "CHECK_RECORDED": {
      const filtered = state.verifiedChecks.filter((c) => c.checkID !== event.evidence.checkID)
      return {
        ...state,
        revision: state.revision + 1,
        verifiedChecks: [...filtered, event.evidence],
      }
    }

    case "STEP_COMPLETED": {
      const workstreams = state.workstreams.map((ws) => {
        if (ws.id !== event.workstreamID) return ws
        return {
          ...ws,
          steps: ws.steps.map((step) => (step.id === event.stepID ? { ...step, status: "completed" as const } : step)),
        }
      })
      const isLastStep = workstreams.every((ws) => ws.steps.every((s) => s.status === "completed"))
      return {
        ...state,
        revision: state.revision + 1,
        activeWorkstream: undefined,
        activeStep: undefined,
        workstreams,
        stage: isLastStep ? "verify" : "execute",
      }
    }

    case "STEP_BLOCKED": {
      const workstreams = state.workstreams.map((ws) => {
        if (ws.id !== event.workstreamID) return ws
        return {
          ...ws,
          steps: ws.steps.map((step) => (step.id === event.stepID ? { ...step, status: "blocked" as const } : step)),
        }
      })
      return {
        ...state,
        revision: state.revision + 1,
        workstreams,
        blocker: event.reason,
        stage: "blocked",
      }
    }

    case "STAGE_TRANSITIONED":
      return {
        ...state,
        revision: state.revision + 1,
        stage: event.to,
        blocker: event.to === "blocked" ? event.reason : undefined,
      }

    case "TASK_FINALIZED":
      return {
        ...state,
        revision: state.revision + 1,
        stage: "complete",
      }

    default:
      return state
  }
}

export function canMutateTarget(state: TaskState, targetPath: string): boolean {
  if (state.stage !== "execute" && state.stage !== "verify") return false
  if (state.authorizedPaths.length === 0) return true
  const norm = targetPath.replaceAll("\\", "/").replace(/^\.\//, "")
  return state.authorizedPaths.some((auth) => {
    const authNorm = auth.replaceAll("\\", "/").replace(/^\.\//, "")
    return norm === authNorm || norm.startsWith(authNorm.endsWith("/") ? authNorm : `${authNorm}/`)
  })
}

export function allChecksPassed(state: TaskState): boolean {
  const allRequiredChecks = state.workstreams.flatMap((ws) => ws.steps.flatMap((s) => s.checks))
  if (allRequiredChecks.length === 0) return true
  const verifiedIDs = new Set(state.verifiedChecks.filter((c) => c.status === "passed").map((c) => c.checkID))
  return allRequiredChecks.every((checkID) => verifiedIDs.has(checkID))
}

export * as TaskStateMachine from "./state-machine"
