import { describe, expect, test } from "bun:test"
import { Provenance } from "../../src/ocx/provenance"
import { SecretRedaction } from "../../src/ocx/secret-redaction"

describe("OCX provenance and secret handling", () => {
  test("parses bounded source and trust labels", () => {
    expect(Provenance.parseSource("task")).toBe("task")
    expect(Provenance.parseSource("random")).toBeUndefined()
    expect(Provenance.parseTrust("repository")).toBe("repository")
    expect(Provenance.reference(" task_123 ")).toBe("task_123")
    expect(Provenance.reference("bad === marker")).toBeUndefined()
  })

  test("redacts credentials without removing surrounding facts", () => {
    const result = SecretRedaction.redact(
      "The endpoint is ready; api_key=super-secret-value-123 and Authorization: Bearer abcdefghijklmnop1234.",
    )

    expect(result.redacted).toBe(true)
    expect(result.value).toContain("The endpoint is ready")
    expect(result.value).not.toContain("super-secret-value-123")
    expect(result.value).not.toContain("abcdefghijklmnop1234")
    expect(result.kinds).toEqual(expect.arrayContaining(["credential", "bearer-token"]))
  })

  test("redacts private keys and JWT-shaped values", () => {
    const result = SecretRedaction.redact(
      "-----BEGIN PRIVATE KEY-----\nsecret-material\n-----END PRIVATE KEY----- eyJaaaaaaaaaaa.bbbbbbbbbbb.ccccccccccc",
    )

    expect(result.value).not.toContain("secret-material")
    expect(result.value).not.toContain("eyJaaaaaaaaaaa")
    expect(result.kinds).toEqual(expect.arrayContaining(["private-key", "jwt"]))
  })
})
