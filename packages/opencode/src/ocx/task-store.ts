export type TaskState =
  | "scoped"
  | "planned"
  | "acting"
  | "verifying"
  | "done"
  | "blocked"
  | "needs_input"
  | "failed"
  | "cancelled"

export type Task = {
  readonly id: string
  readonly sessionID: string
  readonly title: string
  readonly state: TaskState
  readonly scopeRoots: readonly string[]
  readonly evidence: readonly string[]
  readonly updatedAt: number
}

export const TERMINAL_STATES: readonly TaskState[] = ["done", "failed", "cancelled"]

const TRANSITIONS: Readonly<Record<TaskState, readonly TaskState[]>> = {
  scoped: ["planned", "blocked", "needs_input", "failed", "cancelled"],
  planned: ["acting", "blocked", "needs_input", "failed", "cancelled"],
  acting: ["verifying", "blocked", "needs_input", "failed", "cancelled"],
  verifying: ["done", "acting", "blocked", "needs_input", "failed", "cancelled"],
  done: [],
  blocked: ["planned", "failed", "cancelled"],
  needs_input: ["planned", "failed", "cancelled"],
  failed: [],
  cancelled: [],
}

export function canTransition(from: TaskState, to: TaskState): boolean {
  return TRANSITIONS[from].includes(to)
}

export function isTerminal(state: TaskState): boolean {
  return TERMINAL_STATES.includes(state)
}

export type TaskStore = {
  readonly create: (input: { sessionID: string; title: string; scopeRoots?: readonly string[] }) => Task
  readonly get: (sessionID: string) => Task | undefined
  readonly transition: (sessionID: string, to: TaskState) => Task
  readonly recordEvidence: (sessionID: string, ref: string) => Task
}

export function memoryStore(): TaskStore {
  const tasks = new Map<string, Task>()
  let sequence = 0
  return {
    create: (input) => {
      sequence += 1
      const task: Task = {
        id: `task-${sequence}`,
        sessionID: input.sessionID,
        title: input.title,
        state: "scoped",
        scopeRoots: input.scopeRoots ?? [],
        evidence: [],
        updatedAt: Date.now(),
      }
      tasks.set(input.sessionID, task)
      return task
    },
    get: (sessionID) => tasks.get(sessionID),
    transition: (sessionID, to) => {
      const current = tasks.get(sessionID)
      if (!current) throw new Error(`No task is scoped for session ${sessionID}`)
      if (!canTransition(current.state, to))
        throw new Error(`Task ${current.id} cannot transition from ${current.state} to ${to}`)
      const next: Task = { ...current, state: to, updatedAt: Date.now() }
      tasks.set(sessionID, next)
      return next
    },
    recordEvidence: (sessionID, ref) => {
      const current = tasks.get(sessionID)
      if (!current) throw new Error(`No task is scoped for session ${sessionID}`)
      if (isTerminal(current.state)) throw new Error(`Task ${current.id} is terminal (${current.state}); evidence is frozen`)
      const next: Task = { ...current, evidence: [...current.evidence, ref], updatedAt: Date.now() }
      tasks.set(sessionID, next)
      return next
    },
  }
}

export * as TaskStore from "./task-store"
