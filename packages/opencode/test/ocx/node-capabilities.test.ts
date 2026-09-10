import { describe, expect, test } from "bun:test"
import {
  CAPABILITY_PROFILES,
  isToolAllowed,
  isBudgetExceeded,
  renderCapabilityNotice,
  profileForPhase,
} from "@/ocx/graph/capabilities"
import { apply as applyGate } from "@/ocx/turn/gate"
import type { GraphNode } from "@/ocx/graph/types"

describe("Node Capabilities and Budgets", () => {
  const planningNode: GraphNode = {
    id: "plan",
    label: "Planning",
    kind: "initial",
    allowedTools: CAPABILITY_PROFILES.PLANNING.allowedTools,
    deniedTools: CAPABILITY_PROFILES.PLANNING.deniedTools,
    tokenBudget: CAPABILITY_PROFILES.PLANNING.tokenBudget,
  }

  const executionNode: GraphNode = {
    id: "exec",
    label: "Execution",
    kind: "intermediate",
    allowedTools: CAPABILITY_PROFILES.EXECUTION.allowedTools,
    deniedTools: CAPABILITY_PROFILES.EXECUTION.deniedTools,
    tokenBudget: CAPABILITY_PROFILES.EXECUTION.tokenBudget,
  }

  test("planning profile blocks write and edit tools", () => {
    expect(isToolAllowed(planningNode, "write").allowed).toBe(false)
    expect(isToolAllowed(planningNode, "edit").allowed).toBe(false)
    expect(isToolAllowed(planningNode, "bash").allowed).toBe(false)
    expect(isToolAllowed(planningNode, "read").allowed).toBe(true)
    expect(isToolAllowed(planningNode, "grep").allowed).toBe(true)
  })

  test("execution profile allows all tools", () => {
    expect(isToolAllowed(executionNode, "write").allowed).toBe(true)
    expect(isToolAllowed(executionNode, "edit").allowed).toBe(true)
    expect(isToolAllowed(executionNode, "bash").allowed).toBe(true)
    expect(isToolAllowed(executionNode, "read").allowed).toBe(true)
  })

  test("budget exhaustion calculation", () => {
    expect(isBudgetExceeded(5000, 15000)).toBe(false)
    expect(isBudgetExceeded(15000, 15000)).toBe(true)
    expect(isBudgetExceeded(16000, 15000)).toBe(true)
  })

  test("profileForPhase infers profile by phase name", () => {
    expect(profileForPhase("plan").name).toBe("PLANNING")
    expect(profileForPhase("verify").name).toBe("VERIFICATION")
    expect(profileForPhase("audit").name).toBe("AUDIT")
    expect(profileForPhase("change").name).toBe("EXECUTION")
  })

  test("renderCapabilityNotice renders structured guidance", () => {
    const notice = renderCapabilityNotice(planningNode)
    expect(notice).toContain("=== NODE CAPABILITIES: Planning (initial) ===")
    expect(notice).toContain("ALLOWED TOOLS:")
    expect(notice).toContain("DENIED TOOLS: write, edit, bash")
    expect(notice).toContain("TOKEN BUDGET: 15000")
  })

  test("turn gate strips denied tools based on node capabilities", () => {
    const mockTools: Record<string, any> = {
      read: { description: "read" },
      write: { description: "write" },
      edit: { description: "edit" },
      grep: { description: "grep" },
    }

    applyGate(true, 1, mockTools, {
      phase: "plan",
      node: planningNode,
    })

    expect(mockTools.read).toBeDefined()
    expect(mockTools.grep).toBeDefined()
    expect(mockTools.write).toBeUndefined()
    expect(mockTools.edit).toBeUndefined()
  })
})
