export * as TypeScriptKnowledge from "./typescript"

export type LanguageEntry = {
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

export const RULES: readonly LanguageEntry[] = [
  {
    id: "TS1",
    language: "typescript",
    version: "5.0+",
    topic: "type-safety",
    rule: "Avoid `any` type; use `unknown` with type guards instead",
    rationale: "`any` disables all type checking and defeats the purpose of TypeScript",
    example: "const value: unknown = getData(); if (typeof value === 'string') { ... }",
    counterExample: "const value: any = getData(); value.doSomething();",
    severity: "warning",
    verification: ["typecheck"],
    lastReviewed: "2026-08-31",
  },
  {
    id: "TS2",
    language: "typescript",
    version: "5.0+",
    topic: "type-safety",
    rule: "Prefer `const` over `let`; use ternaries or early returns instead of reassignment",
    rationale: "Immutable bindings reduce cognitive load and prevent accidental mutation",
    example: "const foo = condition ? 1 : 2",
    counterExample: "let foo; if (condition) foo = 1; else foo = 2;",
    severity: "info",
    verification: ["lint"],
    lastReviewed: "2026-08-31",
  },
  {
    id: "TS3",
    language: "typescript",
    version: "5.0+",
    topic: "imports",
    rule: "Never use star imports or aliased imports; prefer direct named imports",
    rationale: "Star imports obscure the dependency graph and make tree-shaking impossible",
    example: "import { Project } from '@opencode-ai/core/project'; Project.ID",
    counterExample: "import * as Project from '@opencode-ai/core/project'; Project.ID",
    severity: "warning",
    verification: ["lint"],
    lastReviewed: "2026-08-31",
  },
  {
    id: "TS4",
    language: "typescript",
    version: "5.0+",
    topic: "error-handling",
    rule: "Avoid try/catch where possible; validate at boundaries",
    rationale: "Try/catch obscures control flow and makes reasoning about errors harder",
    example: "const result = Schema.decodeUnknownOption(input); if ('_tag' in result && result._tag === 'Left') { ... }",
    counterExample: "try { const result = JSON.parse(input); } catch (e) { ... }",
    severity: "info",
    verification: ["typecheck", "lint"],
    lastReviewed: "2026-08-31",
  },
  {
    id: "TS5",
    language: "typescript",
    version: "5.0+",
    topic: "effect",
    rule: "Use Effect.gen for composition; use Effect.fn for named effects",
    rationale: "Effect.gen provides clear async composition; Effect.fn provides tracing",
    example: "Effect.gen(function* () { const x = yield* foo; return x + 1; })",
    counterExample: "foo().then(x => x + 1);",
    severity: "info",
    verification: ["typecheck"],
    lastReviewed: "2026-08-31",
  },
] as const