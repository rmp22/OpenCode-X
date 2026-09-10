export * as SecurityKnowledge from "./typescript"

export type SecurityEntry = {
  readonly id: string
  readonly language: string
  readonly version: string
  readonly topic: string
  readonly rule: string
  readonly rationale: string
  readonly example: string
  readonly counterExample: string
  readonly severity: "info" | "warning" | "error"
  readonly verification: readonly string[]
  readonly lastReviewed: string
}

export const RULES: readonly SecurityEntry[] = [
  {
    id: "S1",
    language: "typescript",
    version: "1.0.0",
    topic: "input-validation",
    rule: "Validate and convert untrusted input at boundaries; keep internals typed",
    rationale: "Unvalidated input at boundaries is the primary source of injection vulnerabilities",
    example: "Schema.decodeUnknownOption(input) at API entry points",
    counterExample: "Trusting raw request input in business logic",
    severity: "error",
    verification: ["typecheck", "security-scan"],
    lastReviewed: "2026-08-31",
  },
  {
    id: "S2",
    language: "typescript",
    version: "1.0.0",
    topic: "dependency-safety",
    rule: "Verify a dependency before importing it; read package.json and prefer what is already installed",
    rationale: "Unverified dependencies introduce supply chain risk and unnecessary bundle size",
    example: "Check package.json for existing dependency before adding a new import",
    counterExample: "npm install a package without checking if it already exists or is needed",
    severity: "warning",
    verification: ["dependency-check"],
    lastReviewed: "2026-08-31",
  },
  {
    id: "S3",
    language: "typescript",
    version: "1.0.0",
    topic: "secret-handling",
    rule: "Never hardcode secrets; use environment variables or secret stores",
    rationale: "Hardcoded secrets leak into version control and are impossible to rotate",
    example: "process.env.API_KEY or a secret manager integration",
    counterExample: "const API_KEY = 'sk-abc123'",
    severity: "error",
    verification: ["secret-scan", "lint"],
    lastReviewed: "2026-08-31",
  },
] as const