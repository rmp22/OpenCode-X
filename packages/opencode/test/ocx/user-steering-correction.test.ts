import { describe, expect, test } from "bun:test"
import { FindingLedger } from "../../src/ocx/findings/ledger"
import {
  openActivity,
  recordHeartbeat,
  isSessionStalled,
  clearStalledOnUserSteering,
  clearAll,
} from "../../src/ocx/activity/runtime"

describe("User Steering Correction Loop", () => {
  test("user steering suppresses findings when user explicitly overrides/allows them", () => {
    const ledger = new FindingLedger()

    ledger.record({
      id: "f1",
      detector: "magic-value",
      code: "MV-repeated-magic-string",
      severity: "warning",
      confidence: "high",
      target: "src/theme.ts",
      message: "string literal repeated",
      enforcement: "advisory",
    })

    expect(ledger.getActiveFindings().length).toBe(1)

    const suppressed = ledger.suppressContradictedFindings(
      "Please ignore and allow string literals in src/theme.ts",
    )
    expect(suppressed.length).toBe(1)
    expect(suppressed[0].lifecycleState).toBe("SUPPRESSED")
    expect(ledger.getActiveFindings().length).toBe(0)
    expect(ledger.getResolvedFindings().length).toBe(1)
  })

  test("user steering clears stalled activity state", () => {
    clearAll()
    const sessionID = "ses-steer-stall"

    openActivity(sessionID, "stalled_task", { title: "Waiting on external input" })
    recordHeartbeat(sessionID)

    expect(isSessionStalled(sessionID, 30000, Date.now() + 40000)).toBe(true)

    clearStalledOnUserSteering(sessionID)
    expect(isSessionStalled(sessionID, 30000, Date.now() + 5000)).toBe(false)
  })
})
