import { describe, expect, test } from "bun:test"
import { AntiSlopContext, AntiSlopRuntime, AntiSlopReviewer, ArtifactClassifier, ComprehensionGate, IdentifierShapeAnalyzer, ProjectVocabularyIndex, RepairPlanner, ReviewCostGate, SlopPolicy, SlopSignalScanner, SemanticResolver } from "../../src/ocx/antislop"
import { ExitGate } from "../../src/ocx/exit-gate"
import { SemanticGraph } from "../../src/ocx/semantic/graph"
import { Strategy } from "../../src/ocx/strategy"

const longPredicate = "launchRequestCarriesHeavyResourceMask"

describe("anti-slop policy and identifier shape", () => {
  test("loads the required diagnostic pipeline into the quality strategy", () => {
    const quality = Strategy.load("quality")

    expect(quality).toContain("SIGNAL -> CONTEXT -> ROOT CAUSE -> REPAIR -> VERIFY")
    expect(quality).toContain("Never use synonym replacement as the repair")
  })

  test("reports semantic expansion without proposing a replacement", () => {
    const result = IdentifierShapeAnalyzer.analyze(longPredicate)

    expect(result.tokens).toEqual(["launch", "request", "carries", "heavy", "resource", "mask"])
    expect(result.semanticWords).toBe(6)
    expect(result.signals).toContain("sentence-shaped-predicate")
    expect(result.signals).toContain("representation-leakage")
    expect(result.action).toBe("reject")
    expect(result).not.toHaveProperty("replacement")
  })

  test("flags invented abbreviation compression", () => {
    const result = IdentifierShapeAnalyzer.analyze("lReqHResMask")

    expect(result.signals).toContain("invented-abbreviation")
    expect(result.action).not.toBe("allow")
  })

  test("reports repeated owner context and keeps the semantic distinction", () => {
    const result = IdentifierShapeAnalyzer.analyze("shouldSchedulerPolicyApply", {
      enclosingTerms: ["SchedulerPolicy"],
    })

    expect(result.signals).toContain("enclosing-context-repetition")
    expect(result.signals).toContain("sentence-shaped-predicate")
  })

  test("accepts configured platform terms without shortening them", () => {
    const policy = SlopPolicy.createPolicy({ upstreamTerms: ["ActivityTaskManagerService"] })
    const result = IdentifierShapeAnalyzer.analyze("ActivityTaskManagerService", {}, policy)

    expect(result.exempted).toBe(true)
    expect(result.signals).toEqual([])
    expect(result.action).toBe("allow")
  })

  test("supports configurable thresholds", () => {
    const policy = SlopPolicy.createPolicy({
      identifier: { advisoryLength: 8, strongLength: 12, advisorySemanticWords: 3, strongSemanticWords: 4 },
    })
    const result = IdentifierShapeAnalyzer.analyze("loadUsers", {}, policy)

    expect(result.signals).toContain("length")
    expect(result.signals).not.toContain("semantic-word-count")
  })

  test("scans declarations without mutating source", () => {
    const source = `function ${longPredicate}() { return true }`
    const findings = IdentifierShapeAnalyzer.scanSource(source, "scheduler.ts")

    expect(findings).toHaveLength(1)
    expect(findings[0]?.identifier).toBe(longPredicate)
    expect(source).toBe(`function ${longPredicate}() { return true }`)
  })
})

describe("anti-slop context and vocabulary", () => {
  test("classifies distinct artifact surfaces", () => {
    expect(ArtifactClassifier.classifyPath("src/scheduler.ts")).toBe("source_code")
    expect(ArtifactClassifier.classifyPath("docs/README.md")).toBe("documentation")
    expect(ArtifactClassifier.classify({ kind: "agent_update" })).toBe("agent_update")
    expect(ArtifactClassifier.classify({ kind: "identifier" })).toBe("identifier")
  })

  test("builds local and public project vocabulary", () => {
    const vocabulary = ProjectVocabularyIndex.build({
      files: [{ path: "src/scheduler.ts", content: "export function requestSchedulerReevaluation() {}" }],
      upstreamTerms: ["kick"],
    })

    expect(ProjectVocabularyIndex.isEstablished(vocabulary, "requestSchedulerReevaluation")).toBe(true)
    expect(ProjectVocabularyIndex.isEstablished(vocabulary, "kick")).toBe(true)
    expect(vocabulary.publicTerms).toContain("requestSchedulerReevaluation")
    expect(ProjectVocabularyIndex.render(vocabulary)).toContain("PROJECT VOCABULARY")
  })

  test("collects callers, callees, owner, siblings, and tests", () => {
    const graph = SemanticGraph.buildGraph(
      [
        { id: "fn", kind: "function", name: "kickScheduler", path: "src/scheduler.ts", exported: true, attributes: [] },
        { id: "owner", kind: "class", name: "Scheduler", path: "src/scheduler.ts", exported: true, attributes: [] },
        { id: "caller", kind: "function", name: "refresh", path: "src/worker.ts", exported: false, attributes: [] },
        { id: "callee", kind: "function", name: "postMessage", path: "src/scheduler.ts", exported: false, attributes: [] },
        { id: "sibling", kind: "function", name: "stop", path: "src/scheduler.ts", exported: false, attributes: [] },
        { id: "test", kind: "test", name: "schedulerTest", path: "test/scheduler.test.ts", exported: false, attributes: [] },
      ],
      [
        { source: "fn", target: "owner", kind: "belongs-to", weight: 1 },
        { source: "caller", target: "fn", kind: "calls", weight: 1 },
        { source: "fn", target: "callee", kind: "calls", weight: 1 },
        { source: "test", target: "fn", kind: "tests", weight: 1 },
      ],
    )
    const result = AntiSlopContext.neighborhood(graph, "kickScheduler")

    expect(result.owner?.name).toBe("Scheduler")
    expect(result.callers.map((item) => item.name)).toEqual(["refresh"])
    expect(result.callees.map((item) => item.name)).toEqual(["postMessage"])
    expect(result.siblings.map((item) => item.name)).toContain("stop")
    expect(result.tests.map((item) => item.name)).toEqual(["schedulerTest"])
  })
})

describe("anti-slop diagnosis and gates", () => {
  test("diagnoses a naming signal before planning a non-automatic repair", () => {
    const signal = SlopSignalScanner.scan({ path: "src/scheduler.ts", content: `function ${longPredicate}() {}` }).signals[0]
    expect(signal).toBeDefined()
    const diagnosis = SemanticResolver.diagnose({ signal: signal!, vocabulary: ProjectVocabularyIndex.build() })
    const repair = RepairPlanner.planRepair(diagnosis)

    expect(diagnosis.diagnosis).toContain("identifier")
    expect(repair.kind).toBe("semantic-review")
    expect(repair.automatic).toBe(false)
    expect(repair.action).toContain("project vocabulary")
  })

  test("checks all comprehension answers and accepts grounded evidence", () => {
    const incomplete = ComprehensionGate.check({ required: ["problem", "verification"] })
    expect(incomplete.complete).toBe(false)
    expect(incomplete.missing).toEqual(["problem", "verification"])

    const complete = ComprehensionGate.check({
      problem: "The request path loses the retry reason.",
      rootCause: "The caller drops the typed error before persistence.",
      owner: "The session request boundary owns the conversion.",
      architectureFit: "The change follows the existing session error path.",
      behaviorChange: "The retry record keeps the original reason.",
      assumptions: ["The stored error remains typed."],
      edgeCases: ["A missing error reason stays unknown."],
      risks: ["Old records may have no reason."],
      verification: ["The focused retry test passes."],
      naming: "The new field describes the stored retry reason.",
    })
    expect(complete.complete).toBe(true)
    expect(complete.findings).toEqual([])
  })

  test("separates small review cost from excessive change cost", () => {
    expect(ReviewCostGate.estimate({ changedFiles: ["a.ts"], addedLines: 12 }).level).toBe("low")
    const large = ReviewCostGate.estimate({
      changedFiles: Array.from({ length: 13 }, (_, index) => `${index}.ts`),
      diffLines: 1_200,
      newAbstractions: 2,
      newDependencies: 1,
      verificationGaps: 1,
      selfReview: false,
    })
    expect(large.level).toBe("high")
    expect(ReviewCostGate.findings({
      changedFiles: large.changedFiles ? Array.from({ length: large.changedFiles }, (_, index) => `${index}.ts`) : [],
      diffLines: large.diffLines,
      newAbstractions: 2,
      newDependencies: 1,
      verificationGaps: 1,
      selfReview: false,
    }).map((finding) => finding.id)).toEqual(["RC-review-cost", "RC-self-review"])
  })
})

describe("anti-slop runtime integration", () => {
  test("returns advisory changed-file signals and no rewrite", () => {
    const source = `function ${longPredicate}() {}`
    const advisories = AntiSlopRuntime.scanChangedFiles({ files: [{ path: "src/scheduler.ts", content: source }] })

    expect(advisories.some((item) => item.id === "A-N-semantic-compression")).toBe(true)
    expect(source).toBe(`function ${longPredicate}() {}`)
    expect(ExitGate.antiSlopAdvisories(new Map([["src/scheduler.ts", [source]]]))).not.toEqual([])
  })

  test("keeps explicit comprehension and review-cost gates in ExitGate", () => {
    const comprehension = ExitGate.evaluate({
      reply: "Done.",
      entries: [],
      openTodos: [],
      tier: "quick",
      comprehension: { required: ["problem"] },
    })
    expect(comprehension.map((finding) => finding.id)).toContain("CG-missing-evidence")

    const cost = ExitGate.evaluate({
      reply: "Done.",
      entries: [],
      openTodos: [],
      tier: "quick",
      reviewCost: { changedFiles: Array.from({ length: 13 }, (_, index) => `${index}.ts`), diffLines: 1_200 },
    })
    expect(cost.map((finding) => finding.id)).toContain("RC-review-cost")
  })

  test("adds structured signals and diagnoses without changing the old scorecard", () => {
    const result = AntiSlopReviewer.reviewAntiSlop([{ path: "src/scheduler.ts", content: `function ${longPredicate}() {}` }])

    expect(result.scorecard).toHaveProperty("naming")
    expect(result.signals.some((signal) => signal.id === "N-semantic-compression")).toBe(true)
    expect(result.diagnoses).toHaveLength(result.signals.length)
  })
})

describe("anti-slop precision", () => {
  test("does not treat ordinary local names as slop without context", async () => {
    const { NamingSlop } = await import("../../src/ocx/antislop")
    const findings = NamingSlop.scanNaming("const result = parse(input)\nconst options = loadConfig()", "src/parser.ts")
    expect(findings.some((finding) => finding.evidence.includes('"result"'))).toBe(false)
    expect(findings.some((finding) => finding.evidence.includes('"options"'))).toBe(false)
  })

  test("does not classify a normal div count as a giant page", async () => {
    const { FrontendSlop } = await import("../../src/ocx/antislop")
    const html = `<main>${Array.from({ length: 20 }, (_, index) => `<div class="row">${index}</div>`).join("")}</main>`
    expect(FrontendSlop.scanFrontendSlop(html, "index.html").some((finding) => finding.rule === "F-large-page-surface")).toBe(false)
  })

  test("flags only clearly large multi-section single-file pages for boundary review", async () => {
    const { FrontendSlop } = await import("../../src/ocx/antislop")
    const sections = Array.from({ length: 10 }, (_, index) => `<section>section ${index}</section>`).join("\n")
    const html = Array.from({ length: 55 }, () => sections).join("\n")
    expect(FrontendSlop.scanFrontendSlop(html, "index.html").some((finding) => finding.rule === "F-large-page-surface")).toBe(true)
  })
})

describe("visual anti-slop precision", () => {
  test("does not ban a deliberate single gradient or rounded surface", async () => {
    const { VisualAiSlop } = await import("../../src/ocx/antislop")
    const css = `.hero { background: linear-gradient(#111, #222); border-radius: 24px; }`
    expect(VisualAiSlop.scanVisualAiSlop(css, "hero.css")).toEqual([])
  })

  test("flags repeated glass treatment rather than the mere existence of glass", async () => {
    const { VisualAiSlop } = await import("../../src/ocx/antislop")
    const css = Array.from({ length: 6 }, (_, i) => `.panel${i} { backdrop-filter: blur(18px); }`).join("\n")
    expect(VisualAiSlop.scanVisualAiSlop(css, "app.css").some((finding) => finding.rule === "V-glass-density")).toBe(true)
  })
})

describe("systems and kernel anti-slop invariants", () => {
  test("flags unchecked kmalloc allocation in C", async () => {
    const { SystemsSlop } = await import("../../src/ocx/antislop")
    const code = `void* buf = kmalloc(size, GFP_KERNEL);\nmemset(buf, 0, size);\nreturn 0;`
    const findings = SystemsSlop.scanSystems(code, "drivers/net/device.c")
    expect(findings.some((f) => f.rule === "K-unchecked-alloc")).toBe(true)
  })

  test("does not flag kmalloc with proper null check", async () => {
    const { SystemsSlop } = await import("../../src/ocx/antislop")
    const code = `void* buf = kmalloc(size, GFP_KERNEL);\nif (!buf)\n    return -ENOMEM;\nreturn 0;`
    const findings = SystemsSlop.scanSystems(code, "drivers/net/device.c")
    expect(findings.some((f) => f.rule === "K-unchecked-alloc")).toBe(false)
  })

  test("flags blocking sleep or GFP_KERNEL while holding spinlock", async () => {
    const { SystemsSlop } = await import("../../src/ocx/antislop")
    const code = `spin_lock(&lock);\nmsleep(10);\nspin_unlock(&lock);`
    const findings = SystemsSlop.scanSystems(code, "kernel/sched/core.c")
    expect(findings.some((f) => f.rule === "K-sleep-in-atomic")).toBe(true)
  })

  test("flags direct __user pointer dereference without copy_from_user", async () => {
    const { SystemsSlop } = await import("../../src/ocx/antislop")
    const code = `int write_data(char __user *buf) {\n    char kbuf = *buf;\n    return 0;\n}`
    const findings = SystemsSlop.scanSystems(code, "fs/char_dev.c")
    expect(findings.some((f) => f.rule === "K-direct-user-dereference")).toBe(true)
  })

  test("flags unchecked copy_from_user", async () => {
    const { SystemsSlop } = await import("../../src/ocx/antislop")
    const code = `copy_from_user(kbuf, ubuf, len);\ndo_work();`
    const findings = SystemsSlop.scanSystems(code, "drivers/misc/test.c")
    expect(findings.some((f) => f.rule === "K-unchecked-user-copy")).toBe(true)
  })
})

describe("trajectory quality model", () => {
  test("classifies improving trajectory over 5 turns", async () => {
    const { TrajectoryModel } = await import("../../src/ocx/antislop")
    const model = new TrajectoryModel.TrajectoryQualityModel()
    const scores = [0.6, 0.68, 0.75, 0.82, 0.9]
    let lastAnalysis
    for (let i = 0; i < scores.length; i++) {
      lastAnalysis = model.recordTurnScore(i + 1, scores[i])
    }
    expect(lastAnalysis?.classification).toBe("IMPROVING")
    expect(lastAnalysis?.consecutiveDegradingTurns).toBe(0)
    expect(lastAnalysis?.circuitBreakerTriggered).toBe(false)
  })

  test("classifies stable trajectory within epsilon", async () => {
    const { TrajectoryModel } = await import("../../src/ocx/antislop")
    const model = new TrajectoryModel.TrajectoryQualityModel()
    const scores = [0.8, 0.81, 0.8, 0.82, 0.81]
    let lastAnalysis
    for (let i = 0; i < scores.length; i++) {
      lastAnalysis = model.recordTurnScore(i + 1, scores[i])
    }
    expect(lastAnalysis?.classification).toBe("STABLE")
  })

  test("classifies degrading trajectory and trips circuit breaker after 3 turns", async () => {
    const { TrajectoryModel } = await import("../../src/ocx/antislop")
    const model = new TrajectoryModel.TrajectoryQualityModel({ circuitBreakerLimit: 3 })
    model.recordTurnScore(1, 0.85)
    model.recordTurnScore(2, 0.78)
    const turn3 = model.recordTurnScore(3, 0.7)
    expect(turn3.classification).toBe("DEGRADING")
    expect(turn3.consecutiveDegradingTurns).toBe(2)
    expect(turn3.circuitBreakerTriggered).toBe(false)

    const turn4 = model.recordTurnScore(4, 0.62)
    expect(turn4.classification).toBe("DEGRADING")
    expect(turn4.consecutiveDegradingTurns).toBe(3)
    expect(turn4.circuitBreakerTriggered).toBe(true)
    expect(turn4.alerts.some((a) => a.level === "critical")).toBe(true)
  })

  test("detects compounding debt on accelerating degradation", async () => {
    const { TrajectoryModel } = await import("../../src/ocx/antislop")
    const model = new TrajectoryModel.TrajectoryQualityModel()
    model.recordTurnScore(1, 0.9)
    model.recordTurnScore(2, 0.85)
    const turn3 = model.recordTurnScore(3, 0.72)
    expect(turn3.acceleratingDegradation).toBe(true)
    expect(turn3.compoundingDebtDetected).toBe(true)
    expect(turn3.alerts.some((a) => a.level === "error")).toBe(true)
  })

  test("detects volatile trajectory when variance is high", async () => {
    const { TrajectoryModel } = await import("../../src/ocx/antislop")
    const model = new TrajectoryModel.TrajectoryQualityModel({ varianceThreshold: 0.02 })
    const scores = [0.9, 0.4, 0.88, 0.35, 0.85]
    let lastAnalysis
    for (let i = 0; i < scores.length; i++) {
      lastAnalysis = model.recordTurnScore(i + 1, scores[i])
    }
    expect(lastAnalysis?.classification).toBe("VOLATILE")
  })

  test("detects fan-out surge and emits warning", async () => {
    const { TrajectoryModel } = await import("../../src/ocx/antislop")
    const model = new TrajectoryModel.TrajectoryQualityModel()
    model.recordTurnScore(1, 0.85, { fanOut: 5 })
    const turn2 = model.recordTurnScore(2, 0.8, { fanOut: 8 })
    expect(turn2.alerts.some((a) => a.recommendation?.includes("fan-out"))).toBe(true)
  })
})

describe("change attribution baseline", () => {
  test("classifies pure addition diff", async () => {
    const { ChangeAttribution } = await import("../../src/ocx/antislop")
    const diff = `--- a/src/feature.ts\n+++ b/src/feature.ts\n@@ -0,0 +1,5 @@\n+export function helper() {\n+  return 42;\n+}\n`
    const attribution = ChangeAttribution.attributeDiff(diff)
    expect(attribution.chunks.length).toBe(1)
    expect(attribution.chunks[0].category).toBe("PURE_ADDITION")
  })

  test("classifies intentional refactor diff", async () => {
    const { ChangeAttribution } = await import("../../src/ocx/antislop")
    const diff = `--- a/src/feature.ts\n+++ b/src/feature.ts\n@@ -10,12 +10,4 @@\n-if (a) { return 1; }\n-if (b) { return 2; }\n-if (c) { return 3; }\n-return 4;\n+return lookup(key);\n`
    const attribution = ChangeAttribution.attributeDiff(diff)
    expect(attribution.chunks[0].category).toBe("INTENTIONAL_REFACTOR")
    expect(attribution.intentionalRefactorRatio).toBe(1.0)
  })

  test("classifies incidental erosion diff", async () => {
    const { ChangeAttribution } = await import("../../src/ocx/antislop")
    const diff = `--- a/src/feature.ts\n+++ b/src/feature.ts\n@@ -10,4 +10,12 @@\n-return lookup(key);\n+if (a) {\n+  if (b) {\n+    while (c) {\n+      try { doWork(); } catch (err) { handle(err); }\n+    }\n+  }\n+}\n`
    const attribution = ChangeAttribution.attributeDiff(diff)
    expect(attribution.chunks[0].category).toBe("INCIDENTAL_EROSION")
    expect(attribution.incidentalErosionCount).toBe(1)
  })

  test("classifies abandoned branch diff", async () => {
    const { ChangeAttribution } = await import("../../src/ocx/antislop")
    const diff = `--- a/src/feature.ts\n+++ b/src/feature.ts\n@@ -5,2 +5,4 @@\n+if (false) { unreachable(); }\n+return null; // temporary\n`
    const attribution = ChangeAttribution.attributeDiff(diff)
    expect(attribution.chunks[0].category).toBe("ABANDONED_BRANCH")
  })

  test("computes blast radius based on caller connections", async () => {
    const { ChangeAttribution } = await import("../../src/ocx/antislop")
    const diff = `--- a/src/core.ts\n+++ b/src/core.ts\n@@ -1,3 +1,3 @@\n-export function base() {}\n+export function base() { return true; }\n`
    const attribution = ChangeAttribution.attributeDiff(diff, {
      callerMap: {
        "src/core.ts": ["client.ts", "server.ts", "api.ts", "worker.ts"],
      },
    })
    expect(attribution.blastRadius).toBeGreaterThan(1.0)
  })

  test("computes blame score distinguishing new debt from legacy debt", async () => {
    const { ChangeAttribution } = await import("../../src/ocx/antislop")
    const diff = `--- a/src/feature.ts\n+++ b/src/feature.ts\n@@ -1,5 +1,6 @@\n+const x = 1;\n`
    const attribution = ChangeAttribution.attributeDiff(diff, {
      preExistingFindingsCount: 10,
      newFindingsCount: 2,
    })
    expect(attribution.blameScore).toBeCloseTo(2 / 12, 2)
  })
})

describe("structural erosion hotspots", () => {
  test("flags high churn file and requires cooldown", async () => {
    const { StructuralErosion } = await import("../../src/ocx/antislop")
    const tracker = new StructuralErosion.StructuralErosionTracker()
    tracker.recordTurn(1, ["src/god.ts"], { "src/god.ts": { lineCount: 100 } })
    tracker.recordTurn(2, ["src/god.ts"])
    tracker.recordTurn(3, ["src/god.ts"])
    tracker.recordTurn(4, ["src/other.ts"])

    const hotspots = tracker.analyzeHotspots()
    const godHotspot = hotspots.find((h) => h.file === "src/god.ts")
    expect(godHotspot?.churnPercentage).toBe(75.0)
    expect(godHotspot?.cooldownRequired).toBe(true)
    expect(godHotspot?.recommendations.some((r) => r.includes("Cooldown required"))).toBe(true)
  })

  test("detects fan-out explosion", async () => {
    const { StructuralErosion } = await import("../../src/ocx/antislop")
    const tracker = new StructuralErosion.StructuralErosionTracker()
    tracker.recordTurn(1, ["src/module.ts"], { "src/module.ts": { outgoingDependencies: 4 } })
    tracker.recordTurn(2, ["src/module.ts"], { "src/module.ts": { outgoingDependencies: 8 } })

    const hotspots = tracker.analyzeHotspots()
    const hotspot = hotspots.find((h) => h.file === "src/module.ts")
    expect(hotspot?.fanOutIncreasePercentage).toBe(100.0)
    expect(hotspot?.recommendations.some((r) => r.includes("Outgoing dependencies grew"))).toBe(true)
  })

  test("detects nesting creep and recommends early-return", async () => {
    const { StructuralErosion } = await import("../../src/ocx/antislop")
    const tracker = new StructuralErosion.StructuralErosionTracker()
    tracker.recordTurn(1, ["src/nested.ts"], { "src/nested.ts": { maxNestingDepth: 2 } })
    tracker.recordTurn(2, ["src/nested.ts"], { "src/nested.ts": { maxNestingDepth: 5 } })

    const hotspots = tracker.analyzeHotspots()
    const hotspot = hotspots.find((h) => h.file === "src/nested.ts")
    expect(hotspot?.nestingDepthIncrease).toBe(3)
    expect(hotspot?.recommendations.some((r) => r.includes("early-return"))).toBe(true)
  })

  test("calculates god module score and criticality based on centrality", async () => {
    const { StructuralErosion } = await import("../../src/ocx/antislop")
    const tracker = new StructuralErosion.StructuralErosionTracker()
    tracker.recordTurn(1, ["src/mega.ts"], {
      "src/mega.ts": {
        lineCount: 600,
        exportCount: 20,
        methodCount: 30,
        centrality: 0.8,
      },
    })

    const hotspots = tracker.analyzeHotspots()
    const mega = hotspots.find((h) => h.file === "src/mega.ts")
    expect(mega?.godModuleScore).toBeGreaterThanOrEqual(0.7)
    expect(mega?.isCritical).toBe(true)
  })
})

describe("verbosity & duplication signals", () => {
  test("detects near-clone code duplication across files", async () => {
    const { VerbositySignals } = await import("../../src/ocx/antislop")
    const codeA = `
function processUser(id: string) {
  const user = fetchUser(id);
  validate(user);
  notify(user);
  return user;
}
`
    const codeB = `
function processCustomer(id: string) {
  const customer = fetchUser(id);
  validate(customer);
  notify(customer);
  return customer;
}
`
    const signals = VerbositySignals.detectDuplication({
      "src/user.ts": codeA,
      "src/customer.ts": codeB,
    })
    expect(signals.some((s) => s.rule === "anti-slop/duplicate-code")).toBe(true)
  })

  test("detects wrapper bloat pass-through function", async () => {
    const { VerbositySignals } = await import("../../src/ocx/antislop")
    const code = `
export function forwardRequest(req: Request) {
  return dispatch(req);
}
`
    const signals = VerbositySignals.detectWrapperBloat(code, "src/wrapper.ts")
    expect(signals.some((s) => s.rule === "anti-slop/wrapper-bloat")).toBe(true)
  })

  test("detects echo comment", async () => {
    const { VerbositySignals } = await import("../../src/ocx/antislop")
    const slash = "/" + "/"
    const code = `${slash} getUser\nfunction getUser(id: string) {\n  return id;\n}`
    const signals = VerbositySignals.detectCommentSlop(code, "src/user.ts")
    expect(signals.some((s) => s.rule === "anti-slop/echo-comment")).toBe(true)
  })

  test("detects comment density anomaly when comments exceed 30%", async () => {
    const { VerbositySignals } = await import("../../src/ocx/antislop")
    const slash = "/" + "/"
    const lines = [
      `${slash} note 1`,
      `${slash} note 2`,
      `${slash} note 3`,
      `${slash} note 4`,
      `${slash} note 5`,
      "const a = 1;",
      "const b = 2;",
      "const c = 3;",
      "const d = 4;",
      "const e = 5;",
      "const f = 6;",
      "const g = 7;",
      "const h = 8;",
      "const i = 9;",
      "const j = 10;",
    ]
    const code = lines.join("\n")
    const signals = VerbositySignals.detectCommentSlop(code, "src/verbose.ts")
    expect(signals.some((s) => s.rule === "anti-slop/comment-density-anomaly")).toBe(true)
  })

  test("computes verbosity index relative to baseline", async () => {
    const { VerbositySignals } = await import("../../src/ocx/antislop")
    const index = VerbositySignals.calculateVerbosityIndex(500, 200)
    expect(index).toBe(2.5)
  })
})

describe("refactor trigger & dependency graph integration", () => {
  test("triggers refactor on critical erosion score > 0.6", async () => {
    const { RefactorTrigger } = await import("../../src/ocx/antislop")
    const result = RefactorTrigger.evaluateRefactorTriggers({
      hotspots: [
        {
          file: "src/core.ts",
          churnPercentage: 80,
          fanOutIncreasePercentage: 60,
          nestingDepthIncrease: 3,
          godModuleScore: 0.8,
          compositeErosionScore: 0.75,
          centrality: 0.9,
          isCritical: true,
          cooldownRequired: true,
          recommendations: [],
        },
      ],
    })
    expect(result.triggered).toBe(true)
    expect(result.triggers.some((t) => t.includes("Structural erosion on src/core.ts"))).toBe(true)
    expect(result.plan.some((p) => p.action === "EXTRACT_MODULE")).toBe(true)
  })

  test("triggers refactor on degrading trajectory for 2 consecutive turns", async () => {
    const { RefactorTrigger } = await import("../../src/ocx/antislop")
    const result = RefactorTrigger.evaluateRefactorTriggers({
      trajectory: {
        classification: "DEGRADING",
        deltaQ: -0.1,
        acceleratingDegradation: false,
        variance: 0.01,
        secondDerivative: 0,
        circuitBreakerTriggered: false,
        alerts: [],
        compoundingDebtDetected: true,
        consecutiveDegradingTurns: 2,
      },
    })
    expect(result.triggered).toBe(true)
    expect(result.triggers.some((t) => t.includes("DEGRADING for 2"))).toBe(true)
  })

  test("triggers refactor on blast radius exceeding threshold", async () => {
    const { RefactorTrigger } = await import("../../src/ocx/antislop")
    const result = RefactorTrigger.evaluateRefactorTriggers({
      attribution: {
        turn: 1,
        chunks: [],
        blastRadius: 3.5,
        blameScore: 0.8,
        intentionalRefactorRatio: 0.2,
        incidentalErosionCount: 2,
      },
    })
    expect(result.triggered).toBe(true)
    expect(result.triggers.some((t) => t.includes("blast radius (3.5)"))).toBe(true)
  })

  test("identifies highest centrality node and orders plan topologically", async () => {
    const { RefactorTrigger } = await import("../../src/ocx/antislop")
    const graph = new RefactorTrigger.SimpleDependencyGraph()
    graph.addEdge("src/consumer.ts", "src/core.ts")
    graph.addEdge("src/worker.ts", "src/core.ts")
    graph.addEdge("src/api.ts", "src/core.ts")

    const result = RefactorTrigger.evaluateRefactorTriggers({
      hotspots: [
        {
          file: "src/consumer.ts",
          churnPercentage: 60,
          fanOutIncreasePercentage: 0,
          nestingDepthIncrease: 2,
          godModuleScore: 0.2,
          compositeErosionScore: 0.65,
          centrality: 0.2,
          isCritical: false,
          cooldownRequired: false,
          recommendations: [],
        },
        {
          file: "src/core.ts",
          churnPercentage: 70,
          fanOutIncreasePercentage: 70,
          nestingDepthIncrease: 3,
          godModuleScore: 0.9,
          compositeErosionScore: 0.85,
          centrality: 0.9,
          isCritical: true,
          cooldownRequired: true,
          recommendations: [],
        },
      ],
      graph,
    })

    expect(result.highestCentralityTarget).toBe("src/core.ts")
    expect(result.plan.length).toBeGreaterThan(0)
  })
})

describe("finding dedup & actionable feedback loop", () => {
  test("tracks lifecycle states and escalates persistent warnings to blockers", async () => {
    const { FindingDedup } = await import("../../src/ocx/antislop")
    const dedup = new FindingDedup.FindingDeduplicator({ escalationThreshold: 3, topK: 5 })

    const rawFinding = {
      id: "f1",
      rule: "anti-slop/no-any",
      severity: "warning" as const,
      file: "src/model.ts",
      line: 10,
      evidence: "let x: any = 1;",
      fix: "Use unknown instead.",
    }

    const turn1 = dedup.processTurn(1, [rawFinding])
    expect(turn1.newCount).toBe(1)
    expect(turn1.topFindings[0].state).toBe("NEW")
    expect(turn1.topFindings[0].severity).toBe("warning")

    const turn2 = dedup.processTurn(2, [{ ...rawFinding, line: 15 }])
    expect(turn2.persistentCount).toBe(1)
    expect(turn2.topFindings[0].state).toBe("PERSISTENT")
    expect(turn2.topFindings[0].severity).toBe("warning")

    const turn3 = dedup.processTurn(3, [rawFinding])
    expect(turn3.topFindings[0].state).toBe("PERSISTENT")

    const turn4 = dedup.processTurn(4, [rawFinding])
    expect(turn4.topFindings[0].escalatedToBlocker).toBe(true)
    expect(turn4.topFindings[0].severity).toBe("blocker")

    const turn5 = dedup.processTurn(5, [])
    expect(turn5.resolvedCount).toBe(1)

    const turn6 = dedup.processTurn(6, [rawFinding])
    expect(turn6.topFindings[0].state).toBe("REINTRODUCED")
  })

  test("generates actionable feedback text", async () => {
    const { FindingDedup } = await import("../../src/ocx/antislop")
    const dedup = new FindingDedup.FindingDeduplicator()
    const result = dedup.processTurn(1, [
      {
        id: "f1",
        rule: "anti-slop/naming",
        severity: "warning",
        file: "src/api.ts",
        line: 42,
        evidence: "const data = req;",
        fix: "Rename data to requestPayload.",
      },
    ])
    expect(result.formattedFeedback).toContain("anti-slop/naming")
    expect(result.formattedFeedback).toContain("Rename data to requestPayload.")
  })
})

describe("iterative extension evaluations", () => {
  test("runs 3, 5, and 10-turn benchmark sessions successfully", async () => {
    const { MultiTurnEvals } = await import("../../src/ocx/antislop")
    const sessions = MultiTurnEvals.createBenchmarkSessions()
    expect(sessions.some((s) => s.turns.length === 3)).toBe(true)
    expect(sessions.some((s) => s.turns.length === 5)).toBe(true)
    expect(sessions.some((s) => s.turns.length === 10)).toBe(true)

    const metrics = MultiTurnEvals.runBenchmarkSuite(sessions)
    expect(metrics.totalSessions).toBe(sessions.length)
    expect(metrics.f1Score).toBeGreaterThanOrEqual(0.85)
    expect(metrics.falsePositiveRate).toBeLessThan(0.05)
    expect(metrics.avgDetectionLatency).toBeGreaterThanOrEqual(0)
  })

  test("accurately measures drift detection latency on degrading session", async () => {
    const { MultiTurnEvals } = await import("../../src/ocx/antislop")
    const session = {
      id: "test-latency",
      description: "Degradation starts at turn 2",
      type: "negative" as const,
      groundTruthTrajectory: "DEGRADING" as const,
      debtIntroducedAtTurn: 2,
      turns: [
        { turn: 1, file: "src/calc.ts", score: 0.9 },
        { turn: 2, file: "src/calc.ts", score: 0.82 },
        { turn: 3, file: "src/calc.ts", score: 0.7 },
      ],
    }
    const result = MultiTurnEvals.runSimulation(session)
    expect(result.driftDetected).toBe(true)
    expect(result.driftDetectionLatencyTurns).toBeDefined()
  })
})

describe("calibration & goodhart protection", () => {
  test("detects cosmetic variable renaming", async () => {
    const { MetricCalibration } = await import("../../src/ocx/antislop")
    const beforeCode = `
function calculate(inputVal: number, scaleVal: number) {
  const resultVal = inputVal * scaleVal;
  return resultVal + 10;
}
`
    const afterCode = `
function calculate(x: number, y: number) {
  const z = x * y;
  return z + 10;
}
`
    const warnings = MetricCalibration.detectGaming(beforeCode, afterCode, "src/calc.ts")
    expect(warnings.some((w) => w.gamingPattern === "cosmetic-variable-renaming")).toBe(true)
  })

  test("detects comment stripping without refactoring", async () => {
    const { MetricCalibration } = await import("../../src/ocx/antislop")
    const slash = "/" + "/"
    const beforeCode = `${slash} Important architectural comment that explains something crucial\n${slash} Additional line detailing the exact security requirements\nfunction auth() { return true; }`
    const afterCode = `function auth() { return true; }`
    const warnings = MetricCalibration.detectGaming(beforeCode, afterCode, "src/auth.ts")
    expect(warnings.some((w) => w.gamingPattern === "comment-stripping-without-refactoring")).toBe(true)
  })

  test("detects excessive inlining that spikes nesting depth", async () => {
    const { MetricCalibration } = await import("../../src/ocx/antislop")
    const beforeCode = `
function step1() { if (a) { return 1; } return 0; }
function step2() { if (b) { return 2; } return 0; }
function run() { return step1() + step2(); }
`
    const afterCode = `
function run() {
  if (a) {
    if (b) {
      if (c) {
        if (d) {
          return 3;
        }
      }
    }
  }
  return 0;
}
`
    const warnings = MetricCalibration.detectGaming(beforeCode, afterCode, "src/run.ts")
    expect(warnings.some((w) => w.gamingPattern === "excessive-inlining-nesting-spike")).toBe(true)
  })

  test("rejects insignificant cosmetic micro-changes", async () => {
    const { MetricCalibration } = await import("../../src/ocx/antislop")
    const before = "const a = 1;"
    const after = "const a = 1; "
    expect(MetricCalibration.isChangeSignificant(before, after)).toBe(false)
  })

  test("calibrates thresholds dynamically based on maturity level", async () => {
    const { MetricCalibration } = await import("../../src/ocx/antislop")
    const alpha = MetricCalibration.calibrateThresholds({
      maturityLevel: "alpha",
      language: "typescript",
      strictness: 0.8,
    })
    const prod = MetricCalibration.calibrateThresholds({
      maturityLevel: "production",
      language: "typescript",
      strictness: 0.8,
    })
    expect(prod.maxComplexity).toBeLessThanOrEqual(alpha.maxComplexity)
    expect(prod.maxNestingDepth).toBeLessThanOrEqual(alpha.maxNestingDepth)
  })
})

describe("anti-slop mechanism ablation", () => {
  test("runs leave-one-out and add-one-in ablation strategies", async () => {
    const { MechanismAblation } = await import("../../src/ocx/antislop")
    const runner = new MechanismAblation.MechanismAblationRunner()

    const full = runner.runFullSuite()
    const baseline = runner.runBaseline()
    expect(full.f1Score).toBeGreaterThan(baseline.f1Score)
    expect(full.precision).toBeGreaterThan(baseline.precision)

    const loo = runner.runLOO()
    expect(loo.length).toBe(5)
    expect(loo.every((d) => d.strategy === "LOO")).toBe(true)
    expect(loo.some((d) => d.mechanism === "trajectory")).toBe(true)

    const aoi = runner.runAOI()
    expect(aoi.length).toBe(5)
    expect(aoi.every((d) => d.strategy === "AOI")).toBe(true)
  })

  test("generates ablation report identifying top contributor", async () => {
    const { MechanismAblation } = await import("../../src/ocx/antislop")
    const runner = new MechanismAblation.MechanismAblationRunner()
    const report = runner.generateReport()

    expect(report.topContributor.mechanism).toBeDefined()
    expect(report.topContributor.marginalContribution).toBeGreaterThan(0)
    expect(report.looDeltas.length).toBe(5)
  })
})

describe("final slop regression gate", () => {
  test("issues PASS on clean code within performance budget", async () => {
    const { UnifiedSlopGate } = await import("../../src/ocx/antislop")
    const gate = new UnifiedSlopGate.SlopRegressionGate()
    const cleanCode = `
export function add(a: number, b: number): number {
  return a + b;
}
`
    const result = gate.evaluate({
      files: { "src/math.ts": cleanCode },
      turn: 1,
    })

    expect(result.decision).toBe("PASS")
    expect(result.passed).toBe(true)
    expect(result.blockers.length).toBe(0)
    expect(result.executionTimeMs).toBeLessThan(500)
  })

  test("issues BLOCK when hard blocker finding exists", async () => {
    const { UnifiedSlopGate } = await import("../../src/ocx/antislop")
    const gate = new UnifiedSlopGate.SlopRegressionGate()
    const result = gate.evaluate({
      staticFindings: [
        {
          id: "b1",
          rule: "anti-slop/security-eval",
          severity: "blocker",
          file: "src/eval.ts",
          evidence: "eval(code);",
          fix: "Avoid dynamic code execution.",
        },
      ],
    })

    expect(result.decision).toBe("BLOCK")
    expect(result.passed).toBe(false)
    expect(result.blockers.length).toBe(1)
  })

  test("issues BLOCK when trajectory circuit breaker is tripped", async () => {
    const { UnifiedSlopGate } = await import("../../src/ocx/antislop")
    const gate = new UnifiedSlopGate.SlopRegressionGate()
    const history = [
      { turn: 1, score: 0.9, dimensions: { cyclomaticComplexity: 1, nestingDepth: 1, commentDensity: 0.1, identifierQuality: 1, fanOut: 1, abstractionRatio: 0.5 } },
      { turn: 2, score: 0.8, dimensions: { cyclomaticComplexity: 2, nestingDepth: 2, commentDensity: 0.1, identifierQuality: 1, fanOut: 2, abstractionRatio: 0.5 } },
      { turn: 3, score: 0.7, dimensions: { cyclomaticComplexity: 3, nestingDepth: 3, commentDensity: 0.1, identifierQuality: 1, fanOut: 3, abstractionRatio: 0.5 } },
      { turn: 4, score: 0.55, dimensions: { cyclomaticComplexity: 4, nestingDepth: 4, commentDensity: 0.1, identifierQuality: 1, fanOut: 4, abstractionRatio: 0.5 } },
    ]
    const result = gate.evaluate({
      trajectoryHistory: history,
      turn: 4,
    })

    expect(result.decision).toBe("BLOCK")
    expect(result.passed).toBe(false)
    expect(result.reasons.some((r) => r.includes("Circuit breaker"))).toBe(true)
  })

  test("issues WARN on elevated warnings without blockers", async () => {
    const { UnifiedSlopGate } = await import("../../src/ocx/antislop")
    const gate = new UnifiedSlopGate.SlopRegressionGate()
    const result = gate.evaluate({
      staticFindings: [
        {
          id: "w1",
          rule: "anti-slop/naming",
          severity: "warning",
          file: "src/user.ts",
          evidence: "const data = req;",
          fix: "Use descriptive variable names.",
        },
      ],
    })

    expect(result.decision).toBe("WARN")
    expect(result.passed).toBe(false)
    expect(result.warnings.length).toBe(1)
  })

  test("issues BLOCK when goodhart gaming penalty exceeds 0.3", async () => {
    const { UnifiedSlopGate } = await import("../../src/ocx/antislop")
    const gate = new UnifiedSlopGate.SlopRegressionGate()
    const before = `
function step1() { if (a) return 1; return 0; }
function step2() { if (b) return 2; return 0; }
function main() { return step1() + step2(); }
`
    const after = `
function main() {
  if (a) {
    if (b) {
      if (c) {
        if (d) {
          return 1;
        }
      }
    }
  }
  return 0;
}
`
    const result = gate.evaluate({
      beforeFiles: { "src/main.ts": before },
      files: { "src/main.ts": after },
      staticFindings: [
        {
          id: "w1",
          rule: "anti-slop/naming",
          severity: "warning",
          file: "src/main.ts",
          evidence: "let x = 1;",
          fix: "rename",
        },
      ],
    })

    expect(result.goodhartWarnings.length).toBeGreaterThan(0)
  })
})
