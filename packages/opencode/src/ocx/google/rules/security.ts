import type { GoogleFinding, GoogleRule, RuleContext } from "../types"

export const SECURITY_RULES: readonly GoogleRule[] = [
  {
    id: "google-sec-sql-injection",
    name: "no-sql-string-interpolation",
    category: "security",
    languages: ["typescript", "javascript", "python", "go", "java"],
    severity: "error",
    description: "Never interpolate variables directly into SQL queries; use parameterized queries.",
    rationale: "Direct SQL string interpolation is the root cause of SQL injection vulnerabilities.",
    citation: "Google Secure Coding Practices #SafeSQL",
    fixable: false,
    check: (context: RuleContext): readonly GoogleFinding[] => {
      const findings: GoogleFinding[] = []
      const rawSqlRegex = /(SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+[^;]*\$\{[a-zA-Z0-9_.]+\}/i
      for (let i = 0; i < context.lines.length; i++) {
        const line = context.lines[i]
        const match = rawSqlRegex.exec(line)
        if (match && !line.trim().startsWith("//") && !line.trim().startsWith("#")) {
          findings.push({
            ruleId: "google-sec-sql-injection",
            category: "security",
            severity: "error",
            file: context.filePath,
            line: i + 1,
            column: match.index + 1,
            message: "SQL query constructed with string interpolation. Use parameterized queries ($1, ?).",
            citation: "Google Secure Coding #SafeSQL",
            fixable: false,
            suggestion: "Replace interpolated string with parameter placeholder.",
            snippet: line.trimEnd(),
          })
        }
      }
      return findings
    },
  },
  {
    id: "google-sec-xss",
    name: "no-raw-html-injection",
    category: "security",
    languages: ["typescript", "javascript"],
    severity: "error",
    description: "Do not assign raw HTML strings to innerHTML or dangerouslySetInnerHTML.",
    rationale: "Unescaped HTML injection causes Cross-Site Scripting (XSS) attacks.",
    citation: "Google Secure Coding Practices #SafeHTML",
    fixable: false,
    check: (context: RuleContext): readonly GoogleFinding[] => {
      const findings: GoogleFinding[] = []
      const xssRegex = /(\.innerHTML\s*=|\bdangerouslySetInnerHTML\b)/
      for (let i = 0; i < context.lines.length; i++) {
        const line = context.lines[i]
        const match = xssRegex.exec(line)
        if (match && !line.trim().startsWith("//")) {
          findings.push({
            ruleId: "google-sec-xss",
            category: "security",
            severity: "error",
            file: context.filePath,
            line: i + 1,
            column: match.index + 1,
            message: "Direct HTML injection detected. Use textContent or a sanitized template.",
            citation: "Google Secure Coding #SafeHTML",
            fixable: false,
            suggestion: "Use element.textContent or contextual auto-escaping sanitizer.",
            snippet: line.trimEnd(),
          })
        }
      }
      return findings
    },
  },
  {
    id: "google-sec-hardcoded-secrets",
    name: "no-hardcoded-secrets",
    category: "security",
    languages: ["all"],
    severity: "error",
    description: "Never hardcode API keys, passwords, or secret tokens in source code.",
    rationale: "Hardcoded credentials can be leaked through repository access or public exposures.",
    citation: "Google Secure Coding Practices #SecretManagement",
    fixable: false,
    check: (context: RuleContext): readonly GoogleFinding[] => {
      const findings: GoogleFinding[] = []
      const secretRegex = /(AIzaSy[a-zA-Z0-9_-]{33}|ghp_[a-zA-Z0-9]{36}|-----BEGIN (RSA|EC|OPENSSH) PRIVATE KEY-----)/
      for (let i = 0; i < context.lines.length; i++) {
        const line = context.lines[i]
        const match = secretRegex.exec(line)
        if (match) {
          findings.push({
            ruleId: "google-sec-hardcoded-secrets",
            category: "security",
            severity: "error",
            file: context.filePath,
            line: i + 1,
            column: match.index + 1,
            message: "Hardcoded secret or private credential detected.",
            citation: "Google Secure Coding #SecretManagement",
            fixable: false,
            suggestion: "Store secrets in environment variables or a secure secret manager.",
            snippet: "[REDACTED SECRET VALUE]",
          })
        }
      }
      return findings
    },
  },
  {
    id: "google-sec-unsafe-logging",
    name: "no-credential-logging",
    category: "security",
    languages: ["typescript", "javascript", "python", "go", "java"],
    severity: "error",
    description: "Do not log passwords, authentication tokens, or authorization headers.",
    rationale: "Logging credentials exposes them to log aggregation systems and unauthorized observers.",
    citation: "Google Secure Coding Practices #LoggingHygiene",
    fixable: false,
    check: (context: RuleContext): readonly GoogleFinding[] => {
      const findings: GoogleFinding[] = []
      const sensitiveLogRegex = /(console\.(log|info|warn|error)|logger\.[a-z]+)\s*\([^)]*\b(password|authToken|bearer|apiKey)\b/i
      for (let i = 0; i < context.lines.length; i++) {
        const line = context.lines[i]
        const match = sensitiveLogRegex.exec(line)
        if (match && !line.trim().startsWith("//") && !line.trim().startsWith("#")) {
          findings.push({
            ruleId: "google-sec-unsafe-logging",
            category: "security",
            severity: "error",
            file: context.filePath,
            line: i + 1,
            column: match.index + 1,
            message: "Potentially sensitive credential logged in output stream.",
            citation: "Google Secure Coding #LoggingHygiene",
            fixable: false,
            suggestion: "Redact or omit credentials before logging.",
            snippet: line.trimEnd(),
          })
        }
      }
      return findings
    },
  },
]
