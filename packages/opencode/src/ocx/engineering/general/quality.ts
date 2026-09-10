export * as QualityKnowledge from "./quality"

export type KnowledgeEntry = {
  readonly id: string
  readonly topic: string
  readonly language: readonly string[]
  readonly framework: readonly string[]
  readonly version: string
  readonly source: string
  readonly authority: string
  readonly applicability: readonly string[]
  readonly exceptions: readonly string[]
  readonly severity: "info" | "warning" | "error"
  readonly verification: readonly string[]
  readonly lastReviewed: string
}

export const RULES: readonly KnowledgeEntry[] = [
  {
    id: "Q1",
    topic: "code-quality",
    language: ["typescript", "javascript", "python", "go", "rust", "java", "kotlin", "c", "cpp"],
    framework: [],
    version: "1.0.0",
    source: "ocx-engineering-knowledge",
    authority: "ocx",
    applicability: ["all"],
    exceptions: [],
    severity: "warning",
    verification: ["lint", "typecheck", "test"],
    lastReviewed: "2026-08-31",
  },
  {
    id: "Q2",
    topic: "naming",
    language: ["typescript", "javascript", "python", "go", "rust", "java", "kotlin", "c", "cpp"],
    framework: [],
    version: "1.0.0",
    source: "ocx-engineering-knowledge",
    authority: "ocx",
    applicability: ["all"],
    exceptions: [],
    severity: "warning",
    verification: ["lint"],
    lastReviewed: "2026-08-31",
  },
  {
    id: "Q3",
    topic: "architecture",
    language: ["typescript", "javascript", "python", "go", "rust", "java", "kotlin", "c", "cpp"],
    framework: [],
    version: "1.0.0",
    source: "ocx-engineering-knowledge",
    authority: "ocx",
    applicability: ["all"],
    exceptions: [],
    severity: "error",
    verification: ["architecture-check", "test"],
    lastReviewed: "2026-08-31",
  },
  {
    id: "Q4",
    topic: "testing",
    language: ["typescript", "javascript", "python", "go", "rust", "java", "kotlin", "c", "cpp"],
    framework: [],
    version: "1.0.0",
    source: "ocx-engineering-knowledge",
    authority: "ocx",
    applicability: ["all"],
    exceptions: [],
    severity: "warning",
    verification: ["test"],
    lastReviewed: "2026-08-31",
  },
  {
    id: "Q5",
    topic: "security",
    language: ["typescript", "javascript", "python", "go", "rust", "java", "kotlin", "c", "cpp"],
    framework: [],
    version: "1.0.0",
    source: "ocx-engineering-knowledge",
    authority: "ocx",
    applicability: ["all"],
    exceptions: [],
    severity: "error",
    verification: ["security-scan", "test"],
    lastReviewed: "2026-08-31",
  },
  {
    id: "Q6",
    topic: "concurrency",
    language: ["typescript", "go", "rust", "java", "kotlin", "c", "cpp"],
    framework: [],
    version: "1.0.0",
    source: "ocx-engineering-knowledge",
    authority: "ocx",
    applicability: ["all"],
    exceptions: [],
    severity: "error",
    verification: ["test", "race-detector"],
    lastReviewed: "2026-08-31",
  },
] as const