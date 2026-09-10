import { describe, expect, test } from "bun:test"
import { CognitiveEngine } from "../../src/ocx/cognitive"
import type { LedgerEntry } from "../../src/ocx/ledger"

describe("CognitiveEngine failure pattern detection", () => {
  test("detects vibe coding drift when files are edited without prior reads", () => {
    const entries: LedgerEntry[] = [
      { kind: "edit", path: "src/server/auth.ts" },
    ]
    const diagnoses = CognitiveEngine.detectFailurePatterns({
      entries,
      changedFiles: ["src/server/auth.ts"],
      userPrompt: "refactor the auth token check",
    })
    expect(diagnoses.some((d) => d.pattern === "VIBE_CODING_DRIFT")).toBe(true)
  })

  test("does not flag vibe coding drift when target was previously read", () => {
    const entries: LedgerEntry[] = [
      { kind: "read", path: "src/server/auth.ts" },
      { kind: "edit", path: "src/server/auth.ts" },
    ]
    const diagnoses = CognitiveEngine.detectFailurePatterns({
      entries,
      changedFiles: ["src/server/auth.ts"],
      userPrompt: "refactor the auth token check",
    })
    expect(diagnoses.some((d) => d.pattern === "VIBE_CODING_DRIFT")).toBe(false)
  })

  test("detects repetitive tool failure loop", () => {
    const entries: LedgerEntry[] = [
      { kind: "command", command: "curl -sL https://broken.test/file.zip", outcome: "failed" },
      { kind: "command", command: "curl -sL https://broken.test/file.zip", outcome: "failed" },
    ]
    const diagnoses = CognitiveEngine.detectFailurePatterns({
      entries,
      changedFiles: [],
      userPrompt: "download the archive",
    })
    expect(diagnoses.some((d) => d.pattern === "REPETITIVE_TOOL_FAILURE")).toBe(true)
    expect(diagnoses.find((d) => d.pattern === "REPETITIVE_TOOL_FAILURE")?.remedy).toContain("pivot")
  })

  test("detects ungrounded kernel API guessing when C code is modified without in-tree header inspection", () => {
    const entries: LedgerEntry[] = [
      { kind: "read", path: "drivers/net/ethernet.c" },
      { kind: "edit", path: "drivers/net/ethernet.c" },
    ]
    const diagnoses = CognitiveEngine.detectFailurePatterns({
      entries,
      changedFiles: ["drivers/net/ethernet.c"],
      userPrompt: "update network ring buffer allocation",
    })
    expect(diagnoses.some((d) => d.pattern === "UNGROUNDED_API_GUESS")).toBe(true)
  })

  test("clears ungrounded kernel API guessing when in-tree header is inspected", () => {
    const entries: LedgerEntry[] = [
      { kind: "read", path: "include/linux/netdevice.h" },
      { kind: "read", path: "drivers/net/ethernet.c" },
      { kind: "edit", path: "drivers/net/ethernet.c" },
    ]
    const diagnoses = CognitiveEngine.detectFailurePatterns({
      entries,
      changedFiles: ["drivers/net/ethernet.c"],
      userPrompt: "update network ring buffer allocation",
    })
    expect(diagnoses.some((d) => d.pattern === "UNGROUNDED_API_GUESS")).toBe(false)
  })

  test("detects unverified token math when pointer arithmetic or page alignments are requested without computational probes", () => {
    const entries: LedgerEntry[] = [
      { kind: "read", path: "arch/arm64/mm/mmu.c" },
    ]
    const diagnoses = CognitiveEngine.detectFailurePatterns({
      entries,
      changedFiles: ["arch/arm64/mm/mmu.c"],
      userPrompt: "calculate page_align offset and bitmask for section mapping",
    })
    expect(diagnoses.some((d) => d.pattern === "UNVERIFIED_TOKEN_MATH")).toBe(true)
  })

  test("renders executive engine prompt block with actionable remediation", () => {
    const entries: LedgerEntry[] = [
      { kind: "edit", path: "kernel/sched/fair.c" },
    ]
    const envelope = CognitiveEngine.renderExecutiveEnvelope({
      workflow: "debugging",
      phase: "investigate",
      entries,
      changedFiles: ["kernel/sched/fair.c"],
      userPrompt: "fix scheduler deadlock",
    })
    expect(envelope.promptBlock).toContain("=== OCX GENERAL CODING EXECUTIVE ENGINE ===")
    expect(envelope.promptBlock).toContain("CAUTION - COGNITIVE HAZARDS DETECTED:")
    expect(envelope.promptBlock).toContain("VIBE_CODING_DRIFT")
    expect(envelope.directives.some((d) => d.includes("Hypothesis"))).toBe(true)
  })

  test("incorporates episodic reflexion memory from prior failed commands", () => {
    const sessionID = "ses_cog_reflexion_test"
    CognitiveEngine.Reflexion.recordFailure({
      sessionID,
      action: "curl -sL https://images.unsplash.com/photo-1",
      errorSnippet: "HTTP 403 Forbidden",
    })

    const envelope = CognitiveEngine.renderExecutiveEnvelope({
      sessionID,
      workflow: "coding",
      phase: "change",
      userPrompt: "build the landing page",
    })

    expect(envelope.promptBlock).toContain("=== EPISODIC REFLEXION MEMORY")
    expect(envelope.promptBlock).toContain("Server blocks automated requests")
    expect(envelope.promptBlock).toContain("Preserved Invariant:")
    CognitiveEngine.Reflexion.clearBuffer(sessionID)
  })
})
