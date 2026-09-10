import type { NormalizationResult, ToolSchemaContract } from "./types"

export function normalizeToolParameters(
  contract: ToolSchemaContract,
  input: Record<string, unknown>,
): NormalizationResult {
  const normalized: Record<string, unknown> = { ...input }
  const corrections: string[] = []
  const errors: string[] = []

  for (const field of contract.fields) {
    if (normalized[field.name] === undefined && field.aliases) {
      for (const alias of field.aliases) {
        if (normalized[alias] !== undefined) {
          normalized[field.name] = normalized[alias]
          delete normalized[alias]
          corrections.push(`Renamed alias parameter '${alias}' to canonical '${field.name}'`)
          break
        }
      }
    }

    const val = normalized[field.name]

    if (val === undefined) {
      if (field.required) {
        errors.push(`Missing required parameter: '${field.name}'`)
      }
      continue
    }

    if (field.type === "number" && typeof val === "string") {
      const parsed = Number(val)
      if (!Number.isNaN(parsed)) {
        normalized[field.name] = parsed
        corrections.push(`Converted string '${val}' to number for parameter '${field.name}'`)
      } else {
        errors.push(`Invalid number format for parameter '${field.name}': '${val}'`)
      }
    }

    if (field.type === "boolean" && typeof val === "string") {
      if (val.toLowerCase() === "true") {
        normalized[field.name] = true
        corrections.push(`Converted string 'true' to boolean for parameter '${field.name}'`)
      } else if (val.toLowerCase() === "false") {
        normalized[field.name] = false
        corrections.push(`Converted string 'false' to boolean for parameter '${field.name}'`)
      }
    }
  }

  return {
    normalized,
    corrections,
    valid: errors.length === 0,
    errors,
  }
}
