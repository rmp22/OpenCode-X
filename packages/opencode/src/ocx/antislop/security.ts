export type SecuritySlopFinding = {
  readonly rule: string
  readonly severity: "warning" | "blocker"
  readonly evidence: string
  readonly fix: string
}

export function scanSecuritySlop(content: string, filePath: string): readonly SecuritySlopFinding[] {
  const findings: SecuritySlopFinding[] = []
  const lines = content.split("\n")

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    if (trimmed.includes("eval(") || trimmed.includes("Function(") || trimmed.includes("vm.run")) {
      findings.push({
        rule: "S-dangerous-eval",
        severity: "blocker",
        evidence: `eval/Function/vm.run at line ${i + 1}`,
        fix: "remove dynamic code execution or validate input strictly",
      })
    }

    if (trimmed.includes("password") && trimmed.includes("=") && !trimmed.includes("process.env") && !trimmed.includes("import.meta.env")) {
      findings.push({
        rule: "S-hardcoded-secret",
        severity: "blocker",
        evidence: `hardcoded secret at line ${i + 1}`,
        fix: "read secrets from configuration or environment variables",
      })
    }

    if (trimmed.includes("fetch(") && !trimmed.includes("https://") && !trimmed.includes("http://")) {
      findings.push({
        rule: "S-unvalidated-url",
        severity: "warning",
        evidence: `fetch without URL validation at line ${i + 1}`,
        fix: "validate and sanitize URLs before making requests",
      })
    }

    if (trimmed.includes("innerHTML") && !trimmed.includes("textContent")) {
      findings.push({
        rule: "S-innerHTML-xss",
        severity: "blocker",
        evidence: `innerHTML assignment at line ${i + 1}`,
        fix: "use textContent or sanitize the HTML before inserting",
      })
    }
  }

  return findings
}

export * as SecuritySlop from "./security"