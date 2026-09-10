import { describe, expect, test } from "bun:test"
import { NodeContextAssembler } from "@/ocx/context/node-assembler"
import { CAPABILITY_PROFILES } from "@/ocx/graph/capabilities"

describe("NodeContextAssembler & Declarative Filtering", () => {
  const baseContext = {
    nodeId: "exec_1",
    instruction: "Implement authentication provider",
    activeStep: {
      id: "step_1",
      title: "JWT auth",
      action: "Create jwt service",
      status: "in_progress" as const,
      checks: [],
    },
    capabilities: CAPABILITY_PROFILES.EXECUTION,
    relevantFiles: ["src/auth/jwt.ts", "src/auth/types.ts"],
    domainGuidance: "=== DOMAIN GUIDANCE: auth ===\nUse constant time compare\n=== END DOMAIN GUIDANCE ===",
    practicePacks: "=== PRACTICE PACK: crypto ===\nEnsure argon2 iterations >= 3\n=== END PRACTICE PACK ===",
    recentEvidence: [
      {
        id: "ev1",
        nodeId: "exec_1",
        kind: "test_run",
        detail: "jwt unit test pass",
        timestamp: Date.now(),
      },
    ],
  }

  test("assembles full context when within budget", () => {
    const assembled = NodeContextAssembler.assemble(baseContext)
    expect(assembled.promptEnvelope).toContain("=== NODE INSTRUCTION (exec_1) ===")
    expect(assembled.promptEnvelope).toContain("=== CAPABILITIES ===")
    expect(assembled.promptEnvelope).toContain("=== ACTIVE STEP ===")
    expect(assembled.promptEnvelope).toContain("=== RELEVANT FILES ===")
    expect(assembled.promptEnvelope).toContain("=== DOMAIN GUIDANCE: auth ===")
    expect(assembled.truncatedSections).toEqual([])
  })

  test("excludes sections specified in declaration", () => {
    const assembled = NodeContextAssembler.assemble(baseContext, {
      requiredContext: [],
      optionalContext: [],
      excludedContext: ["domainGuidance", "practicePacks"],
    })
    expect(assembled.promptEnvelope).not.toContain("DOMAIN GUIDANCE")
    expect(assembled.promptEnvelope).not.toContain("PRACTICE PACK")
    expect(assembled.promptEnvelope).toContain("=== RELEVANT FILES ===")
  })

  test("budget truncation drops optional sections when budget exceeded", () => {
    const tightBudget = NodeContextAssembler.assemble(baseContext, {
      requiredContext: [],
      optionalContext: [],
      excludedContext: [],
      maxChars: 400,
    })
    expect(tightBudget.promptEnvelope).toContain("NODE INSTRUCTION")
    expect(tightBudget.promptEnvelope).toContain("CAPABILITIES")
    expect(tightBudget.truncatedSections.length).toBeGreaterThan(0)
    expect(tightBudget.charCount).toBeLessThanOrEqual(400)
  })

  test("cache-stable ordering places static sections before dynamic sections", () => {
    const assembled = NodeContextAssembler.assemble(baseContext)
    const env = assembled.promptEnvelope

    const idxInstruction = env.indexOf("=== NODE INSTRUCTION")
    const idxCapabilities = env.indexOf("=== CAPABILITIES ===")
    const idxGuidance = env.indexOf("=== DOMAIN GUIDANCE")
    const idxActiveStep = env.indexOf("=== ACTIVE STEP ===")
    const idxRecentEvidence = env.indexOf("=== RECENT EVIDENCE ===")

    expect(idxInstruction).toBeLessThan(idxCapabilities)
    expect(idxCapabilities).toBeLessThan(idxGuidance)
    expect(idxGuidance).toBeLessThan(idxActiveStep)
    expect(idxActiveStep).toBeLessThan(idxRecentEvidence)
  })

  test("governs assembly with maxTokens and reports accurate token metrics", () => {
    const assembled = NodeContextAssembler.assemble(baseContext, {
      maxTokens: 100,
    })
    expect(assembled.tokenCountEstimated).toBeLessThanOrEqual(100)
    expect(assembled.truncatedSections).toContain("recentEvidence")
  })
})
