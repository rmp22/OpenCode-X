import type { TodoItem } from "./agent"

export const MAX_NUDGES = 2

export function openTodos(todos: readonly TodoItem[]): TodoItem[] {
  return todos.filter((item) => item.status === "pending" || item.status === "in_progress")
}

export function nudgeText(open: readonly TodoItem[]): string {
  const items = open.map((item) => `- [${item.status}] ${item.content}`).join("\n")
  return `OCX todo guard: the todo list still has open items:\n${items}\nBefore stopping, use the todowrite tool to mark finished items completed, cancel stale ones, or keep working on the next item. Do not end with a stale list.`
}
