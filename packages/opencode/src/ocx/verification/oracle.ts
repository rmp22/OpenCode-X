import type { CheckEvidence } from "../engine/state-machine"
import { sharedAdapterRegistry } from "../adapters/registry"
import type { DomainRuleViolation } from "../adapters/types"

export interface VerificationRequest {
  readonly sessionID: string
  readonly target: string
  readonly checks: readonly string[]
  readonly languages?: readonly string[]
}

export interface VerificationReport {
  readonly target: string
  readonly passed: boolean
  readonly evidence: readonly CheckEvidence[]
  readonly violations: readonly DomainRuleViolation[]
  readonly executionTimeMs: number
}

export class VerificationOracle {
  async verify(request: VerificationRequest): Promise<VerificationReport> {
    const startTime = Date.now()
    const evidenceList: CheckEvidence[] = []
    const allViolations: DomainRuleViolation[] = []

    const file = Bun.file(request.target)
    const exists = await file.exists()

    if (!exists) {
      for (const check of request.checks) {
        evidenceList.push({
          checkID: check,
          status: "failed",
          evidenceRef: request.target,
          timestamp: Date.now(),
          message: `Target artifact ${request.target} does not exist`,
        })
      }
      return {
        target: request.target,
        passed: false,
        evidence: evidenceList,
        violations: [{
          ruleId: "core/file-exists",
          message: `Target artifact ${request.target} missing`,
          severity: "blocker",
        }],
        executionTimeMs: Date.now() - startTime,
      }
    }

    const content = await file.text()
    const activeAdapters = sharedAdapterRegistry.detectActive({
      files: [request.target],
      buildFiles: [],
      languages: request.languages ?? [],
    })

    for (const adapter of activeAdapters) {
      const violations = adapter.validateSource(request.target, content)
      allViolations.push(...violations)
    }

    const hasBlockers = allViolations.some((v) => v.severity === "blocker")

    for (const check of request.checks) {
      evidenceList.push({
        checkID: check,
        status: hasBlockers ? "failed" : "passed",
        evidenceRef: `${request.target}:${content.length}bytes`,
        timestamp: Date.now(),
        message: hasBlockers
          ? `Verification failed due to blocker violations: ${allViolations.filter((v) => v.severity === "blocker").map((v) => v.message).join("; ")}`
          : `Verified successfully against active domain rules (${activeAdapters.map((a) => a.kind).join(", ") || "generic"})`,
      })
    }

    return {
      target: request.target,
      passed: !hasBlockers,
      evidence: evidenceList,
      violations: allViolations,
      executionTimeMs: Date.now() - startTime,
    }
  }
}

export const sharedVerificationOracle = new VerificationOracle()

export * as VerificationOracleModule from "./oracle"
