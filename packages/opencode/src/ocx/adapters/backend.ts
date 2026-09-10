import type { DomainAdapter, DomainDetectionContext, DomainRuleViolation, DomainVerificationResult } from "./types"

const RAW_SQL_CONCAT = /\b(?:SELECT|INSERT|UPDATE|DELETE)\b.*?\+\s*[\w.]+/i
const HARDCODED_SECRET = /(?:api[_-]?key|secret[_-]?key|password|jwt_secret)\s*=\s*["'][A-Za-z0-9_-]{16,}["']/i
const BROAD_EXCEPTION_CATCH = /except\s*:\s*pass|catch\s*\(\s*(?:Exception|Throwable|any)\s*\w*\s*\)\s*\{\s*\}/

export class BackendDomainAdapter implements DomainAdapter {
  readonly kind = "backend"
  readonly name = "Backend & Cloud Services Adapter (Go/Python/Java/SQL)"

  detect(context: DomainDetectionContext): boolean {
    const hasBackendFiles = context.files.some((f) => /\.(?:go|py|java|sql|proto|graphql)$/i.test(f))
    const hasBackendBuild = context.buildFiles.some((b) => /\b(go\.mod|requirements\.txt|pyproject\.toml|pom\.xml|build\.gradle|Dockerfile)\b/i.test(b))
    return hasBackendFiles || hasBackendBuild
  }

  validateSource(file: string, content: string): readonly DomainRuleViolation[] {
    const violations: DomainRuleViolation[] = []
    const lines = content.split("\n")

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!
      if (RAW_SQL_CONCAT.test(line)) {
        violations.push({
          ruleId: "backend/sql-injection-prevention",
          message: "Possible raw SQL string concatenation; use parameterized queries or prepared statements",
          severity: "blocker",
          file,
          line: i + 1,
          fix: "Replace string concatenation with query parameters ($1, ?, :param)",
        })
      }
      if (HARDCODED_SECRET.test(line)) {
        violations.push({
          ruleId: "backend/no-hardcoded-secrets",
          message: "Potential hardcoded secret or credential literal detected",
          severity: "blocker",
          file,
          line: i + 1,
          fix: "Load secrets from environment variables or a secure key store",
        })
      }
      if (BROAD_EXCEPTION_CATCH.test(line)) {
        violations.push({
          ruleId: "backend/no-silent-exception-swallowing",
          message: "Broad empty exception catch detected; log or handle specific errors",
          severity: "warning",
          file,
          line: i + 1,
        })
      }
    }

    return violations
  }

  async verifyArtifact(target: string): Promise<DomainVerificationResult> {
    const file = Bun.file(target)
    const exists = await file.exists()
    if (!exists) {
      return {
        domain: "backend",
        passed: false,
        violations: [{
          ruleId: "backend/artifact-missing",
          message: `Backend target ${target} does not exist`,
          severity: "blocker",
        }],
      }
    }

    const content = await file.text()
    const violations = this.validateSource(target, content)
    const passed = violations.filter((v) => v.severity === "blocker").length === 0

    return {
      domain: "backend",
      passed,
      violations,
      metrics: {
        fileSize: content.length,
        lines: content.split("\n").length,
      },
    }
  }
}

export const backendAdapter = new BackendDomainAdapter()

export * as BackendAdapterModule from "./backend"
