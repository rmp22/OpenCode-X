import type { DomainAdapter, DomainDetectionContext, DomainRuleViolation, DomainVerificationResult } from "./types"

const DEAD_LINK_REGEX = /href\s*=\s*["']#["']/gi
const PLACEHOLDER_TEXT_REGEX = /\b(lorem ipsum|placeholder text|sample text)\b/gi
const HOTLINKED_STOCK_REGEX = /\b(source\.unsplash\.com|via\.placeholder\.com)\b/gi

export class WebDomainAdapter implements DomainAdapter {
  readonly kind = "web"
  readonly name = "Web & Frontend Adapter"

  detect(context: DomainDetectionContext): boolean {
    const hasWebFiles = context.files.some((f) => /\.(?:html?|css|jsx?|tsx?|vue|svelte)$/i.test(f))
    const hasWebKeywords = /\b(landing page|website|web page|frontend|ui|css|html)\b/i.test(context.promptText ?? "")
    return hasWebFiles || hasWebKeywords
  }

  validateSource(file: string, content: string): readonly DomainRuleViolation[] {
    const violations: DomainRuleViolation[] = []
    const lines = content.split("\n")

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!
      if (DEAD_LINK_REGEX.test(line)) {
        violations.push({
          ruleId: "web/no-dead-links",
          message: "Empty hash link (<a href=\"#\">) detected; wire real anchor or remove control",
          severity: "warning",
          file,
          line: i + 1,
          fix: "Replace href=\"#\" with real section target (e.g. href=\"#about\") or button",
        })
      }
      if (PLACEHOLDER_TEXT_REGEX.test(line)) {
        violations.push({
          ruleId: "web/no-placeholder-copy",
          message: "Placeholder copy detected; use authentic domain copy",
          severity: "warning",
          file,
          line: i + 1,
        })
      }
      if (HOTLINKED_STOCK_REGEX.test(line)) {
        violations.push({
          ruleId: "web/no-dead-stock-cdn",
          message: "Dead or unverified stock CDN URL referenced",
          severity: "blocker",
          file,
          line: i + 1,
          fix: "Download verified assets locally into project assets/ directory",
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
        domain: "web",
        passed: false,
        violations: [{
          ruleId: "web/artifact-missing",
          message: `Target artifact ${target} does not exist`,
          severity: "blocker",
        }],
      }
    }

    const content = await file.text()
    const violations = this.validateSource(target, content)
    const passed = violations.filter((v) => v.severity === "blocker").length === 0

    return {
      domain: "web",
      passed,
      violations,
      metrics: {
        fileSize: content.length,
        lines: content.split("\n").length,
      },
    }
  }
}

export const webAdapter = new WebDomainAdapter()

export * as WebAdapterModule from "./web"
