import { describe, expect, test } from "bun:test"
import { EvidenceCollector, EvidenceVerifier, type ClaimRecord } from "@/ocx/evidence"

describe("Evidence Verification & Collection", () => {
  test("collects test_run and typecheck evidence from bash commands", () => {
    const collector = new EvidenceCollector()

    const testEv = collector.ingestBashOutput("bun test test/ocx/foo.test.ts", "10 pass, 0 fail", 0)
    expect(testEv).toBeDefined()
    expect(testEv?.kind).toBe("test_run")

    const typecheckEv = collector.ingestBashOutput("bun typecheck", "tsgo --noEmit", 0)
    expect(typecheckEv).toBeDefined()
    expect(typecheckEv?.kind).toBe("typecheck")

    const failedTest = collector.ingestBashOutput("bun test", "1 fail", 1)
    expect(failedTest).toBeUndefined()
  })

  test("collects diff_inspection from file mutations", () => {
    const collector = new EvidenceCollector()
    const mutEv = collector.ingestFileMutation("edit", "src/core/auth.ts", "+1 line")
    expect(mutEv.kind).toBe("diff_inspection")
    expect(mutEv.source).toBe("edit:src/core/auth.ts")
  })

  test("terminal verification blocks when required evidence is missing", () => {
    const pipeline = "code-mutation-pipeline"
    const onlyDiff = [
      {
        id: "ev1",
        kind: "diff_inspection" as const,
        source: "edit:foo.ts",
        detail: "changed",
        timestamp: Date.now(),
      },
    ]

    const result = EvidenceVerifier.verify(pipeline, onlyDiff)
    expect(result.satisfied).toBe(false)
    expect(result.missing.length).toBe(1)
    expect(result.missing[0]).toContain("test_run OR typecheck")
  })

  test("terminal verification passes when all required clauses are satisfied", () => {
    const pipeline = "code-mutation-pipeline"
    const validEvidence = [
      {
        id: "ev1",
        kind: "diff_inspection" as const,
        source: "edit:foo.ts",
        detail: "changed",
        timestamp: Date.now(),
      },
      {
        id: "ev2",
        kind: "test_run" as const,
        source: "bun test",
        detail: "5 pass",
        timestamp: Date.now(),
      },
    ]

    const result = EvidenceVerifier.verify(pipeline, validEvidence)
    expect(result.satisfied).toBe(true)
    expect(result.missing.length).toBe(0)
    expect(result.satisfiedItems.length).toBe(2)
  })

  test("exploration pipeline satisfied with read artifacts", () => {
    const pipeline = "interactive-exploration-pipeline"
    const readEv = [
      {
        id: "ev_read",
        kind: "read_artifact" as const,
        source: "read:README.md",
        detail: "read file",
        timestamp: Date.now(),
      },
    ]

    const result = EvidenceVerifier.verify(pipeline, readEv)
    expect(result.satisfied).toBe(true)
  })

  test("records real execution evidence with full provenance", () => {
    const collector = new EvidenceCollector()
    const ev = collector.recordExecutionEvidence({
      source: "test",
      kind: "test_run",
      rawOutput: "bun test: 12 pass, 0 fail",
      exitCode: 0,
      confidence: "high",
    })

    expect(ev.id).toBeDefined()
    expect(ev.rawOutput).toBe("bun test: 12 pass, 0 fail")
    expect(ev.confidence).toBe("high")
    expect(ev.verifiable).toBe(true)
    expect(collector.getItems().length).toBe(1)
  })

  test("rejects synthetic, placeholder, and empty evidence", () => {
    const collector = new EvidenceCollector()

    expect(() =>
      collector.recordExecutionEvidence({
        source: "command",
        kind: "runtime_log",
        rawOutput: "",
      }),
    ).toThrow()

    expect(() =>
      collector.recordExecutionEvidence({
        source: "command",
        kind: "runtime_log",
        rawOutput: "TODO",
      }),
    ).toThrow()

    expect(() =>
      collector.recordExecutionEvidence({
        source: "command",
        kind: "runtime_log",
        rawOutput: "placeholder result",
      }),
    ).toThrow()

    expect(() =>
      collector.recordExecutionEvidence({
        source: "command",
        kind: "runtime_log",
        rawOutput: "synthetic",
      }),
    ).toThrow()
  })

  test("claim verification: binds claim to evidence and marks VERIFIED", () => {
    const collector = new EvidenceCollector()
    const ev = collector.recordExecutionEvidence({
      source: "test",
      kind: "test_run",
      rawOutput: "PASS test/auth.test.ts (10 pass)",
      exitCode: 0,
    })

    const claim: ClaimRecord = {
      id: "claim_auth_test",
      type: "test_passes",
      statement: "Auth tests pass cleanly",
      status: "UNVERIFIED",
      evidenceIds: [ev.id],
      timestamp: Date.now(),
    }

    const verifiedClaim = EvidenceVerifier.verifyClaim(claim, collector.getItems())
    expect(verifiedClaim.status).toBe("VERIFIED")
  })

  test("claim verification: unbound claims cannot be marked VERIFIED", () => {
    const claimNoEvidence: ClaimRecord = {
      id: "claim_unbound",
      type: "typecheck_clean",
      statement: "Typecheck clean",
      status: "UNVERIFIED",
      evidenceIds: [],
      timestamp: Date.now(),
    }

    const res = EvidenceVerifier.verifyClaim(claimNoEvidence, [])
    expect(res.status).toBe("UNVERIFIED")

    const claimMissingEv: ClaimRecord = {
      ...claimNoEvidence,
      evidenceIds: ["ev_nonexistent_999"],
    }
    const resMissing = EvidenceVerifier.verifyClaim(claimMissingEv, [])
    expect(resMissing.status).toBe("UNVERIFIED")
  })

  test("claim verification: stale evidence downgrades claim to UNVERIFIED", () => {
    const staleTime = Date.now() - 1000 * 60 * 120 // 2 hours ago
    const staleEv = {
      id: "ev_stale",
      source: "typecheck",
      kind: "typecheck" as const,
      detail: "Clean",
      rawOutput: "tsgo --noEmit: clean",
      exitCode: 0,
      timestamp: staleTime,
    }

    const claim: ClaimRecord = {
      id: "claim_stale",
      type: "typecheck_clean",
      statement: "Clean typecheck",
      status: "UNVERIFIED",
      evidenceIds: [staleEv.id],
      timestamp: staleTime,
      staleAfter: staleTime + 1000 * 60 * 30, // Stale after 30 minutes
    }

    const res = EvidenceVerifier.verifyClaim(claim, [staleEv], { maxAgeMs: 1000 * 60 * 60 })
    expect(res.status).toBe("UNVERIFIED")
  })

  test("claim verification: conflicting evidence invalidates claim", () => {
    const failedEv = {
      id: "ev_failed",
      source: "test",
      kind: "test_run" as const,
      detail: "Test run failed",
      rawOutput: "FAIL test/login.test.ts: 1 failed, 2 passed",
      exitCode: 1,
      timestamp: Date.now(),
    }

    const claim: ClaimRecord = {
      id: "claim_conflicted",
      type: "test_passes",
      statement: "Login tests passing",
      status: "UNVERIFIED",
      evidenceIds: [failedEv.id],
      timestamp: Date.now(),
    }

    const res = EvidenceVerifier.verifyClaim(claim, [failedEv])
    expect(res.status).toBe("INVALIDATED")
  })
})
