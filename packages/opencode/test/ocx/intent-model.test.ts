import { describe, expect, test } from "bun:test"
import { IntentWorkModel } from "@/ocx/intent-model"

describe("IntentWorkModel", () => {
  test("creates requirements and transitions state with evidence", () => {
    const model = new IntentWorkModel()
    const req = model.addRequirement({
      id: "req-1",
      description: "Optimize streaming hot path",
      intentKind: "mutation",
      criteria: [
        { id: "c-1", description: "Zero copy SSE frames" },
        { id: "c-2", description: "Backpressure pipeline" },
      ],
    })

    expect(req.state).toBe("admitted")
    model.transition("req-1", "planned", "Execution plan accepted")
    expect(model.getRequirement("req-1")?.state).toBe("planned")

    model.transition("req-1", "executed", "Code written")
    expect(model.getRequirement("req-1")?.state).toBe("executed")

    model.verifyCriteria("req-1", "c-1", "test passes")
    model.verifyCriteria("req-1", "c-2", "benchmark passes")
    expect(model.getRequirement("req-1")?.state).toBe("verified")
  })

  test("enforces mutation traceability to requirements", () => {
    const model = new IntentWorkModel()
    model.addRequirement({
      id: "req-2",
      description: "Fix retry jitter",
      intentKind: "mutation",
    })

    const link = model.linkMutation({
      mutationId: "mut-1",
      filePath: "src/session/retry.ts",
      requirementIds: ["req-2"],
    })

    expect(link.filePath).toBe("src/session/retry.ts")
    expect(model.getMutationLinksForFile("src/session/retry.ts")).toHaveLength(1)

    expect(() => {
      model.linkMutation({
        mutationId: "mut-2",
        filePath: "src/session/retry.ts",
        requirementIds: ["non-existent-req"],
      })
    }).toThrow()
  })
})
