import { scanText } from "./scanner"
import type { GoogleFinding } from "./types"

export function checkGooglePractices(filePath: string, content: string): readonly GoogleFinding[] {
  const result = scanText(filePath, content)
  return result.findings
}

export function hasBlockingViolations(filePath: string, content: string): boolean {
  const result = scanText(filePath, content, { minSeverity: "error" })
  return result.errorCount > 0
}
