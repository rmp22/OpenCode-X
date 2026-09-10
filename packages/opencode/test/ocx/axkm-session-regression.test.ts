import { describe, expect, test } from "bun:test"
import { isWorkspaceSearchCommand, isGenuineGitSearch } from "../../src/ocx/search-routing"
import { SearchCache } from "../../src/ocx/search/cache"
import { FindingLedger } from "../../src/ocx/findings/ledger"
import { isDomainSpecificLiteral, isGenericConstantName, isSemanticConstantName } from "../../src/ocx/antislop/magic-value"
import { isDispatcherOrStateMachine, calculateMaxNestingDepth } from "../../src/ocx/antislop/architecture"
import { isJavaLangType, isGenuineMissingJavaImport } from "../../src/ocx/verification/diagnostics"
import { create, recordCallerEvidence, verifyCaller, isAllCallersVerified, compactWorkingSet } from "../../src/ocx/codebase/working-set"
import { validateTextClaims } from "../../src/ocx/turn/claim"
import { isEmptyResponse, continuePrompt, EMPTY_RESPONSE_MAX_ATTEMPTS } from "../../src/ocx/ocx-retry"
import {
  openActivity,
  recordHeartbeat,
  recordActiveWorkEvidence,
  isSessionStalled,
  openSubagentActivity,
  completeSubagentActivity,
  reconcileTerminal,
  ActivityEventThrottler,
  clearAll,
} from "../../src/ocx/activity/runtime"

describe("AxKM Session Regression Suite (RF-01 through RF-12)", () => {
  test("RF-01: search routing and bash command canonicalization", () => {
    expect(isWorkspaceSearchCommand("grep -rn foo src/")).toBe(true)
    expect(isWorkspaceSearchCommand("rg foo src/")).toBe(true)
    expect(isWorkspaceSearchCommand("find . -name '*.ts' -exec grep bar {} +")).toBe(true)
    expect(isWorkspaceSearchCommand("git grep term")).toBe(true)

    expect(isGenuineGitSearch("git grep foo HEAD")).toBe(true)
    expect(isGenuineGitSearch("git grep --cached foo")).toBe(true)
    expect(isGenuineGitSearch("git log -S foo")).toBe(true)
  })

  test("RF-02: search scope management and cache key distinction", () => {
    const k1 = SearchCache.key({ pattern: "auth", cwd: "/r", scope: "/r", include: "*.ts" })
    const k2 = SearchCache.key({ pattern: "auth", cwd: "/r", scope: "/r", include: "*.js" })
    expect(k1).not.toBe(k2)
  })

  test("RF-03: anti-slop finding convergence and oscillation detection", () => {
    const ledger = new FindingLedger()
    ledger.recordTurnFileCounts("src/a.ts", 1, ["R1"])
    ledger.recordTurnFileCounts("src/a.ts", 3, ["R1", "R2"])
    ledger.recordTurnFileCounts("src/a.ts", 5, ["R1", "R2", "R3"])
    expect(ledger.shouldHaltRepair("src/a.ts")).toBe(true)
  })

  test("RF-04: semantic constant hygiene and domain literal allowlisting", () => {
    expect(isDomainSpecificLiteral("SELECT id FROM users")).toBe(true)
    expect(isDomainSpecificLiteral("^[a-z]+$")).toBe(true)
    expect(isDomainSpecificLiteral("#ffffff")).toBe(true)
    expect(isGenericConstantName("CONST_1")).toBe(true)
    expect(isSemanticConstantName("MAX_RETRY_LIMIT")).toBe(true)
  })

  test("RF-05: architecture complexity guard exemptions", () => {
    const dispatcher = "function d(x) { switch(x) { case 1: return 1; case 2: return 2; case 3: return 3; case 4: return 4; default: return 0; } }"
    expect(isDispatcherOrStateMachine(dispatcher)).toBe(true)
    expect(calculateMaxNestingDepth("function f() { if (true) return 1 }")).toBeLessThan(5)
  })

  test("RF-06: language aware diagnostics for Java implicit imports", () => {
    expect(isJavaLangType("String")).toBe(true)
    expect(isJavaLangType("System")).toBe(true)
    expect(isGenuineMissingJavaImport("String")).toBe(false)
    expect(isGenuineMissingJavaImport("com.foo.CustomBar")).toBe(true)
  })

  test("RF-07: caller evidence working set tracking and compaction survival", () => {
    let ws = create("t-rf07")
    ws = recordCallerEvidence(ws, { symbol: "login", callerFile: "src/auth.ts", line: 10, verified: false })
    expect(isAllCallersVerified(ws, "login")).toBe(false)

    const compacted = compactWorkingSet(ws)
    expect(compacted.callerEvidence?.length).toBe(1)

    ws = verifyCaller(ws, "src/auth.ts", 10)
    expect(isAllCallersVerified(ws, "login")).toBe(true)
  })

  test("RF-08: verification and claim truth requires empirical evidence", () => {
    const unsubstantiated = "VERIFIED: The UI looks great"
    const findings1 = validateTextClaims(unsubstantiated)
    expect(findings1.some((f) => f.rule === "C-unsubstantiated-verified-claim")).toBe(true)

    const substantiated = "VERIFIED: Test suite passes src/test.ts:42"
    const findings2 = validateTextClaims(substantiated)
    expect(findings2.some((f) => f.rule === "C-unsubstantiated-verified-claim")).toBe(false)
  })

  test("RF-09: empty response recovery and bounded automatic continuation", () => {
    expect(isEmptyResponse([], [])).toBe(true)
    expect(isEmptyResponse([{ type: "text", text: "   " }], [])).toBe(true)
    expect(EMPTY_RESPONSE_MAX_ATTEMPTS).toBe(2)
    expect(continuePrompt(1, "last edit")).toContain("[last edit]")
  })

  test("RF-10: activity runtime heartbeat, stall detection, and subagent isolation", () => {
    clearAll()
    const parentSessionID = "rf10-parent"
    const childSessionID = "rf10-child"

    openSubagentActivity(childSessionID, parentSessionID, "explore", "scanning")
    recordHeartbeat(childSessionID)
    recordActiveWorkEvidence(childSessionID, "token", 1)

    expect(isSessionStalled(childSessionID, 30000, Date.now())).toBe(false)

    completeSubagentActivity(childSessionID, parentSessionID, true)
  })

  test("RF-11: status reconciliation and terminal cleanup", () => {
    clearAll()
    const sessionID = "rf11-ses"
    openActivity(sessionID, "job_1", { title: "Doing work" })
    const terminated = reconcileTerminal(sessionID, "completed")
    expect(terminated.length).toBe(1)
    expect(terminated[0].state).toBe("completed")
  })

  test("RF-12: activity event performance throttling and queue bounding", () => {
    const throttler = new ActivityEventThrottler()
    const queue: { isStateChange: boolean }[] = []

    expect(throttler.shouldEmit(false, 100, 1000)).toBe(true)
    expect(throttler.shouldEmit(false, 100, 1050)).toBe(false)
    expect(throttler.shouldEmit(true, 100, 1060)).toBe(true)

    for (let i = 0; i < 60; i++) {
      throttler.enqueueWithBounding(queue, { isStateChange: false }, 50)
    }
    expect(queue.length).toBe(50)
  })
})
