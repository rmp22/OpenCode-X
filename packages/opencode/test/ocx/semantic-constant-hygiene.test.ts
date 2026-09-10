import { describe, expect, test } from "bun:test"
import {
  isGenericConstantName,
  isSemanticConstantName,
  isDomainSpecificLiteral,
  scanMagicValue,
} from "../../src/ocx/antislop/magic-value"

describe("Semantic Constant Hygiene", () => {
  test("generic constant names are rejected and semantic names are accepted", () => {
    expect(isGenericConstantName("CONST_1")).toBe(true)
    expect(isGenericConstantName("CONST_2")).toBe(true)
    expect(isGenericConstantName("STRING_VAL")).toBe(true)
    expect(isGenericConstantName("DATA")).toBe(true)
    expect(isGenericConstantName("TEMP")).toBe(true)
    expect(isGenericConstantName("VAL_1")).toBe(true)

    expect(isSemanticConstantName("MAX_RETRIES")).toBe(true)
    expect(isSemanticConstantName("DEFAULT_TIMEOUT_MS")).toBe(true)
    expect(isSemanticConstantName("DATABASE_CONNECTION_URL")).toBe(true)
    expect(isSemanticConstantName("SESSION_STORAGE_KEY")).toBe(true)
  })

  test("domain-specific literals are recognized and excluded from magic string enforcement", () => {
    expect(isDomainSpecificLiteral("SELECT * FROM users WHERE active = 1")).toBe(true)
    expect(isDomainSpecificLiteral("INSERT INTO events (id) VALUES (?)")).toBe(true)
    expect(isDomainSpecificLiteral("^[a-zA-Z0-9_-]+$")).toBe(true)
    expect(isDomainSpecificLiteral("\\d{4}-\\d{2}-\\d{2}")).toBe(true)
    expect(isDomainSpecificLiteral("Hello %s, your balance is %d")).toBe(true)
    expect(isDomainSpecificLiteral("{{user_name}}")).toBe(true)
    expect(isDomainSpecificLiteral("#ff0000")).toBe(true)
    expect(isDomainSpecificLiteral("#334455aa")).toBe(true)
    expect(isDomainSpecificLiteral("rgba(0, 0, 0, 0.5)")).toBe(true)
    expect(isDomainSpecificLiteral("application/json")).toBe(true)
    expect(isDomainSpecificLiteral("content-type")).toBe(true)
    expect(isDomainSpecificLiteral("GET")).toBe(true)

    expect(isDomainSpecificLiteral("unrecognized_arbitrary_business_string")).toBe(false)
  })

  test("test files and directories are exempt from constant scanning", () => {
    const code = `
      const a = "arbitrary_secret_token_foo"
      const b = "arbitrary_secret_token_foo"
      const c = "arbitrary_secret_token_foo"
      const timeout = 1000;
    `
    const testFindings = scanMagicValue(code, "packages/opencode/test/unit/foo.test.ts")
    expect(testFindings.length).toBe(0)

    const specFindings = scanMagicValue(code, "/workspace/test/fixture.ts")
    expect(specFindings.length).toBe(0)
  })

  test("single-use string literals are never flagged", () => {
    const code = `
      export function render() {
        const title = "unique_welcome_header_title_never_repeated"
        return title
      }
    `
    const findings = scanMagicValue(code, "src/components/Header.tsx")
    const stringFindings = findings.filter((f) => f.rule === "MV-repeated-magic-string")
    expect(stringFindings.length).toBe(0)
  })

  test("generic constant names in production code trigger warnings", () => {
    const code = `
      const CONST_1 = "something"
      const DATA = "payload"
    `
    const findings = scanMagicValue(code, "src/services/data.ts")
    const genericFindings = findings.filter((f) => f.rule === "MV-generic-constant-name")
    expect(genericFindings.length).toBeGreaterThanOrEqual(1)
  })
})
