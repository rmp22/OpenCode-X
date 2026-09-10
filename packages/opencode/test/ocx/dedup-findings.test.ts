import { describe, expect, test } from "bun:test"
import {
  FindingLedger,
  determineEnforcement,
  computeFindingFingerprint,
} from "@/ocx/findings"

describe("Deduplicated Findings & Delta Prompt Injection", () => {
  test("computes deterministic fingerprint for identical findings", () => {
    const fp1 = computeFindingFingerprint({
      detector: "typecheck",
      code: "TS2345",
      target: "src/auth.ts",
      message: "Type mismatch",
    })
    const fp2 = computeFindingFingerprint({
      detector: "typecheck",
      code: "TS2345",
      target: "src/auth.ts",
      message: "Type mismatch",
    })
    expect(fp1).toBe(fp2)

    const fpDiff = computeFindingFingerprint({
      detector: "typecheck",
      code: "TS2345",
      target: "src/other.ts",
      message: "Type mismatch",
    })
    expect(fp1).not.toBe(fpDiff)
  })

  test("determines blocking enforcement for compiler errors and advisory for style", () => {
    const compilerBlocking = determineEnforcement("typecheck_compiler", "TS1005", "high")
    expect(compilerBlocking).toBe("blocking")

    const parserBlocking = determineEnforcement("ts_parser", "syntax_error", "high")
    expect(parserBlocking).toBe("blocking")

    const styleAdvisory = determineEnforcement("style_gate", "trailing_comma", "high")
    expect(styleAdvisory).toBe("advisory")

    const slopAdvisory = determineEnforcement("slop_gate", "boilerplate", "medium")
    expect(slopAdvisory).toBe("advisory")
  })

  test("deduplicates findings across multiple turns and injects only delta", () => {
    const ledger = new FindingLedger()

    const rec1 = ledger.record({
      id: "f1",
      detector: "typecheck",
      code: "TS2322",
      severity: "error",
      confidence: "high",
      target: "src/user.ts",
      message: "Type string is not assignable to type number",
      enforcement: "blocking",
    })
    expect(rec1.isNew).toBe(true)

    const delta1 = ledger.getUninjectedDelta()
    expect(delta1.length).toBe(1)
    expect(delta1[0].code).toBe("TS2322")

    const prompt1 = ledger.renderDeltaPrompt()
    expect(prompt1).toContain("[BLOCKING] typecheck (TS2322)")

    const deltaAfterInject = ledger.getUninjectedDelta()
    expect(deltaAfterInject.length).toBe(0)

    const recDuplicate = ledger.record({
      id: "f1_again",
      detector: "typecheck",
      code: "TS2322",
      severity: "error",
      confidence: "high",
      target: "src/user.ts",
      message: "Type string is not assignable to type number",
      enforcement: "blocking",
    })
    expect(recDuplicate.isNew).toBe(false)
    expect(recDuplicate.isChanged).toBe(false)

    expect(ledger.getUninjectedDelta().length).toBe(0)

    const savings = ledger.calculateDeltaSavings()
    expect(savings.totalTokensEstimated).toBeGreaterThan(0)
    expect(savings.deltaTokensEstimated).toBe(0)
    expect(savings.tokensSaved).toBe(savings.totalTokensEstimated)
    expect(savings.savingsPercent).toBe(100)
  })

  test("re-injects finding when message or content changes", () => {
    const ledger = new FindingLedger()

    ledger.record({
      id: "f_style",
      detector: "style_gate",
      code: "line_length",
      severity: "warning",
      confidence: "medium",
      target: "src/view.ts",
      message: "Line 42 exceeds 120 chars",
      enforcement: "advisory",
    })

    ledger.renderDeltaPrompt()
    expect(ledger.getUninjectedDelta().length).toBe(0)

    ledger.record({
      id: "f_style_updated",
      detector: "style_gate",
      code: "line_length",
      severity: "warning",
      confidence: "medium",
      target: "src/view.ts",
      message: "Line 42 and 43 exceed 120 chars",
      enforcement: "advisory",
    })

    const deltaChanged = ledger.getUninjectedDelta()
    expect(deltaChanged.length).toBe(1)
    expect(deltaChanged[0].message).toContain("43")
  })
})
