export type FrontendSlopFinding = {
  readonly rule: string
  readonly severity: "warning" | "blocker"
  readonly evidence: string
  readonly fix: string
}

const LANDMARK = /<(?:header|main|footer|nav|section|article)\b/gi
const INLINE_STYLE = /\sstyle\s*=/gi

export function scanFrontendSlop(content: string, filePath: string): readonly FrontendSlopFinding[] {
  const findings: FrontendSlopFinding[] = []
  const lines = content.split("\n")

  if (/\.html?$/.test(filePath)) {
    const landmarks = content.match(LANDMARK)?.length ?? 0
    if (lines.length >= 500 && landmarks >= 8) {
      findings.push({
        rule: "F-large-page-surface",
        severity: "warning",
        evidence: `${lines.length} lines with ${landmarks} major document sections in one HTML file`,
        fix: "review whether stable page regions have real component/partial boundaries; do not split solely to satisfy this warning",
      })
    }
  }

  const inlineStyles = content.match(INLINE_STYLE)?.length ?? 0
  if (inlineStyles >= 12) {
    findings.push({
      rule: "F-inline-style-density",
      severity: "warning",
      evidence: `${inlineStyles} inline style attributes in ${filePath}`,
      fix: "review repeated styling for reusable classes/tokens; keep genuinely data-dependent inline styles inline",
    })
  }

  if (/alert\s*\(\s*["'][^"']*(?:inquiry has been sent|message sent|thank you for contacting)[^"']*["']\s*\)/i.test(content) || /onsubmit\s*=\s*["'][^"']*alert\([^)]*\)[^"']*["']/i.test(content)) {
    findings.push({
      rule: "F-fake-success-form",
      severity: "blocker",
      evidence: `client-only fake form submission alert in ${filePath}`,
      fix: "provide real form handling or an honest unavailable state per NN/g heuristic 1",
    })
  }

  if (/\b(?:alert|confirm|prompt)\s*\(/i.test(content) && !/(?:test|spec)\b/i.test(filePath)) {
    findings.push({
      rule: "F-browser-dialog-slop",
      severity: "blocker",
      evidence: `interactive modal simulated with browser dialog (alert/confirm/prompt) in ${filePath}`,
      fix: "replace intrusive browser dialog with an accessible in-DOM interaction",
    })
  }
  if (
    /addEventListener\s*\(\s*["']mousemove["'][^{]*\{[^}]*style\.transform/s.test(content) &&
    !/requestAnimationFrame/i.test(content)
  ) {
    findings.push({
      rule: "F-unthrottled-mousemove-transform",
      severity: "warning",
      evidence: `unthrottled mousemove directly mutating transform without requestAnimationFrame in ${filePath}`,
      fix: "throttle mousemove transformations via requestAnimationFrame and respect reduced-motion preferences",
    })
  }

  return findings
}

export * as FrontendSlop from "./frontend"
