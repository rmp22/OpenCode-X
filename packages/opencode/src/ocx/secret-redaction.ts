export type Kind = "private-key" | "bearer-token" | "jwt" | "credential"

export type Redaction = {
  readonly value: string
  readonly redacted: boolean
  readonly kinds: readonly Kind[]
}

const patterns: readonly { readonly kind: Kind; readonly pattern: RegExp; readonly replacement: string }[] = [
  {
    kind: "private-key",
    pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
    replacement: "[REDACTED PRIVATE KEY]",
  },
  {
    kind: "bearer-token",
    pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/gi,
    replacement: "Bearer [REDACTED TOKEN]",
  },
  {
    kind: "jwt",
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    replacement: "[REDACTED JWT]",
  },
  {
    kind: "credential",
    pattern: /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|password|passwd|secret)\b\s*[:=]\s*(['"]?)[^\s,'"]{8,}\1/gi,
    replacement: "[REDACTED CREDENTIAL]",
  },
  {
    kind: "credential",
    pattern: /\b(?:sk|gh[pousr]|github_pat|xox[boprs]-|AIza)[A-Za-z0-9_-]{12,}\b/g,
    replacement: "[REDACTED CREDENTIAL]",
  },
]

export function redact(value: string): Redaction {
  let result = value
  const kinds = new Set<Kind>()
  for (const item of patterns) {
    const next = result.replace(item.pattern, () => {
      kinds.add(item.kind)
      return item.replacement
    })
    result = next
  }
  return { value: result, redacted: kinds.size > 0, kinds: [...kinds] }
}

export * as SecretRedaction from "./secret-redaction"
