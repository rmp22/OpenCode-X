import { describe, expect, test } from "bun:test"
import { redactSecrets } from "@/ocx/observability/emitter"

export function validateSafePath(path: string, rootDir: string): boolean {
  if (path.includes("\0")) return false
  if (path.includes("..")) {
    const segments = path.split("/").filter(Boolean)
    let depth = 0
    for (const s of segments) {
      if (s === "..") depth--
      else if (s !== ".") depth++
      if (depth < 0) return false
    }
  }
  return true
}

describe("Security Extension Surface", () => {
  test("prevents path traversal outside project root", () => {
    const root = "/workspace"
    expect(validateSafePath("src/index.ts", root)).toBe(true)
    expect(validateSafePath("../../../etc/passwd", root)).toBe(false)
    expect(validateSafePath("foo/../../bar/../../../root", root)).toBe(false)
  })

  test("redacts sensitive environment keys and tokens", () => {
    const payload = {
      user: "alice",
      token: "secret=ghp_9876543210abcdefghijklmnop",
      nested: {
        header: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
      },
    }

    const redacted = redactSecrets(payload) as any
    expect(redacted.token).toContain("[REDACTED_SECRET]")
    expect(redacted.token).not.toContain("ghp_9876543210abcdefghijklmnop")
    expect(redacted.nested.header).toContain("[REDACTED_SECRET]")
  })
})
