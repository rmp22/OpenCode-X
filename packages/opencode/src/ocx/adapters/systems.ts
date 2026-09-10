import type { DomainAdapter, DomainDetectionContext, DomainRuleViolation, DomainVerificationResult } from "./types"

const RAW_POINTER_ARITHMETIC = /\b(?:reinterpret_cast|void\s*\*\s*\w+\s*=\s*\([^)]*\)\s*\d+)\b/
const UNCHECKED_UNWRAP_RUST = /\.(?:unwrap|expect)\s*\(\s*\)/
const MALLOC_WITHOUT_NULL_CHECK = /\bmalloc\s*\([^)]+\)/

export class SystemsDomainAdapter implements DomainAdapter {
  readonly kind = "systems"
  readonly name = "Systems Programming Adapter (C/C++/Rust/Zig)"

  detect(context: DomainDetectionContext): boolean {
    const hasSystemsFiles = context.files.some((f) => /\.(?:c|cc|cpp|cxx|h|hpp|rs|zig|asm|s)$/i.test(f))
    const hasSystemsBuild = context.buildFiles.some((b) => /\b(Cargo\.toml|CMakeLists\.txt|Makefile|meson\.build|build\.zig)\b/i.test(b))
    return hasSystemsFiles || hasSystemsBuild
  }

  validateSource(file: string, content: string): readonly DomainRuleViolation[] {
    const violations: DomainRuleViolation[] = []
    const lines = content.split("\n")
    const isRust = file.endsWith(".rs")
    const isC = /\.(?:c|cc|cpp|h|hpp)$/i.test(file)

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!
      if (isRust && UNCHECKED_UNWRAP_RUST.test(line)) {
        violations.push({
          ruleId: "systems/rust-explicit-error-handling",
          message: "Unchecked unwrap/expect in systems code; prefer match, if let, or ? operator",
          severity: "warning",
          file,
          line: i + 1,
          fix: "Propagate error using ? or handle error branch explicitly",
        })
      }
      if (isC && RAW_POINTER_ARITHMETIC.test(line)) {
        violations.push({
          ruleId: "systems/safe-pointer-conversions",
          message: "Dangerous raw pointer cast detected; verify memory alignment and bounds",
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
        domain: "systems",
        passed: false,
        violations: [{
          ruleId: "systems/artifact-missing",
          message: `Systems target ${target} does not exist`,
          severity: "blocker",
        }],
      }
    }

    const content = await file.text()
    const violations = this.validateSource(target, content)
    const passed = violations.filter((v) => v.severity === "blocker").length === 0

    return {
      domain: "systems",
      passed,
      violations,
      metrics: {
        fileSize: content.length,
        lines: content.split("\n").length,
      },
    }
  }
}

export const systemsAdapter = new SystemsDomainAdapter()

export * as SystemsAdapterModule from "./systems"
