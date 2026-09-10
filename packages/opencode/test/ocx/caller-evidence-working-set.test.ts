import { describe, expect, test } from "bun:test"
import {
  create,
  recordCallerEvidence,
  verifyCaller,
  isAllCallersVerified,
  clearVerifiedCallers,
  compactWorkingSet,
} from "../../src/ocx/codebase/working-set"

describe("Caller Evidence Working Set", () => {
  test("caller evidence records modified symbol and caller locations", () => {
    let ws = create("task-01")
    expect(ws.callerEvidence?.length).toBe(0)

    ws = recordCallerEvidence(ws, [
      {
        symbol: "updateUser",
        callerFile: "src/routes/user.ts",
        line: 45,
        verified: false,
      },
      {
        symbol: "updateUser",
        callerFile: "src/controllers/admin.ts",
        line: 120,
        verified: false,
      },
    ])

    expect(ws.callerEvidence?.length).toBe(2)
    expect(ws.callerEvidence?.[0].symbol).toBe("updateUser")
    expect(isAllCallersVerified(ws, "updateUser")).toBe(false)
  })

  test("caller verification marks callers verified and tracks notes", () => {
    let ws = create("task-02")
    ws = recordCallerEvidence(ws, {
      symbol: "processPayment",
      callerFile: "src/checkout.ts",
      line: 88,
      verified: false,
    })

    expect(isAllCallersVerified(ws, "processPayment")).toBe(false)

    ws = verifyCaller(ws, "src/checkout.ts", 88, "Updated arguments to match new signature")
    expect(isAllCallersVerified(ws, "processPayment")).toBe(true)
    expect(ws.callerEvidence?.[0].verified).toBe(true)
    expect(ws.callerEvidence?.[0].verificationNote).toContain("Updated arguments")
  })

  test("unverified caller evidence survives working set compaction", () => {
    let ws = create("task-03")
    ws = recordCallerEvidence(ws, [
      {
        symbol: "authCheck",
        callerFile: "src/middleware.ts",
        line: 15,
        verified: true,
      },
      {
        symbol: "authCheck",
        callerFile: "src/socket.ts",
        line: 42,
        verified: false,
      },
    ])

    const compacted = compactWorkingSet(ws)
    expect(compacted.callerEvidence?.length).toBe(1)
    expect(compacted.callerEvidence?.[0].callerFile).toBe("src/socket.ts")
    expect(compacted.callerEvidence?.[0].verified).toBe(false)
  })

  test("clearVerifiedCallers leaves only pending unverified callers", () => {
    let ws = create("task-04")
    ws = recordCallerEvidence(ws, [
      {
        symbol: "logAudit",
        callerFile: "src/audit.ts",
        line: 10,
        verified: true,
      },
      {
        symbol: "logAudit",
        callerFile: "src/security.ts",
        line: 55,
        verified: false,
      },
    ])

    ws = clearVerifiedCallers(ws)
    expect(ws.callerEvidence?.length).toBe(1)
    expect(ws.callerEvidence?.[0].callerFile).toBe("src/security.ts")
  })
})
