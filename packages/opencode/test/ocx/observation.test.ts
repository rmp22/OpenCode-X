import { describe, expect, it } from "bun:test"
import { ObservationCache } from "../../src/ocx/observation"
import { ClaimLifecycleManager } from "../../src/ocx/claims/manager"
import { EvidenceCollector } from "../../src/ocx/evidence/collector"

describe("ObservationCache", () => {
  it("deduplicates identical read operations", () => {
    const cache = new ObservationCache()
    const first = cache.record("file_read", "src/foo.ts", "const x = 1;")
    const second = cache.record("file_read", "src/foo.ts", "const x = 1;")

    expect(first.id).toBe(second.id)
    expect(cache.size()).toBe(1)
  })

  it("updates entry when content changes", () => {
    const cache = new ObservationCache()
    const first = cache.record("file_read", "src/foo.ts", "const x = 1;")
    const second = cache.record("file_read", "src/foo.ts", "const x = 2;")

    expect(first.id).not.toBe(second.id)
    expect(cache.size()).toBe(1)
    expect(cache.get("file_read", "src/foo.ts")?.content).toBe("const x = 2;")
  })

  it("distinguishes between file_read and shell_output for the same key", () => {
    const cache = new ObservationCache()
    cache.record("file_read", "git status", "file content")
    cache.record("shell_output", "git status", "working tree clean")

    expect(cache.size()).toBe(2)
    expect(cache.get("file_read", "git status")?.content).toBe("file content")
    expect(cache.get("shell_output", "git status")?.content).toBe("working tree clean")
  })

  it("expires stale observations on file invalidation", () => {
    const cache = new ObservationCache()
    cache.record("file_read", "src/foo.ts", "const a = 1;")
    cache.record("file_read", "src/bar.ts", "const b = 2;")
    cache.record("shell_output", "src/foo.ts", "cached shell")

    const invalidated = cache.invalidateFile("src/foo.ts")
    expect(invalidated).toBe(1)
    expect(cache.has("file_read", "src/foo.ts")).toBe(false)
    expect(cache.has("file_read", "src/bar.ts")).toBe(true)
    expect(cache.has("shell_output", "src/foo.ts")).toBe(true)
  })
})

describe("ClaimCitationVerifier", () => {
  it("verifies citations against real files and detects hallucinated line numbers", async () => {
    const manager = new ClaimLifecycleManager()

    const validCitation = {
      filePath: "package.json",
      lineNumber: 1,
    }
    const isValid = await manager.verifyCitation(validCitation)
    expect(isValid).toBe(true)

    const hallucinatedLine = {
      filePath: "package.json",
      lineNumber: 99999,
    }
    const isHallucinatedValid = await manager.verifyCitation(hallucinatedLine)
    expect(isHallucinatedValid).toBe(false)

    const nonexistentFile = {
      filePath: "does/not/exist/at/all.ts",
      lineNumber: 1,
    }
    const isNonexistentValid = await manager.verifyCitation(nonexistentFile)
    expect(isNonexistentValid).toBe(false)
  })

  it("verifies citation lists and identifies failed citations", async () => {
    const manager = new ClaimLifecycleManager()
    const result = await manager.verifyCitations([
      { filePath: "package.json", lineNumber: 1 },
      { filePath: "package.json", lineNumber: 99999 },
    ])

    expect(result.valid).toBe(false)
    expect(result.failedCitations.length).toBe(1)
    expect(result.failedCitations[0].lineNumber).toBe(99999)
  })
})

describe("EvidenceTerminalGate", () => {
  it("rejects terminal emit when claims remain unverified", () => {
    const collector = new EvidenceCollector()
    const claims = [
      { status: "verified" },
      { status: "asserted" },
    ]
    const check = collector.canEmitTerminal(claims)
    expect(check.allowed).toBe(false)
    expect(check.reason).toContain("1 claims remain unverified")
  })

  it("approves terminal emit when all claims are verified", () => {
    const collector = new EvidenceCollector()
    const claims = [
      { status: "verified" },
      { status: "verified" },
    ]
    const check = collector.canEmitTerminal(claims)
    expect(check.allowed).toBe(true)
  })
})
