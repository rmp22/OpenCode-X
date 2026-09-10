export interface SchemaFieldDef {
  name: string
  type: "string" | "number" | "boolean" | "array" | "object"
  required: boolean
  aliases?: string[]
}

export interface ToolSchemaContract {
  tool: string
  fields: SchemaFieldDef[]
}

export interface NormalizationResult {
  normalized: Record<string, unknown>
  corrections: string[]
  valid: boolean
  errors: string[]
}
