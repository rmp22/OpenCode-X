import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./audit.txt"

const Axis = Schema.Literals([
  "intent",
  "rationale",
  "product-truth",
  "content",
  "visual-fit",
  "behavior",
  "accessibility",
  "responsive",
  "code-quality",
  "structure",
  "tests",
  "security",
  "provenance",
])
const Severity = Schema.Literals(["blocker", "warning", "note"])
const Status = Schema.Literals(["pass", "fail", "unknown", "not-applicable", "verified"])

const Finding = Schema.Struct({
  axis: Axis,
  severity: Severity,
  evidence: Schema.NonEmptyString,
  risk: Schema.NonEmptyString,
  smallestUsefulFix: Schema.NonEmptyString,
  check: Schema.NonEmptyString,
})

const Check = Schema.Struct({
  name: Schema.NonEmptyString,
  status: Status,
  evidence: Schema.NonEmptyString,
  evidenceRef: Schema.optional(Schema.NonEmptyString),
})

export const Parameters = Schema.Struct({
  artifact: Schema.NonEmptyString,
  summary: Schema.NonEmptyString,
  axes: Schema.NonEmptyArray(Axis),
  findings: Schema.NonEmptyArray(Finding),
  checks: Schema.NonEmptyArray(Check),
  remainingUnknowns: Schema.Array(Schema.NonEmptyString),
})

type AxisValue = Schema.Schema.Type<typeof Axis>

type Metadata = {
  axes: AxisValue[]
  blockers: number
  warnings: number
  unknowns: string[]
  reportedPasses: number
  verifiedPasses: number
  unverified: string[]
}

export const AuditTool = Tool.define<typeof Parameters, Metadata, never>(
  "audit",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>) =>
        Effect.succeed({
          title: `Audit recorded for ${params.artifact}`,
          output: [
            "AUDIT REPORT",
            `Artifact: ${params.artifact}`,
            `Axes: ${params.axes.join(", ")}`,
            `Summary: ${params.summary}`,
            "",
            "FINDINGS",
            ...(params.findings.length
              ? params.findings.flatMap((finding) => [
                  `- [${finding.severity}] ${finding.axis}`,
                  `  evidence: ${finding.evidence}`,
                  `  risk: ${finding.risk}`,
                  `  smallest useful fix: ${finding.smallestUsefulFix}`,
                  `  check: ${finding.check}`,
                ])
              : ["- None recorded."]),
            "",
            "CHECKS",
            ...(params.checks.length
              ? params.checks.map(
                  (check) =>
                    `- [${check.status === "pass" ? "reported-pass/unverified" : check.status}] ${check.name}: ${check.evidence}${check.evidenceRef ? ` (ref: ${check.evidenceRef})` : ""}`,
                )
              : ["- None recorded."]),
            "",
            "REMAINING UNKNOWNS",
            ...(params.remainingUnknowns.length
              ? params.remainingUnknowns.map((item) => `- ${item}`)
              : ["- None recorded."]),
            "",
            "VERDICT",
            params.findings.some((finding) => finding.severity === "blocker")
              ? "BLOCKED: resolve the blocker findings before delivery."
              : params.checks.some((check) => check.status !== "verified" && check.status !== "not-applicable")
                ? `UNVERIFIED: ${params.checks.filter((check) => check.status !== "verified" && check.status !== "not-applicable").length} check(s) lack verification evidence; do not claim completion.`
                : "VERIFIED: every applicable check cites evidence.",
          ].join("\n"),
          metadata: {
            axes: [...params.axes],
            blockers: params.findings.filter((finding) => finding.severity === "blocker").length,
            warnings: params.findings.filter((finding) => finding.severity === "warning").length,
            unknowns: [...params.remainingUnknowns],
            reportedPasses: params.checks.filter((check) => check.status === "pass").length,
            verifiedPasses: params.checks.filter((check) => check.status === "verified").length,
            unverified: params.checks
              .filter((check) => check.status !== "verified" && check.status !== "not-applicable")
              .map((check) => check.name),
          },
        }),
    } satisfies Tool.DefWithoutID<typeof Parameters, Metadata>
  }),
)
