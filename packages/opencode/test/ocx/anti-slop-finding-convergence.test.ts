import { describe, expect, test } from "bun:test"
import { FindingLedger } from "../../src/ocx/findings/ledger"
import { computeFindingFingerprint } from "../../src/ocx/findings/types"
import { shouldHaltRepair, getOscillationReport } from "../../src/ocx/turn/gate"

describe("Anti-Slop Finding Convergence", () => {
  test("stable fingerprints are deterministic based on rule, target, code, and message", () => {
    const fp1 = computeFindingFingerprint({
      detector: "magic-value",
      code: "MV-generic-constant-name",
      target: "src/config.ts",
      message: "generic constant CONST_1",
    })
    const fp2 = computeFindingFingerprint({
      detector: "magic-value",
      code: "MV-generic-constant-name",
      target: "src/config.ts",
      message: "generic constant CONST_1",
    })
    const fp3 = computeFindingFingerprint({
      detector: "magic-value",
      code: "MV-generic-constant-name",
      target: "src/other.ts",
      message: "generic constant CONST_1",
    })

    expect(fp1).toBe(fp2)
    expect(fp1).not.toBe(fp3)
  })

  test("finding lifecycle transitions through OPEN, IN_PROGRESS, RESOLVED, and RECURRED", () => {
    const ledger = new FindingLedger()

    const rec1 = ledger.record({
      id: "f1",
      detector: "style",
      code: "STYLE-01",
      severity: "warning",
      confidence: "high",
      target: "src/foo.ts",
      message: "style violation",
      enforcement: "advisory",
    })
    expect(rec1.isNew).toBe(true)
    expect(rec1.finding.lifecycleState).toBe("OPEN")

    ledger.transitionState(rec1.finding.fingerprint, "IN_PROGRESS")
    expect(ledger.getActiveFindings()[0].lifecycleState).toBe("IN_PROGRESS")

    ledger.resolveFinding(rec1.finding.fingerprint)
    expect(ledger.getActiveFindings().length).toBe(0)
    expect(ledger.getResolvedFindings().length).toBe(1)
    expect(ledger.getResolvedFindings()[0].lifecycleState).toBe("RESOLVED")

    const rec2 = ledger.record({
      id: "f1",
      detector: "style",
      code: "STYLE-01",
      severity: "warning",
      confidence: "high",
      target: "src/foo.ts",
      message: "style violation",
      enforcement: "advisory",
    })
    expect(rec2.isNew).toBe(false)
    expect(rec2.finding.lifecycleState).toBe("RECURRED")
  })

  test("deduplication prevents re-emitting identical findings in delta prompt", () => {
    const ledger = new FindingLedger()
    ledger.record({
      id: "f1",
      detector: "architecture",
      code: "A-deep",
      severity: "error",
      confidence: "high",
      target: "src/deep.ts",
      message: "deep nesting",
      enforcement: "blocking",
    })

    const delta1 = ledger.getUninjectedDelta()
    expect(delta1.length).toBe(1)

    const renderedPrompt = ledger.renderDeltaPrompt()
    expect(renderedPrompt).toContain("deep nesting")

    const delta2 = ledger.getUninjectedDelta()
    expect(delta2.length).toBe(0)
  })

  test("oscillation detection halts automatic repair when finding counts increase consecutively", () => {
    const ledger = new FindingLedger()
    const file = "src/complex.ts"

    ledger.recordTurnFileCounts(file, 2, ["A-01"])
    expect(ledger.shouldHaltRepair(file)).toBe(false)

    ledger.recordTurnFileCounts(file, 4, ["A-01", "A-02"])
    expect(ledger.shouldHaltRepair(file)).toBe(false)

    ledger.recordTurnFileCounts(file, 6, ["A-01", "A-02", "A-03"])
    expect(ledger.shouldHaltRepair(file)).toBe(true)

    const report = ledger.getOscillationReport(file)
    expect(report).toBeDefined()
    expect(report).toContain("Oscillation detected")
    expect(report).toContain("Halting automatic repair")
  })

  test("gate export functions are available and callable", () => {
    expect(typeof shouldHaltRepair).toBe("function")
    expect(typeof getOscillationReport).toBe("function")
    expect(shouldHaltRepair("nonexistent.ts")).toBe(false)
  })
})
