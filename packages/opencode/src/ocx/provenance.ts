export const SOURCES = ["user", "repository", "bundle", "owner", "task", "tool", "test", "system"] as const
export type Source = (typeof SOURCES)[number]

export const TRUST_LEVELS = ["system", "user", "repository", "external", "model"] as const
export type Trust = (typeof TRUST_LEVELS)[number]

export type Link = {
  readonly source: Source
  readonly sourceRef?: string
  readonly target: string
  readonly relation: "supports" | "caused" | "verifiedBy" | "supersedes" | "affects"
  readonly createdAt: number
}

export function parseSource(value: unknown): Source | undefined {
  return typeof value === "string" && SOURCES.includes(value as Source) ? (value as Source) : undefined
}

export function parseTrust(value: unknown): Trust | undefined {
  return typeof value === "string" && TRUST_LEVELS.includes(value as Trust) ? (value as Trust) : undefined
}

export function reference(value: unknown, max = 160): string | undefined {
  if (typeof value !== "string") return undefined
  const result = value.trim()
  return result.length > 0 && result.length <= max && !result.includes("===") ? result : undefined
}

export * as Provenance from "./provenance"
