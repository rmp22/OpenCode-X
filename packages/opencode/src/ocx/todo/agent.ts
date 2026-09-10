import type { Effect } from "effect"

export type TodoItem = {
  readonly content: string
  readonly status: string
  readonly priority: string
}

export type TodoStore = {
  readonly get: (sessionID: string) => Effect.Effect<TodoItem[]>
}
