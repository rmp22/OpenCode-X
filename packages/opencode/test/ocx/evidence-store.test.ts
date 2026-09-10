import { describe, expect, test } from "bun:test"
import {
  ContentAddressableEvidenceStore,
  EvidenceTamperingError,
  AcceptanceVerifier,
  AcceptanceVerificationError,
} from "@/ocx/evidence"
import { IntentWorkModel } from "@/ocx/intent-model"

describe("ContentAddressableEvidenceStore", () => {
  test("generates deterministic content hashes", () => {
    const store = new ContentAddressableEvidenceStore()
    const ev1 = store.record("read", { path: "package.json" }, { exists: true })
    const ev2 = store.record("read", { path: "package.json" }, { exists: true })

    expect(ev1.id).toBe(ev2.id)
    expect(ev1.hash).toBe(ev2.hash)
    expect(store.has(ev1.id)).toBe(true)
  })

  test("prohibits tampering with frozen records", () => {
    const store = new ContentAddressableEvidenceStore()
    const ev = store.record("bash", { cmd: "ls" }, { exitCode: 0 })
    expect(Object.isFrozen(ev)).toBe(true)
  })
})

describe("AcceptanceVerifier", () => {
  test("verifies criteria backed by store evidence", () => {
    const store = new ContentAddressableEvidenceStore()
    const verifier = new AcceptanceVerifier()
    const model = new IntentWorkModel()

    const ev = store.record("test", { test: "all" }, { pass: true })

    const req = model.addRequirement({
      id: "req-10",
      description: "Test acceptance",
      intentKind: "verification",
      criteria: [{ id: "crit-1", description: "all tests pass" }],
    })

    model.verifyCriteria("req-10", "crit-1", ev.id)

    const result = verifier.verifyTaskAcceptance([req], store)
    expect(result.passed).toBe(true)
  })

  test("fails when evidence is missing from store", () => {
    const store = new ContentAddressableEvidenceStore()
    const verifier = new AcceptanceVerifier()
    const model = new IntentWorkModel()

    const req = model.addRequirement({
      id: "req-11",
      description: "Test acceptance missing",
      intentKind: "verification",
      criteria: [{ id: "crit-2", description: "missing evidence" }],
    })

    model.verifyCriteria("req-11", "crit-2", "ev-non-existent-hash")

    expect(() => {
      verifier.verifyTaskAcceptance([req], store)
    }).toThrow(AcceptanceVerificationError)
  })
})
