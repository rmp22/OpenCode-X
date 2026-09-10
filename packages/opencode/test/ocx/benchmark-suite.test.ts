import { describe, expect, test } from "bun:test"

export interface BenchmarkTask {
  id: string
  name: string
  category: "repair" | "feature" | "refactor" | "greenfield"
  maxAllowedTurns: number
}

export interface BenchmarkExecution {
  taskId: string
  turnsUsed: number
  success: boolean
  firstTryPass: boolean
  tokens: number
}

export function runBenchmarkSuite(tasks: BenchmarkTask[], executions: BenchmarkExecution[]) {
  const total = tasks.length
  let successful = 0
  let firstTryCount = 0
  let totalTurns = 0

  for (const exec of executions) {
    if (exec.success) successful++
    if (exec.firstTryPass) firstTryCount++
    totalTurns += exec.turnsUsed
  }

  return {
    totalTasks: total,
    successRate: total > 0 ? successful / total : 0,
    firstTryPassRate: total > 0 ? firstTryCount / total : 0,
    avgTurnsPerTask: total > 0 ? totalTurns / total : 0,
  }
}

describe("Benchmark Suite", () => {
  test("evaluates developer benchmark tasks across categories", () => {
    const tasks: BenchmarkTask[] = [
      { id: "b1", name: "Fix null pointer in auth", category: "repair", maxAllowedTurns: 5 },
      { id: "b2", name: "Add dark mode toggle", category: "feature", maxAllowedTurns: 10 },
      { id: "b3", name: "Extract common helper", category: "refactor", maxAllowedTurns: 5 },
      { id: "b4", name: "Scaffold new microservice", category: "greenfield", maxAllowedTurns: 8 },
    ]

    const executions: BenchmarkExecution[] = [
      { taskId: "b1", turnsUsed: 2, success: true, firstTryPass: true, tokens: 3000 },
      { taskId: "b2", turnsUsed: 4, success: true, firstTryPass: false, tokens: 6000 },
      { taskId: "b3", turnsUsed: 1, success: true, firstTryPass: true, tokens: 1500 },
      { taskId: "b4", turnsUsed: 3, success: true, firstTryPass: true, tokens: 5000 },
    ]

    const metrics = runBenchmarkSuite(tasks, executions)
    expect(metrics.totalTasks).toBe(4)
    expect(metrics.successRate).toBe(1.0)
    expect(metrics.firstTryPassRate).toBe(0.75)
    expect(metrics.avgTurnsPerTask).toBe(2.5)
  })
})
