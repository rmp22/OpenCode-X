import { TaskModel } from "../task-model"

export type Input = {
  readonly workflow: string
  readonly phase: string
  readonly hasOpenTodos: boolean
  readonly hasFailure: boolean
}

export function render(input: Input): string {
  const stage = TaskModel.stageKind(input.phase)
  const task = TaskModel.taskKind(input.workflow)
  const focus = stage === "validate"
    ? "Before completion, run the task-appropriate checks and keep failures visible."
    : stage === "act" || stage === "deliver"
      ? task === "coding" || task === "mixed"
        ? "Follow the active work item and verify the changed behavior before completion."
        : "Execute the active task action and preserve evidence needed for review or delivery."
      : stage === "plan"
        ? "Keep scope, ownership, risks, and acceptance checks explicit when planning is useful."
        : stage === "wait"
          ? "Do not invent progress while waiting. Resume only when the missing input or dependency changes."
          : "Keep the current task objective and its evidence bar in view."
  return [
    "=== OCX SALIENCE REFRESH ===",
    `Task: ${task}; workflow: ${input.workflow}; stage: ${input.phase}.`,
    focus,
    ...(input.hasOpenTodos ? ["Open todos remain part of the completion criteria."] : []),
    ...(input.hasFailure ? ["A failure is recorded; change the next action instead of repeating an unchanged attempt."] : []),
    "=== END OCX SALIENCE REFRESH ===",
  ].join("\n")
}

export * as Salience from "./salience"
