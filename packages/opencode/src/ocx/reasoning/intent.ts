import type { Message } from "../ledger"

const FORBIDDEN = /\b(?:do not|don't|never)\s+(?:change|modify|edit|touch)\s+([^,\n]+?)(?:;|$)/gi

export function check(messages: ReadonlyArray<Message>, paths: readonly string[]): string | undefined {
  const request = userText(messages)
  if (!request) return undefined
  const forbidden = [...request.matchAll(FORBIDDEN)].map((match) => normalize(match[1] ?? "")).filter(Boolean)
  for (const target of forbidden) {
    const path = paths.find((value) => matches(value, target))
    if (path) return `the user explicitly prohibited changes to ${path}`
  }
  return undefined
}

function userText(messages: ReadonlyArray<Message>): string {
  const user = messages.findLast((message) => message.info.role === "user")
  if (!user) return ""
  return user.parts
    .flatMap((part) => {
      if (!part || typeof part !== "object" || Array.isArray(part)) return []
      const value = part as Record<string, unknown>
      return value.type === "text" && typeof value.text === "string" ? [value.text] : []
    })
    .join("\n")
}

function normalize(value: string): string {
  return value.toLocaleLowerCase().replace(/^the\s+/, "").replace(/[`'"\s]+/g, " ").replace(/[.]+$/, "").trim()
}

function matches(path: string, target: string): boolean {
  const normalizedPath = normalize(path).replaceAll("\\", "/")
  const normalizedTarget = target.replaceAll("\\", "/")
  return normalizedPath === normalizedTarget || normalizedPath.endsWith(`/${normalizedTarget}`)
}

export * as Intent from "./intent"
