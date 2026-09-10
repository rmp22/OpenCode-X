import { describe, expect, test } from "bun:test"
import { topologicalSort } from "@/ocx/planning/dag"
import { AdaptivePlanner } from "@/ocx/planning/planner"
import type { PlanStep } from "@/ocx/planning/types"

describe("Adaptive Planner & DAG", () => {
  test("topologically sorts steps by dependency", () => {
    const steps: PlanStep[] = [
      { id: "step-3", title: "Step 3", level: "step", dependencies: ["step-2"], status: "pending" },
      { id: "step-1", title: "Step 1", level: "step", dependencies: [], status: "pending" },
      { id: "step-2", title: "Step 2", level: "step", dependencies: ["step-1"], status: "pending" },
    ]

    const sorted = topologicalSort(steps)
    expect(sorted.map((s) => s.id)).toEqual(["step-1", "step-2", "step-3"])
  })

  test("tracks executable steps and requires evidence for completion", () => {
    const planner = new AdaptivePlanner()
    planner.addStep({ id: "s1", title: "First", level: "step", dependencies: [], status: "pending" })
    planner.addStep({ id: "s2", title: "Second", level: "step", dependencies: ["s1"], status: "pending" })

    let executable = planner.getExecutableSteps()
    expect(executable.map((s) => s.id)).toEqual(["s1"])

    planner.completeStep("s1", "ev-12345")
    executable = planner.getExecutableSteps()
    expect(executable.map((s) => s.id)).toEqual(["s2"])

    expect(() => {
      planner.completeStep("s2", "")
    }).toThrow()
  })
})
