import { describe, expect, test } from "bun:test"
import { RequestIntentAnalyzer } from "@/ocx/scope/intent-analyzer"

describe("request intent analyzer", () => {
  test("detects bug fix intent", () => {
    const result = RequestIntentAnalyzer.analyzeIntent("Fix the parser crash when input is null")
    expect(result.taskKind).toContain("bug_fix")
  })

  test("detects cleanup intent", () => {
    const result = RequestIntentAnalyzer.analyzeIntent("Clean AI slop in the feature module")
    expect(result.taskKind).toContain("cleanup")
    expect(result.taskKind).toContain("ai_slop_removal")
  })

  test("detects hardening intent", () => {
    const result = RequestIntentAnalyzer.analyzeIntent("Harden the authentication flow for production")
    expect(result.taskKind).toContain("hardening")
  })

  test("detects architecture intent", () => {
    const result = RequestIntentAnalyzer.analyzeIntent("Refactor the architecture to use a single source of truth")
    expect(result.taskKind).toContain("architecture")
  })

  test("detects minimal patch request", () => {
    const result = RequestIntentAnalyzer.analyzeIntent("Make the smallest change to fix the typo")
    expect(result.minimalPatchRequested).toBe(true)
  })

  test("detects production readiness request", () => {
    const result = RequestIntentAnalyzer.analyzeIntent("Make this subsystem production ready")
    expect(result.productionReadinessRequested).toBe(true)
    expect(result.qualityBar).toBe("production")
  })

  test("detects explicit scope", () => {
    const result = RequestIntentAnalyzer.analyzeIntent("Fix the recents stack behavior: scope: recents stack")
    expect(result.explicitScope).toBe("recents stack")
  })

  test("detects WIP preservation request", () => {
    const result = RequestIntentAnalyzer.analyzeIntent("Fix this but preserve my unrelated WIP")
    expect(result.preserveUnrelatedWip).toBe(true)
  })

  test("classifies standard quality bar for generic requests", () => {
    const result = RequestIntentAnalyzer.analyzeIntent("Fix the bug in the login flow")
    expect(result.qualityBar).toBe("standard")
  })

  test("classifies comprehensive quality bar", () => {
    const result = RequestIntentAnalyzer.analyzeIntent("Comprehensive fix for the state sync issue")
    expect(result.qualityBar).toBe("comprehensive")
  })

  test("returns empty task kind for unrelated text", () => {
    const result = RequestIntentAnalyzer.analyzeIntent("Add a new feature for user profiles")
    expect(result.taskKind).toContain("feature")
  })
})
