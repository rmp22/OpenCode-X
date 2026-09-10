import type { DomainAdapter, DomainDetectionContext, DomainRuleViolation, DomainVerificationResult } from "./types"

const MAIN_THREAD_BLOCKING = /\b(?:Thread\.sleep|runBlocking|Dispatchers\.Main\s*\{[^}]*Thread\.sleep)\b/
const MISSING_CONTENT_DESCRIPTION = /Image\s*\([^)]*contentDescription\s*=\s*null[^)]*\)/

export class MobileDomainAdapter implements DomainAdapter {
  readonly kind = "mobile"
  readonly name = "Mobile Development Adapter (Android/iOS/Kotlin/Swift)"

  detect(context: DomainDetectionContext): boolean {
    const hasMobileFiles = context.files.some((f) => /\.(?:kt|kts|swift|m|mm|storyboard|xib)$/i.test(f))
    const hasMobileManifest = context.files.some((f) => /\b(AndroidManifest\.xml|Info\.plist|Podfile)\b/i.test(f))
    const hasMobileKeywords = /\b(android|ios|compose|swiftui|activity|fragment|viewmodel)\b/i.test(context.promptText ?? "")
    return hasMobileFiles || hasMobileManifest || hasMobileKeywords
  }

  validateSource(file: string, content: string): readonly DomainRuleViolation[] {
    const violations: DomainRuleViolation[] = []
    const lines = content.split("\n")

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!
      if (MAIN_THREAD_BLOCKING.test(line)) {
        violations.push({
          ruleId: "mobile/no-main-thread-blocking",
          message: "Potential blocking sleep on main dispatcher; use coroutine delay or background dispatcher",
          severity: "blocker",
          file,
          line: i + 1,
          fix: "Replace Thread.sleep with delay() within a coroutine scope",
        })
      }
      if (MISSING_CONTENT_DESCRIPTION.test(line)) {
        violations.push({
          ruleId: "mobile/accessible-image-content-description",
          message: "Image composable has null contentDescription; provide accessibility description unless purely decorative",
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
        domain: "mobile",
        passed: false,
        violations: [{
          ruleId: "mobile/artifact-missing",
          message: `Mobile target ${target} does not exist`,
          severity: "blocker",
        }],
      }
    }

    const content = await file.text()
    const violations = this.validateSource(target, content)
    const passed = violations.filter((v) => v.severity === "blocker").length === 0

    return {
      domain: "mobile",
      passed,
      violations,
      metrics: {
        fileSize: content.length,
        lines: content.split("\n").length,
      },
    }
  }
}

export const mobileAdapter = new MobileDomainAdapter()

export * as MobileAdapterModule from "./mobile"
