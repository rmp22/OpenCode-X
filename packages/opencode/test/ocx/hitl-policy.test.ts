import { describe, expect, test } from "bun:test"
import { classifyActionRisk, requiresUserApproval } from "@/ocx/hitl/policy"
import { HitlInterventionCoordinator } from "@/ocx/hitl/intervention"

describe("HITL & Autonomy Policy", () => {
  test("classifies action risks appropriately", () => {
    expect(classifyActionRisk("read", { filePath: "package.json" })).toBe("low")
    expect(classifyActionRisk("edit", { filePath: "package.json" })).toBe("medium")
    expect(classifyActionRisk("bash", { command: "rm -rf /tmp/foo" })).toBe("critical")
  })

  test("determines user approval requirements by autonomy tier", () => {
    expect(requiresUserApproval("low", "full_autonomous")).toBe(false)
    expect(requiresUserApproval("critical", "full_autonomous")).toBe(true)
    expect(requiresUserApproval("medium", "supervised")).toBe(false)
    expect(requiresUserApproval("high", "supervised")).toBe(true)
    expect(requiresUserApproval("medium", "interactive")).toBe(true)
  })

  test("suspends and resumes via intervention coordinator", async () => {
    const coordinator = new HitlInterventionCoordinator()
    const request = {
      id: "req-1",
      risk: "critical" as const,
      reason: "Destructive file deletion",
      actionDescription: "rm -rf build",
    }

    const approvalPromise = coordinator.requestApproval(request)
    expect(coordinator.getPendingRequests()).toHaveLength(1)

    coordinator.submitResponse("req-1", { approved: true })
    const response = await approvalPromise
    expect(response.approved).toBe(true)
    expect(coordinator.getPendingRequests()).toHaveLength(0)
  })
})
