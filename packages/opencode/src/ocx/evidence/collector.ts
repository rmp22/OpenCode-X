import type { EvidenceItem, EvidenceKind, EvidenceSourceKind, EvidenceConfidence } from "./types"

export class EvidenceCollector {
  private readonly items: EvidenceItem[] = []

  recordExecutionEvidence(options: {
    readonly source: EvidenceSourceKind
    readonly kind: EvidenceKind
    readonly rawOutput: string
    readonly structuredResult?: Record<string, unknown>
    readonly confidence?: EvidenceConfidence
    readonly verifiable?: boolean
    readonly exitCode?: number
  }): EvidenceItem {
    const raw = options.rawOutput
    if (!raw || raw.trim().length === 0) {
      throw new Error("Evidence rejected: rawOutput must be non-empty string from actual execution")
    }

    const trimmed = raw.trim().toLowerCase()
    if (
      trimmed === "todo" ||
      trimmed === "synthetic" ||
      trimmed === "unexecuted" ||
      trimmed === "placeholder" ||
      trimmed.startsWith("placeholder") ||
      trimmed === "assumed"
    ) {
      throw new Error("Evidence rejected: synthetic claims and placeholders are not valid evidence")
    }

    const validSources: readonly string[] = ["command", "file", "test", "typecheck", "diff"]
    if (!validSources.includes(options.source)) {
      throw new Error(`Evidence rejected: invalid source "${options.source}"`)
    }

    const id = `ev_${options.source}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    const confidence: EvidenceConfidence = options.confidence ?? (options.exitCode === 0 ? "high" : "low")
    const item: EvidenceItem = {
      id,
      kind: options.kind,
      source: options.source,
      detail: raw.slice(0, 1000),
      exitCode: options.exitCode,
      timestamp: Date.now(),
      rawOutput: raw,
      structuredResult: options.structuredResult ?? {},
      confidence,
      verifiable: options.verifiable ?? true,
    }
    this.items.push(item)
    return item
  }

  ingestBashOutput(command: string, stdout: string, exitCode: number): EvidenceItem | undefined {
    const lowerCmd = command.toLowerCase()
    const id = `ev_bash_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`

    if ((lowerCmd.includes("test") || lowerCmd.includes("pytest") || lowerCmd.includes("vitest") || lowerCmd.includes("jest")) && exitCode === 0) {
      const item: EvidenceItem = {
        id,
        kind: "test_run",
        source: command,
        detail: stdout.slice(0, 1000),
        exitCode,
        timestamp: Date.now(),
        rawOutput: stdout,
        structuredResult: { command, exitCode },
        confidence: "high",
        verifiable: true,
      }
      this.items.push(item)
      return item
    }

    if ((lowerCmd.includes("typecheck") || lowerCmd.includes("tsc") || lowerCmd.includes("tsgo")) && exitCode === 0) {
      const item: EvidenceItem = {
        id,
        kind: "typecheck",
        source: command,
        detail: stdout.slice(0, 1000),
        exitCode,
        timestamp: Date.now(),
        rawOutput: stdout,
        structuredResult: { command, exitCode },
        confidence: "high",
        verifiable: true,
      }
      this.items.push(item)
      return item
    }

    if ((lowerCmd.includes("build") || lowerCmd.includes("compile")) && exitCode === 0) {
      const item: EvidenceItem = {
        id,
        kind: "build_output",
        source: command,
        detail: stdout.slice(0, 1000),
        exitCode,
        timestamp: Date.now(),
        rawOutput: stdout,
        structuredResult: { command, exitCode },
        confidence: "high",
        verifiable: true,
      }
      this.items.push(item)
      return item
    }

    if ((lowerCmd.includes("lint") || lowerCmd.includes("oxlint") || lowerCmd.includes("eslint")) && exitCode === 0) {
      const item: EvidenceItem = {
        id,
        kind: "lint_check",
        source: command,
        detail: stdout.slice(0, 1000),
        exitCode,
        timestamp: Date.now(),
        rawOutput: stdout,
        structuredResult: { command, exitCode },
        confidence: "high",
        verifiable: true,
      }
      this.items.push(item)
      return item
    }

    return undefined
  }

  ingestFileMutation(action: "write" | "edit", filePath: string, diffDetail = ""): EvidenceItem {
    const raw = diffDetail || `Modified ${filePath}`
    const item: EvidenceItem = {
      id: `ev_mut_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      kind: "diff_inspection",
      source: `${action}:${filePath}`,
      detail: raw,
      timestamp: Date.now(),
      rawOutput: raw,
      structuredResult: { action, filePath },
      confidence: "high",
      verifiable: true,
    }
    this.items.push(item)
    return item
  }

  ingestRead(filePath: string): EvidenceItem {
    const raw = `Inspected ${filePath}`
    const item: EvidenceItem = {
      id: `ev_read_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      kind: "read_artifact",
      source: `read:${filePath}`,
      detail: raw,
      timestamp: Date.now(),
      rawOutput: raw,
      structuredResult: { filePath },
      confidence: "medium",
      verifiable: true,
    }
    this.items.push(item)
    return item
  }

  getItems(): readonly EvidenceItem[] {
    return this.items
  }

  canEmitTerminal(claims?: readonly { status: string }[]): { allowed: boolean; reason?: string } {
    if (claims) {
      const unverified = claims.filter((c) => c.status !== "verified")
      if (unverified.length > 0) {
        const rejection = {
          allowed: false,
          reason: `${unverified.length} claims remain unverified`,
        }
        return rejection
      }
    }
    const approval = { allowed: true }
    return approval
  }

  clear(): void {
    this.items.length = 0
  }
}

export const defaultEvidenceCollector = new EvidenceCollector()

export * as EvidenceCollectorModule from "./collector"
