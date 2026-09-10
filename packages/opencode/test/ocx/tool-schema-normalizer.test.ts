import { describe, expect, test } from "bun:test"
import { normalizeToolParameters } from "@/ocx/tool-schema/normalizer"
import type { ToolSchemaContract } from "@/ocx/tool-schema/types"

describe("Tool Schema Normalizer", () => {
  const readContract: ToolSchemaContract = {
    tool: "read",
    fields: [
      { name: "filePath", type: "string", required: true, aliases: ["file", "path"] },
      { name: "offset", type: "number", required: false },
      { name: "limit", type: "number", required: false },
    ],
  }

  test("auto-corrects aliases and stringified numbers", () => {
    const input = {
      file: "src/index.ts",
      offset: "10",
      limit: "50",
    }

    const result = normalizeToolParameters(readContract, input)
    expect(result.valid).toBe(true)
    expect(result.normalized.filePath).toBe("src/index.ts")
    expect(result.normalized.offset).toBe(10)
    expect(result.normalized.limit).toBe(50)
    expect(result.corrections.length).toBeGreaterThan(0)
  })

  test("reports missing required fields", () => {
    const input = {
      limit: 10,
    }

    const result = normalizeToolParameters(readContract, input)
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBe(1)
    expect(result.errors[0]).toContain("filePath")
  })
})
