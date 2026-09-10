export type Operation = "read" | "patch" | "task" | "cancel" | "partial"
export type Category = "spec" | "env" | "agent" | "artifact" | "evaluator"

export type Record = {
  readonly operation: Operation
  readonly category: Category
  readonly message: string
  readonly retryable: boolean
  readonly nextAction: string
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  return "Unknown operation failure"
}

export function classify(error: unknown): Category {
  const text = errorText(error).toLocaleLowerCase()
  if (/(?:permission|denied|forbidden|invalid argument|schema|requirement)/.test(text)) return "spec"
  if (/(?:timeout|network|fetch|connection|spawn|enoent|not found|unavailable)/.test(text)) return "env"
  if (/(?:assert|expect|verification|typecheck|test failed|lint)/.test(text)) return "evaluator"
  if (/(?:parse|syntax|patch|write|read|file|directory)/.test(text)) return "artifact"
  return "agent"
}

function action(operation: Operation, category: Category): string {
  if (category === "spec") return "Re-read the active requirement and ask the user only for missing user-specific information."
  if (category === "env")
    return operation === "read" || operation === "patch"
      ? "Check the environment, retry the exact repository path, and preserve the failure evidence."
      : "Retry after checking the environment and preserve the exact failed command or path."
  if (category === "evaluator") return "Inspect the failed check, change one cause, and rerun the same check."
  if (operation === "read") return "Retry the read with the exact repository path and inspect the nearest known-good sibling."
  if (operation === "patch") return "Re-read the target and apply a smaller patch that changes only the failing span."
  if (operation === "task") return "Preserve the child task ID, inspect its failure, and resume or replace the approach deliberately."
  if (operation === "cancel") return "Confirm cancellation at the session boundary before scheduling more work."
  return "Record the completed portion, identify the missing boundary, and continue from the smallest safe next step."
}

export function create(input: { readonly operation: Operation; readonly error: unknown; readonly retryable?: boolean }): Record {
  const category = classify(input.error)
  return {
    operation: input.operation,
    category,
    message: errorText(input.error).slice(0, 400),
    retryable: input.retryable ?? category !== "spec",
    nextAction: action(input.operation, category),
  }
}

export function render(record: Record): string {
  return [
    `RECOVERY ${record.operation} (${record.category})`,
    `Failure: ${record.message}`,
    `Next: ${record.nextAction}`,
  ].join("\n")
}

export * as Recovery from "./recovery"
