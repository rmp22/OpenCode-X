export type MagicValueSlopFinding = {
  readonly rule: string
  readonly severity: "warning" | "blocker"
  readonly evidence: string
  readonly fix: string
}

const GENERIC_CONSTANT_PATTERN = /^(?:CONST|STRING|DATA|TEMP|VAL|VAR|DUMMY|VALUE|FOO|BAR)(?:_[A-Z0-9]+)?$/i
const HTTP_HEADERS = new Set([
  "content-type",
  "authorization",
  "accept",
  "user-agent",
  "cache-control",
  "host",
  "origin",
  "referer",
  "cookie",
  "set-cookie",
])
const HTTP_METHODS = new Set(["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"])

export function isGenericConstantName(name: string): boolean {
  if (name.length <= 1) return true
  const upper = name.toUpperCase()
  if (GENERIC_CONSTANT_PATTERN.test(upper)) return true
  if (/^CONST_\d+$/.test(upper)) return true
  if (/^STRING_VAL(?:_\d+)?$/.test(upper)) return true
  return false
}

export function isSemanticConstantName(name: string): boolean {
  if (isGenericConstantName(name)) return false
  const valid = name.length >= 3 && /[a-zA-Z]/.test(name)
  return valid
}

export function isDomainSpecificLiteral(literal: string): boolean {
  const trimmed = literal.trim()
  if (trimmed.length === 0) return true

  if (/^(?:SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|FROM|WHERE|JOIN|GROUP\s+BY|ORDER\s+BY|CREATE\s+TABLE|ALTER\s+TABLE)\b/i.test(trimmed)) {
    return true
  }

  if (trimmed.startsWith("^") || trimmed.endsWith("$") || /\\(?:[dswbDSWB]|p\{)/.test(trimmed) || trimmed.includes("(?:") || trimmed.includes(".*") || trimmed.includes(".+")) {
    return true
  }

  if (trimmed.includes("%s") || trimmed.includes("%d") || trimmed.includes("{0}") || /\{\{[^}]+\}\}/.test(trimmed)) {
    return true
  }

  if (/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(trimmed)) {
    return true
  }

  if (/^(?:rgb|rgba|hsl|hsla)\(/.test(trimmed)) {
    return true
  }

  const lower = trimmed.toLowerCase()
  if (HTTP_HEADERS.has(lower) || HTTP_METHODS.has(trimmed)) {
    return true
  }

  if (/^(?:application|text|image|audio|video|multipart)\/[a-zA-Z0-9._+-]+$/.test(lower)) {
    return true
  }

  const reserved = ["import", "export", "function", "string", "number", "boolean", "default", "return", "undefined", "object"]
  if (reserved.includes(trimmed)) {
    return true
  }

  return false
}

export function scanMagicValue(content: string, filePath: string): readonly MagicValueSlopFinding[] {
  const isTest = /\.(?:test|spec)\.[a-zA-Z0-9]+$/i.test(filePath) || filePath.includes("/test/") || filePath.includes("/tests/") || filePath.includes("/fixtures/")
  if (isTest) {
    const empty: readonly MagicValueSlopFinding[] = []
    return empty
  }

  const findings: MagicValueSlopFinding[] = []
  const lines = content.split("\n")

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    const constMatch = trimmed.match(/\b(?:const|let|var)\s+([a-zA-Z0-9_]+)\s*=/)
    if (constMatch) {
      const constName = constMatch[1]
      if (isGenericConstantName(constName)) {
        const item: MagicValueSlopFinding = {
          rule: "MV-generic-constant-name",
          severity: "warning",
          evidence: `generic constant name "${constName}" at line ${i + 1}`,
          fix: "use a domain-meaningful identifier (e.g. USER_SESSION_TIMEOUT_MS) instead of a generic name",
        }
        findings.push(item)
      }
    }

    if (trimmed.includes("timeout") && trimmed.includes("=") && !trimmed.includes("TIMEOUT") && !trimmed.includes("timeoutMs")) {
      const match = trimmed.match(/=\s*(\d+)\s*[,;]/)
      if (match && parseInt(match[1]) > 0 && match[1].length >= 3) {
        const item: MagicValueSlopFinding = {
          rule: "MV-arbitrary-timeout",
          severity: "warning",
          evidence: `arbitrary timeout value ${match[1]} at line ${i + 1}`,
          fix: "use a named timeout constant or configuration",
        }
        findings.push(item)
      }
    }

    if (trimmed.includes("retry") && trimmed.includes("=") && !trimmed.includes("MAX_RETRY") && !trimmed.includes("retries")) {
      const match = trimmed.match(/=\s*(\d+)\s*[,;]/)
      if (match && parseInt(match[1]) > 0) {
        const item: MagicValueSlopFinding = {
          rule: "MV-arbitrary-retry",
          severity: "warning",
          evidence: `arbitrary retry count ${match[1]} at line ${i + 1}`,
          fix: "use a named retry constant or configuration",
        }
        findings.push(item)
      }
    }

    if (trimmed.includes("duration") && trimmed.includes("=") && !trimmed.includes("DURATION") && !trimmed.includes("ms")) {
      const match = trimmed.match(/=\s*(\d+)\s*[,;]/)
      if (match && parseInt(match[1]) > 100) {
        const item: MagicValueSlopFinding = {
          rule: "MV-arbitrary-duration",
          severity: "warning",
          evidence: `arbitrary duration value ${match[1]} at line ${i + 1}`,
          fix: "use a named duration constant or token",
        }
        findings.push(item)
      }
    }
  }

  if (!filePath.includes("generated") && !filePath.includes("constants")) {
    const stringLiterals = [...content.matchAll(/["']([^"'\n]{4,})["']/g)].map((m) => m[1])
    const counts = new Map<string, number>()
    for (const lit of stringLiterals) {
      if (isDomainSpecificLiteral(lit)) continue
      counts.set(lit, (counts.get(lit) ?? 0) + 1)
    }

    for (const [lit, freq] of counts) {
      if (freq >= 3) {
        const item: MagicValueSlopFinding = {
          rule: "MV-repeated-magic-string",
          severity: "warning",
          evidence: `string literal "${lit}" repeated ${freq} times in ${filePath}`,
          fix: "centralize commonly used strings into a constants module, class, or typed enum",
        }
        findings.push(item)
      }
    }
  }

  return findings
}

export * as MagicValueSlop from "./magic-value"
