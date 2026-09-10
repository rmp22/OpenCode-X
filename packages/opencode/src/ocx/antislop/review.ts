import { StructuralSlop } from "./structural"
import { NamingSlop } from "./naming"
import { ErrorHandlingSlop } from "./error-handling"
import { FakeCompleteness } from "./fake-completeness"
import { DependencySlop } from "./dependency"
import { CommentSlop } from "./comment"
import { TestSlop } from "./test-slop"
import { VerificationSlop } from "./verification"
import { ArchitectureSlop } from "./architecture"
import { AbstractionSlop } from "./abstraction"
import { RefactorSlop } from "./refactor"
import { VibeCodingSlop } from "./vibe-coding"
import { FrontendSlop } from "./frontend"
import { VisualAiSlop } from "./visual-ai"
import { MagicValueSlop } from "./magic-value"
import { InconsistencySlop } from "./inconsistency"
import { CopyPasteSlop } from "./copy-paste"
import { SecuritySlop } from "./security"
import { PerformanceSlop } from "./performance"
import { SlopSignalScanner, type SlopSignal } from "./scanner"
import { SemanticResolver, type Diagnosis } from "./diagnosis"
import type { ProjectVocabulary } from "./vocabulary"
import type { SemanticNeighborhood } from "./context"
import type { SlopPolicy } from "./policy"

export type ReviewFinding = {
  readonly category: string
  readonly severity: "warning" | "blocker"
  readonly evidence: string
  readonly fix: string
  readonly filePath: string
}

export type Scorecard = {
  readonly structural: "pass" | "warn" | "fail"
  readonly naming: "pass" | "warn" | "fail"
  readonly errorHandling: "pass" | "warn" | "fail"
  readonly fakeCompleteness: "pass" | "warn" | "fail"
  readonly dependency: "pass" | "warn" | "fail"
  readonly comments: "pass" | "warn" | "fail"
  readonly tests: "pass" | "warn" | "fail"
  readonly verification: "pass" | "warn" | "fail"
  readonly architecture: "pass" | "warn" | "fail"
  readonly abstraction: "pass" | "warn" | "fail"
  readonly refactor: "pass" | "warn" | "fail"
  readonly vibeCoding: "pass" | "warn" | "fail"
  readonly frontend: "pass" | "warn" | "fail"
  readonly visualAi: "pass" | "warn" | "fail"
  readonly magicValue: "pass" | "warn" | "fail"
  readonly inconsistency: "pass" | "warn" | "fail"
  readonly copyPaste: "pass" | "warn" | "fail"
  readonly security: "pass" | "warn" | "fail"
  readonly performance: "pass" | "warn" | "fail"
}

export type AntiSlopReviewOptions = {
  readonly policy?: SlopPolicy
  readonly vocabulary?: ProjectVocabulary
  readonly neighborhoods?: ReadonlyMap<string, SemanticNeighborhood>
  readonly includeDomainChecks?: boolean
}

export type AntiSlopReview = {
  readonly findings: readonly ReviewFinding[]
  readonly scorecard: Scorecard
  readonly signals: readonly SlopSignal[]
  readonly diagnoses: readonly Diagnosis[]
}

function scoreFindings(findings: readonly { severity: "warning" | "blocker" }[]): "pass" | "warn" | "fail" {
  if (findings.length === 0) return "pass"
  if (findings.some((f) => f.severity === "blocker")) return "fail"
  return "warn"
}

export function reviewAntiSlop(
  files: readonly { path: string; content: string }[],
  options: AntiSlopReviewOptions = {},
): AntiSlopReview {
  const allFindings: ReviewFinding[] = []

  for (const file of files) {
    const structural = StructuralSlop.scanStructural(file.content, file.path)
    const naming = NamingSlop.scanNaming(file.content, file.path)
    const errorHandling = ErrorHandlingSlop.scanErrorHandling(file.content, file.path)
    const fakeCompleteness = FakeCompleteness.scanFakeCompleteness(file.content, file.path)
    const dependency = DependencySlop.scanDependency(file.content, file.path)
    const comments = CommentSlop.scanComments(file.content, file.path)
    const tests = TestSlop.scanTestSlop(file.content, file.path)
    const verification = VerificationSlop.scanVerification(file.content, file.path)
    const architecture = ArchitectureSlop.scanArchitectureSlop(file.content, file.path)
    const abstraction = AbstractionSlop.scanAbstraction(file.content, file.path)
    const refactor = RefactorSlop.scanRefactorSlop(file.content, file.path)
    const vibeCoding = VibeCodingSlop.scanVibeCoding(file.content, file.path)
    const frontend = options.includeDomainChecks ? FrontendSlop.scanFrontendSlop(file.content, file.path) : []
    const visualAi = options.includeDomainChecks ? VisualAiSlop.scanVisualAiSlop(file.content, file.path) : []
    const magicValue = MagicValueSlop.scanMagicValue(file.content, file.path)
    const inconsistency = InconsistencySlop.scanInconsistency(file.content, file.path)
    const copyPaste = CopyPasteSlop.scanCopyPaste(file.content, file.path)
    const security = SecuritySlop.scanSecuritySlop(file.content, file.path)
    const performance = PerformanceSlop.scanPerformanceSlop(file.content, file.path)

    allFindings.push(
      ...structural.map((f) => ({ ...f, category: "structural", filePath: file.path })),
      ...naming.map((f) => ({ ...f, category: "naming", filePath: file.path })),
      ...errorHandling.map((f) => ({ ...f, category: "errorHandling", filePath: file.path })),
      ...fakeCompleteness.map((f) => ({ ...f, category: "fakeCompleteness", filePath: file.path })),
      ...dependency.map((f) => ({ ...f, category: "dependency", filePath: file.path })),
      ...comments.map((f) => ({ ...f, category: "comments", filePath: file.path })),
      ...tests.map((f) => ({ ...f, category: "tests", filePath: file.path })),
      ...verification.map((f) => ({ ...f, category: "verification", filePath: file.path })),
      ...architecture.map((f) => ({ ...f, category: "architecture", filePath: file.path })),
      ...abstraction.map((f) => ({ ...f, category: "abstraction", filePath: file.path })),
      ...refactor.map((f) => ({ ...f, category: "refactor", filePath: file.path })),
      ...vibeCoding.map((f) => ({ ...f, category: "vibeCoding", filePath: file.path })),
      ...frontend.map((f) => ({ ...f, category: "frontend", filePath: file.path })),
      ...visualAi.map((f) => ({ ...f, category: "visualAi", filePath: file.path })),
      ...magicValue.map((f) => ({ ...f, category: "magicValue", filePath: file.path })),
      ...inconsistency.map((f) => ({ ...f, category: "inconsistency", filePath: file.path })),
      ...copyPaste.map((f) => ({ ...f, category: "copyPaste", filePath: file.path })),
      ...security.map((f) => ({ ...f, category: "security", filePath: file.path })),
      ...performance.map((f) => ({ ...f, category: "performance", filePath: file.path })),
    )
  }

  const signals = SlopSignalScanner.scanFiles({
    files,
    ...(options.policy ? { policy: options.policy } : {}),
    ...(options.vocabulary ? { vocabulary: options.vocabulary } : {}),
    ...(options.neighborhoods ? { neighborhoods: options.neighborhoods } : {}),
  }).signals
  allFindings.push(
    ...signals.map((signal) => ({
      category: signal.family,
      severity: signal.severity === "block" ? ("blocker" as const) : ("warning" as const),
      evidence: signal.evidence,
      fix: signal.action,
      filePath: signal.path ?? "",
    })),
  )

  const scorecard: Scorecard = {
    structural: scoreFindings(allFindings.filter((f) => f.category === "structural")),
    naming: scoreFindings(allFindings.filter((f) => f.category === "naming")),
    errorHandling: scoreFindings(allFindings.filter((f) => f.category === "errorHandling")),
    fakeCompleteness: scoreFindings(allFindings.filter((f) => f.category === "fakeCompleteness")),
    dependency: scoreFindings(allFindings.filter((f) => f.category === "dependency")),
    comments: scoreFindings(allFindings.filter((f) => f.category === "comments")),
    tests: scoreFindings(allFindings.filter((f) => f.category === "tests")),
    verification: scoreFindings(allFindings.filter((f) => f.category === "verification")),
    architecture: scoreFindings(allFindings.filter((f) => f.category === "architecture")),
    abstraction: scoreFindings(allFindings.filter((f) => f.category === "abstraction")),
    refactor: scoreFindings(allFindings.filter((f) => f.category === "refactor")),
    vibeCoding: scoreFindings(allFindings.filter((f) => f.category === "vibeCoding")),
    frontend: scoreFindings(allFindings.filter((f) => f.category === "frontend")),
    visualAi: scoreFindings(allFindings.filter((f) => f.category === "visualAi")),
    magicValue: scoreFindings(allFindings.filter((f) => f.category === "magicValue")),
    inconsistency: scoreFindings(allFindings.filter((f) => f.category === "inconsistency")),
    copyPaste: scoreFindings(allFindings.filter((f) => f.category === "copyPaste")),
    security: scoreFindings(allFindings.filter((f) => f.category === "security")),
    performance: scoreFindings(allFindings.filter((f) => f.category === "performance")),
  }

  return {
    findings: allFindings,
    scorecard,
    signals,
    diagnoses: signals.map((signal) =>
      SemanticResolver.diagnose({
        signal,
        ...(options.vocabulary ? { vocabulary: options.vocabulary } : {}),
        ...(signal.path && options.neighborhoods?.get(signal.path)
          ? { neighborhood: options.neighborhoods.get(signal.path) }
          : {}),
      }),
    ),
  }
}

export * as AntiSlopReviewer from "./review"
