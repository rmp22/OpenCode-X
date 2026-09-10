import { Effect } from "effect"
import { randomUUID } from "node:crypto"
import path from "node:path"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import { readFileSync, readdirSync, existsSync } from "node:fs"
import { Ledger } from "@/ocx/ledger"
import { Diff } from "@/ocx/diff"
import { VerifyLadder } from "@/ocx/verify-ladder"
import { ExitGate, hitLengthCap, wholeFileBlockers, type Finding } from "@/ocx/exit-gate"
import { Verifier } from "@/ocx/verifier"
import { Calibration } from "@/ocx/calibration"
import { Global } from "@opencode-ai/core/global"
import type { TurnServices } from "./types"
import { SessionDone } from "@/ocx/session-done"
import { ActivityRuntime } from "@/ocx/activity/runtime"
import { WorkstreamRunner } from "@/ocx/workstream-runner"
import { TaskModel } from "@/ocx/task-model"
import { Reflexion } from "@/ocx/cognitive/reflexion"
import * as State from "./state"
import * as Frame from "./frame"
import { Escalation } from "./escalation"
import { Reviewer } from "@/ocx/reviewer"
import { PracticePacks } from "@/ocx/practice-packs"
import { PatchSelection } from "@/ocx/patch-selection"
import { Outcome } from "@/ocx/outcome"
import { AntiSlopRuntime } from "@/ocx/antislop/runtime"
import { ProjectVocabularyIndex } from "@/ocx/antislop/vocabulary"
import { ArtifactVerifier } from "@/ocx/artifact-verifier"
import { SemanticRuntime } from "@/ocx/semantic-runtime"
import { buildTaskContext, reviewOutputQualitySemantic } from "@/ocx/llm"
import { OperationClassifier } from "@/ocx/operation-classifier"
import { ValidationRouter } from "@/ocx/validation-router"
import { DocumentationValidator } from "@/ocx/documentation-validator"
import { PlaybookQueue } from "@/ocx/playbook/queue"
import { TodoSync } from "@/ocx/todo/sync"
import type { OCXDb } from "@/ocx/ocx-db"

type WithParts = SessionV1.WithParts

function siblingExports(filePath: string): string | undefined {
  const dir = filePath.replace(/\/[^/]*$/, "")
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return undefined
  }
  const lines: string[] = []
  let scanned = 0
  for (const name of entries) {
    if (name === filePath.split("/").pop() || !/\.(ts|tsx|js|jsx|mjs|py|kt|java)$/.test(name)) continue
    if (scanned >= 6) break
    const content = readFileSafe(`${dir}/${name}`)
    if (!content) continue
    scanned++
    for (const line of content.split("\n")) {
      if (/^\s*export\b/.test(line)) lines.push(`${name}: ${line.trim().slice(0, 120)}`)
      if (lines.length >= 30) return ["<repo_exports>\n" + lines.join("\n") + "\n</repo_exports>"].join("")
    }
  }
  return lines.length > 0 ? `<repo_exports>\n${lines.join("\n")}\n</repo_exports>` : undefined
}

const maxRounds = 3
const LEGACY_PROSE_FINDINGS = new Set([
  "E1-banned-word",
  "E2-long-sentence",
  "S-engagement-bait",
  "S-filler-hedge",
  "S-apology-loop",
  "S-emoji-prose",
  "S-bold-overload",
  "P-arrows",
  "P-proofed",
  "P-ocx-jargon",
  "P-emdash-density",
  "P-repeat-opener",
  "HYPE_WORD",
  "PROSE_TELL",
  "SELF_CHEER",
  "SYCOPHANCY",
])

function lastAssistant(messages: ReadonlyArray<WithParts>) {
  return messages.findLast((message) => message.info.role === "assistant")
}

function replyOf(messages: ReadonlyArray<WithParts>): string {
  const assistant = lastAssistant(messages)
  return (
    assistant?.parts
      .filter((part): part is Extract<SessionV1.Part, { type: "text" }> => part.type === "text")
      .map((part) => part.text)
      .join("\n") ?? ""
  )
}

function userPrompt(messages: ReadonlyArray<WithParts>): string {
  const user = messages.findLast((message) => message.info.role === "user")
  return (
    user?.parts
      .filter((part): part is Extract<SessionV1.Part, { type: "text" }> => part.type === "text")
      .map((part) => part.text)
      .join("\n") ?? ""
  )
}

function readFileSafe(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8")
  } catch {
    return undefined
  }
}

function updateAssistantReply(
  services: Pick<TurnServices, "updatePart">,
  messages: ReadonlyArray<WithParts>,
  reply: string,
): Effect.Effect<void> {
  return Effect.gen(function* () {
    const assistant = lastAssistant(messages)
    if (!assistant) return
    let firstText = true
    for (const part of assistant.parts) {
      if (part.type !== "text") continue
      const text = firstText ? reply : ""
      firstText = false
      if (part.text === text) continue
      ;(part as { text: string }).text = text
      yield* services.updatePart(part)
    }
  })
}

function isRequiredComment(span: string | undefined): boolean {
  return /(?:@hide|eslint|oxlint|biome|ts-expect-error|ts-ignore|noqa|type:\s*ignore|deno-lint|copyright|licensed under|spdx-license-identifier|generated-file|do not edit)/i.test(
    span ?? "",
  )
}

function commentsRequested(prompt: string): boolean {
  if (/(?:do not|don't|without|no)\s+(?:add|write|include|explanatory\s+)?comments?\b/i.test(prompt)) return false
  return /\b(?:add|write|include|keep|preserve|document)\b[^\n.]{0,80}\bcomments?\b/i.test(prompt)
}

const TERMINAL_HEADER = /^PHASE:\s+\S+\s+DEPTH:\s+(?:concise|standard|comprehensive)\s+STATE:\s+(?:done|blocked|needs_input|cancelled)$/i

function terminalReply(
  reply: string,
  state: "done" | "blocked" | "needs_input" | "cancelled",
  phase: string | undefined,
): string {
  const lines = reply.trimStart().split(/\r?\n/)
  const existingDepth = /DEPTH:\s*(concise|standard|comprehensive)/i.exec(lines[0] ?? "")?.[1]?.toLowerCase()
  const depth = existingDepth ?? (state === "needs_input" || state === "blocked" ? "concise" : "comprehensive")
  const body = TERMINAL_HEADER.test(lines[0] ?? "") || /^STATE:\s*\w+$/i.test(lines[0] ?? "") ? lines.slice(1).join("\n").trim() : reply.trim()
  const phaseID = phase?.trim().split(/\s+/, 1)[0] || "deliver"
  const resolvedState = state === "blocked" ? "needs_input" : state
  return [`PHASE: ${phaseID} DEPTH: ${depth} STATE: ${resolvedState}`, body].filter(Boolean).join("\n")
}

function recordTrustedPlanEvidence(
  services: TurnServices,
  entries: readonly Ledger.LedgerEntry[],
  source: "tool_output" | "verification",
): void {
  const input = { store: services.store, sessionID: services.sessionID }
  const active = WorkstreamRunner.activeStep(input)?.step
  if (!active) return
  for (const check of active.checks) {
    const kind = Ledger.matchExpect(check.description)
    if (kind) {
      const result = entries.findLast((entry) => entry.kind === "command" && entry.check === kind && entry.outcome === "passed")
      if (result && result.kind === "command") {
        WorkstreamRunner.recordVerifiedEvidence(input, {
          check: check.id,
          status: "passed",
          evidence: `${result.command} exited successfully`,
          source,
        })
      }
      continue
    }
    const mentionsArtifact = /\b(?:exist|created|written|present|built|downloaded|saved|file|directory|folder|images?|css|html|js|assets?)\b/i.test(check.description)
    if (mentionsArtifact && active.targets && active.targets.length > 0) {
      const allExist = active.targets.every((t) => {
        try {
          return existsSync(path.resolve(services.cwd, t))
        } catch {
          return false
        }
      })
      if (allExist) {
        WorkstreamRunner.recordVerifiedEvidence(input, {
          check: check.id,
          status: "passed",
          evidence: `verified targets exist on disk: ${active.targets.join(", ")}`,
          source: "artifact",
        })
      }
    }
  }
  WorkstreamRunner.completeActiveStep(input)
  if (WorkstreamRunner.isComplete(input)) {
    const stored = services.store.get(services.sessionID)
    if (stored?.workflow && stored.phase) {
      const stage = TaskModel.stageKind(stored.phase)
      if (stage === "act") {
        const nextPhase = "validate"
        services.store.set(services.sessionID, {
          ...stored,
          phase: nextPhase,
          revision: (stored.revision ?? 0) + 1,
        })
      }
    }
  }
}

function recordBrowserPlanEvidence(services: TurnServices, messages: ReadonlyArray<WithParts>): void {
  const hasBrowserEvidence = messages.some((message) =>
    message.parts.some((part) => {
      if (part.type !== "tool" || !/^(?:browser|screenshot|playwright)$/i.test(part.tool)) return false
      if (part.state.status !== "completed") return false
      return (typeof part.state.output === "string" && part.state.output.trim().length > 0) || part.state.metadata !== undefined
    }),
  )
  if (!hasBrowserEvidence) return
  const input = { store: services.store, sessionID: services.sessionID }
  const active = WorkstreamRunner.activeStep(input)?.step
  if (!active) return
  for (const check of active.checks) {
    if (!/\b(?:browser|render|responsive|visual|viewport|layout)\b/i.test(check.description)) continue
    WorkstreamRunner.recordVerifiedEvidence(input, {
      check: check.id,
      status: "passed",
      evidence: "completed browser or screenshot result",
      source: "browser",
    })
  }
  WorkstreamRunner.completeActiveStep(input)
}

function applyValidationTransition(services: TurnServices, passed: boolean, detail: string): void {
  const stored = services.store.get(services.sessionID)
  if (!stored) return
  if (passed) {
    services.store.set(services.sessionID, {
      ...stored,
      phase: "validate",
      status: "active",
      revision: (stored.revision ?? 0) + 1,
    })
  }
}

export function run(
  services: TurnServices,
  messages: ReadonlyArray<WithParts>,
  userId: string,
): Effect.Effect<{ continueTurn: boolean }> {
  return SemanticRuntime.withProviderModel(services.model, Effect.gen(function* () {
    const key = State.turnKey(services.sessionID, userId)
    const pipeline = State.pipelineOf(key)
    const header = State.headerOf(key)
    const round = State.roundOf(key)
    let reply = replyOf(messages)
    const disposition = SessionDone.disposition(reply)
    let terminal = disposition === "done"
    const planComplete = services.store.get(services.sessionID)?.plan
      ? WorkstreamRunner.isComplete({ store: services.store, sessionID: services.sessionID })
      : false
    if (planComplete && !terminal) {
      terminal = true
    }
    if (disposition === "needs_input" || disposition === "blocked" || disposition === "cancelled") {
      yield* reconcileTerminalTodos(services, disposition)
      const normalized = terminalReply(reply, disposition, pipeline?.workflow.phase ?? services.store.get(services.sessionID)?.phase)
      if (normalized !== reply) {
        yield* updateAssistantReply(services, messages, normalized)
        reply = normalized
      }
      services.store.clear(services.sessionID)
      ActivityRuntime.markTerminal(services.sessionID)
      State.clearSession(services.sessionID)
      return { continueTurn: false }
    }
    const lastUserIndex = messages.findLastIndex((message) => message.info.role === "user")
    const turnMessages = lastUserIndex === -1 ? messages : messages.slice(lastUserIndex)
    const entries = Ledger.ledger(turnMessages)
    const changed = Ledger.changedPaths(entries)
    const requestText = userPrompt(turnMessages)
    const requestOperation = OperationClassifier.classifyRequest(requestText)
    const validationPlan = ValidationRouter.plan({
      workflow: services.store.get(services.sessionID)?.workflow,
      operation: requestOperation,
      changedPaths: changed,
      userIntent: requestText,
    })
    const tier = (pipeline?.workflow.phases.length ?? 0) >= 5 ? "full" : "standard"

    recordTrustedPlanEvidence(services, entries, "tool_output")
    recordBrowserPlanEvidence(services, turnMessages)

    if (!terminal) {
      for (const entry of entries) {
        if (entry.kind === "command" && entry.outcome === "failed") {
          Reflexion.recordFailure({
            sessionID: services.sessionID,
            action: entry.command,
            errorSnippet: entry.command,
          })
        }
      }
    }

    yield* Frame.syncPlanTodos(services, key, header, messages)
    const storedAtCompletion = terminal ? services.store.get(services.sessionID) : undefined
    if (terminal) {
      if (storedAtCompletion?.plan) {
        WorkstreamRunner.completeAll({ store: services.store, sessionID: services.sessionID })
      }
      const existing = yield* services.todoGet(services.sessionID)
      if (existing.some((item) => item.status === "pending" || item.status === "in_progress")) {
        yield* services.todoSet(
          services.sessionID,
          existing.map((item) =>
            item.status === "pending" || item.status === "in_progress"
              ? { ...item, status: "completed" as const }
              : item,
          ),
        )
      }
    }
    const openTodos = (yield* services.todoGet(services.sessionID))
      .filter((item) => item.status === "pending" || item.status === "in_progress")
      .map((item) => item.content)

    let planIncomplete = storedAtCompletion?.plan
      ? !WorkstreamRunner.isComplete({ store: services.store, sessionID: services.sessionID })
      : false
    const completionGateFindings: Finding[] = [
      ...(planIncomplete
        ? [{ id: "C-plan-incomplete", message: "execution plan is incomplete" }]
        : []),
      ...(openTodos.length > 0
        ? [{ id: "C6-open-todos", message: `${openTodos.length} TODO item(s) remain open` }]
        : []),
    ]
    if (terminal && completionGateFindings.length > 0 && round < maxRounds) {
      const workingReply = terminalReply(
        reply,
        "needs_input",
        pipeline?.workflow.phase ?? services.store.get(services.sessionID)?.phase,
      )
      yield* updateAssistantReply(services, messages, workingReply)
      State.setFeedback(
        key,
        `OCX completion gate: ${completionGateFindings.map((item) => item.message).join("; ")}. Finish the remaining work before emitting STATE: done.`,
      )
      State.setRound(key, round + 1)
      return { continueTurn: true }
    }

    const added = yield* Effect.try({
      try: () => Diff.addedLines(changed, services.cwd),
      catch: (error) => error,
    }).pipe(Effect.catch(() => Effect.succeed(new Map<string, string[]>())))
    const wantsComments = commentsRequested(userPrompt(turnMessages))
    const repositoryVocabulary = ProjectVocabularyIndex.build({
      files: changed.flatMap((path) => {
        const content = siblingExports(path)
        return content ? [{ path: `${path}.context`, content }] : []
      }),
    })
    const antiSlopScan = AntiSlopRuntime.scanChangedFiles({
      files: changed.map((path) => {
        const full = readFileSafe(path)
        const addedLines = added.get(path)?.join("\n")
        return { path, content: full ?? addedLines ?? "" }
      }),
      ...(repositoryVocabulary.terms.length > 0 ? { vocabulary: repositoryVocabulary } : {}),
    })
    const antiSlopBlockers: Finding[] = []
    const antiSlopAdvisories: Finding[] = []
    for (const item of antiSlopScan) {
      const finding: Finding = { id: item.id, message: item.message, ...(item.span ? { span: item.span } : {}) }
      const isBlocker = item.severity === "block"
      if (isBlocker || (terminal && tier === "full")) {
        antiSlopBlockers.push(finding)
      } else {
        antiSlopAdvisories.push(finding)
      }
    }
    const codeChanged = changed.length > 0 && (validationPlan.surfaces.includes("code") || validationPlan.surfaces.includes("test"))
    let ladderResults: VerifyLadder.CheckResult[] = []
    let ladderWallMs = 0
    const verify = services.verify
    if (codeChanged && services.ocxVerifyLadder && verify) {
      const ran = yield* verify({ changed, cwd: services.cwd }).pipe(
        Effect.catch(() => Effect.succeed({ results: [] as VerifyLadder.CheckResult[], wallMs: 0 })),
      )
      ladderResults = [...ran.results]
      ladderWallMs = ran.wallMs
      if (ladderResults.length > 0) {
        yield* services.publishActivity("guard", true)
        yield* services.publishActivity("guard", false)
      }
      entries.push(...VerifyLadder.synthEntries(ladderResults))
      recordTrustedPlanEvidence(services, entries, "verification")
      if (ladderResults.some((result) => result.outcome === "failed"))
        applyValidationTransition(services, false, "validation failed; return to the related action phase")
      yield* Effect.try({
        try: () => {
          for (const result of ladderResults) {
            const record = services.store.recordVerification({
              id: `ocx_verification_${randomUUID().replaceAll("-", "")}`,
              sessionID: services.sessionID,
              repositoryID: services.cwd,
              check: result.kind,
              ...(result.command ? { command: result.command } : {}),
              ...(result.cwd ? { cwd: result.cwd } : {}),
              outcome: result.outcome,
              ...(result.durationMs !== undefined ? { durationMs: result.durationMs } : {}),
              ownerIDs: [],
              createdAt: Date.now(),
            })
            if (record.command) {
              services.store.recordLink({
                id: `ocx_link_${randomUUID().replaceAll("-", "")}`,
                source: "test",
                sourceRef: record.command,
                target: record.id,
                relation: "verifiedBy",
                createdAt: record.createdAt,
              })
            }
          }
        },
        catch: (error) => error,
      }).pipe(Effect.catch(() => Effect.void))
    }
    const manifest = codeChanged ? readFileSafe(`${services.cwd}/package.json`) : undefined
    const priorState = new Map<string, "read" | "mutated">()
    if (lastUserIndex > 0)
      for (const entry of Ledger.ledger(messages.slice(0, lastUserIndex))) {
        if (entry.kind === "read") priorState.set(entry.path, "read")
        else if (entry.kind === "write" || entry.kind === "edit") priorState.set(entry.path, "mutated")
      }
    const priorReadPaths = [...priorState].filter(([, kind]) => kind === "read").map(([path]) => path)
    let design: { direction: string; distinctiveDecisions: string[] } | undefined
    for (const message of messages)
      for (const part of message.parts) {
        if (part.type !== "tool") continue
        const toolPart = part as {
          tool?: string
          state?: { status?: string; metadata?: { direction?: unknown; distinctiveDecisions?: unknown } }
        }
        if (toolPart.tool !== "design" || toolPart.state?.status !== "completed") continue
        const direction = toolPart.state.metadata?.direction
        const decisions = toolPart.state.metadata?.distinctiveDecisions
        if (typeof direction !== "string" || !direction || !Array.isArray(decisions)) continue
        const names = decisions.filter((item): item is string => typeof item === "string" && item.length > 0)
        if (names.length > 0) design = { direction, distinctiveDecisions: names }
      }
    const evaluatedFindings = ExitGate.evaluate({
      reply,
      entries,
      openTodos,
      tier,
      plan: header?.plan,
      executionPlan: services.store.get(services.sessionID)?.plan,
      added,
      sources: Ledger.sourcePaths(entries),
      ...(manifest ? { manifest } : {}),
      ...(priorReadPaths.length ? { priorReadPaths } : {}),
      ...(design ? { design } : {}),
      strictOutput: terminal,
      strictPlanChecks: true,
      userPrompt: requestText,
      validationSurfaces: validationPlan.surfaces,
    })
    const baseFindings: Finding[] = evaluatedFindings.filter(
      (finding) =>
        !LEGACY_PROSE_FINDINGS.has(finding.id) &&
        !(finding.id === "C14-added-comment" && (wantsComments || isRequiredComment(finding.span))),
    )
    planIncomplete = services.store.get(services.sessionID)?.plan
      ? !WorkstreamRunner.isComplete({ store: services.store, sessionID: services.sessionID })
      : false
    completionGateFindings.length = 0
    if (terminal && (planIncomplete || openTodos.length > 0)) {
      if (planIncomplete) completionGateFindings.push({ id: "C-plan-incomplete", message: "execution plan is incomplete" })
      if (openTodos.length > 0)
        completionGateFindings.push({ id: "C6-open-todos", message: `${openTodos.length} TODO item(s) remain open` })
    }
    if (terminal && completionGateFindings.length > 0) baseFindings.push(...completionGateFindings)
    const toolEvidence = turnMessages.flatMap((message) =>
      message.parts.flatMap((part) => {
        if (part.type !== "tool") return []
        if (part.state.status !== "completed") return [{ name: part.tool, completed: false, hasEvidence: false }]
        const hasEvidence = (typeof part.state.output === "string" && part.state.output.trim().length > 0) || part.state.metadata !== undefined
        return [{ name: part.tool, completed: true, hasEvidence }]
      }),
    )
    const artifactFindings = yield* ArtifactVerifier.verifySemantic({
      cwd: services.cwd,
      changed,
      reply,
      userPrompt: userPrompt(turnMessages),
      toolEvidence,
      llm: services.llm,
      model: services.reviewerModel ?? services.model,
      user: services.user,
      sessionID: services.sessionID,
    })
    baseFindings.push(...artifactFindings)
    baseFindings.push(...antiSlopBlockers)
    baseFindings.push(...wholeFileBlockers(changed, readFileSafe))
    baseFindings.push(...DocumentationValidator.validate({ cwd: services.cwd, changed }))
    if (!wantsComments) baseFindings.push(...ExitGate.commentedFiles(changed, readFileSafe))
    const planInput = { store: services.store, sessionID: services.sessionID }
    const plannedPaths = WorkstreamRunner.allowedTargets(planInput)
    if (plannedPaths.length > 0) baseFindings.push(...ExitGate.planConformance(plannedPaths, changed))
    if (codeChanged && services.ocxVerifyLadder && verify && VerifyLadder.ladderUnverifiable(ladderResults))
      baseFindings.push({
        id: "C31-ladder-unverifiable",
        message:
          "the verification ladder produced no runnable check for the changed code; run the smallest relevant typecheck or test command for the touched package and finish only on real output",
      })
    if (hitLengthCap(turnMessages.flatMap((message) => message.parts as readonly { type?: string; reason?: string }[])))
      baseFindings.push({
        id: "C23-length-cap",
        message:
          "previous step hit the token cap mid-delivery; continue now by writing the remaining files with the write/edit tool - never paste the rest as chat",
      })

    if (services.ocxFlakeGate && tier === "full") baseFindings.push(...Ledger.rerunFindings(entries))

    const candidates: Finding[] = []
    const addedLinesTotal = [...added.values()].reduce((total, lines) => total + lines.length, 0)
    const reviewDiffs = [...added.entries()].map(([path, lines]) => ({ path, diff: lines.join("\n") }))
    const semanticAdvisories: Finding[] = []
    const semanticReviewNeeded =
      services.ocxReviewEnvelope && codeChanged && (tier === "full" || addedLinesTotal >= 80 || antiSlopAdvisories.length > 0)
    if (semanticReviewNeeded) {
      const quality = yield* reviewOutputQualitySemantic(
        buildTaskContext({
          request: userPrompt(turnMessages),
          affectedFiles: changed,
          workingDirectory: services.cwd,
          taskSummary: reviewDiffs
            .map((item) => `FILE ${item.path}\n${item.diff}`)
            .join("\n\n")
            .slice(0, 12_000),
          explicitRestrictions: [
            "Judge repository and task fit, not fashionable patterns or generic style preferences.",
            "Only blocker-severity concerns may block completion.",
          ],
        }),
      )
      for (const [index, concern] of quality?.concerns.entries() ?? []) {
        const finding: Finding = {
          id: `SQ-${concern.category}-${index + 1}`,
          message: `${concern.evidence}: ${concern.recommendation}`,
          span: concern.evidence,
        }
        if (concern.severity === "blocker") baseFindings.push(finding)
        else if (concern.severity === "warning") semanticAdvisories.push(finding)
      }
    }
    let reviewerAdvisories: Finding[] = [...semanticAdvisories]
    if (services.ocxReviewEnvelope && Reviewer.shouldReview(changed.length, addedLinesTotal, tier)) {
      const review = yield* Reviewer.review(
        {
          llm: services.llm,
          user: services.user,
          model: services.model,
          sessionID: services.sessionID,
        },
        {
          diffs: reviewDiffs,
          criteria: {
            risks: header?.risks ?? [],
            expectations: header?.plan.map((step) => step.expect) ?? [],
            userPrompt: userPrompt(turnMessages),
          },
          ...(services.reviewerModel ? { strongModel: services.reviewerModel } : {}),
          ladderRed: ladderResults.some((result) => result.outcome === "failed"),
          nearBlocker: Reviewer.isNearBlocker(baseFindings),
        },
      ).pipe(Effect.catch(() => Effect.succeed({ blockers: [], advisories: [] })))
      baseFindings.push(...review.blockers)
      reviewerAdvisories.push(...review.advisories)
    }

    if (baseFindings.length > 0) {
      yield* services.publishActivity("guard", true)
      yield* services.publishActivity("guard", false)
    }

    const promoted = ExitGate.crossDetectorFindings([...candidates, ...reviewerAdvisories], tier)
    const reviewerAdvisorySet = new Set(reviewerAdvisories)
    let promotedAdvisory = promoted.advisory.filter(
      (item) =>
        !reviewerAdvisorySet.has(item) || candidates.some((candidate) => ExitGate.sameSpan(candidate.span, item.span)),
    )
    const styleAdvisories: Finding[] = []
    let advisory = [...styleAdvisories, ...antiSlopAdvisories, ...promotedAdvisory]
    const verifyWorthy = advisory.length > 0 && (changed.length > 0 || reply.length > 600)
    if ((tier === "full" || (tier === "standard" && verifyWorthy)) && promotedAdvisory.length > 0) {
      const files = changed.slice(0, 6).flatMap((path) => {
        const content = readFileSafe(path)
        return content ? [{ path, content: content.slice(0, 8000) }] : []
      })
      const confirmed = yield* Verifier.verify(
        { llm: services.llm, user: services.user, model: services.model, sessionID: services.sessionID },
        { reply, files, candidates: promotedAdvisory },
      ).pipe(Effect.catch(() => Effect.succeed<Finding[]>([])))
      if (confirmed.length > 0) {
        const spans = new Set(confirmed.map((finding) => finding.span))
        promotedAdvisory = promotedAdvisory.filter((item) => !spans.has(item.span))
        advisory = [...styleAdvisories, ...antiSlopAdvisories, ...promotedAdvisory]
        baseFindings.push(...confirmed)
      }
    }
    const findings = [...baseFindings, ...promoted.findings]
    let candidateFeedback: string | undefined
    if (
      services.ocxPatchSelection &&
      round > 0 &&
      !State.isPatchAttempted(key) &&
      changed.length > 0 &&
      ladderResults.some((result) => result.outcome === "failed")
    ) {
      State.markPatchAttempted(key)
      const candidate = yield* PatchSelection.selectCandidate(
        { llm: services.llm },
        {
          cwd: services.cwd,
          changedPaths: changed,
          currentFiles: PatchSelection.readCandidateFiles(services.cwd, changed),
          findings,
          baselineFailed: ladderResults.filter((result) => result.outcome === "failed").length,
          user: services.user,
          model: services.model,
          sessionID: services.sessionID,
        },
      ).pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (candidate) {
        const checks = candidate.results.map((result) => `${result.kind}:${result.outcome}`).join(", ")
        candidateFeedback = `Candidate repair "${candidate.candidate.label}" suggested after isolated checks (${checks}). Review the suggestion and apply via normal edit/write tools if appropriate, then re-read and verify.`
      }
    }

    const practiceAudit = services.ocxPractices ? PracticePacks.audit() : undefined
    const practiceHits = State.practiceHitsOf(key)
    const practiceProposals = practiceAudit
      ? PracticePacks.proposals(
          practiceAudit.packs.filter((pack) => practiceHits.includes(pack.name)),
          findings,
        )
      : []

    yield* Effect.try({
      try: () =>
        Calibration.append(Global.Path.data, {
          time: Date.now(),
          sessionID: services.sessionID,
          tier,
          round: round + 1,
          findings: findings.map((finding) => ({ id: finding.id, span: finding.span })),
          ...(ladderResults.length > 0 || ladderWallMs > 0
            ? {
                ladder: {
                  ms: ladderWallMs,
                  executed: ladderResults.filter((result) => result.outcome !== "skipped").length,
                  failed: ladderResults.filter((result) => result.outcome === "failed").length,
                },
              }
            : {}),
          ...(services.ocxPractices ? { practice: { hits: practiceHits, proposals: practiceProposals } } : {}),
          outcome: Outcome.evaluate({
            entries,
            findings,
            openTodos,
            plan: header?.plan,
            executionPlan: services.store.get(services.sessionID)?.plan,
            declaredDone: terminal,
          }),
        }),
      catch: (error) => error,
    }).pipe(Effect.catch(() => Effect.succeed(undefined)))

    if (candidateFeedback) {
      State.setFeedback(key, candidateFeedback)
      return { continueTurn: true }
    }

    const completionFindings = [...completionGateFindings, ...findings]
    if (terminal && !Frame.isDone(services) && completionFindings.length === 0) {
      const stored = services.store.get(services.sessionID)
      const currentPhase = pipeline?.workflow.phase ?? services.store.get(services.sessionID)?.phase ?? "deliver"
      const finalReply = terminalReply(reply, "done", currentPhase)
      const reconciled = yield* reconcileTerminalTodos(services, "done")
      if (!reconciled) {
        const needsInputReply = terminalReply(
          `${reply}\n\nAttention needed: todo state could not be reconciled.`,
          "needs_input",
          currentPhase,
        )
        yield* updateAssistantReply(services, messages, needsInputReply)
        services.store.clear(services.sessionID)
        ActivityRuntime.markTerminal(services.sessionID)
        State.clearSession(services.sessionID)
        return { continueTurn: false }
      }
      yield* updateAssistantReply(services, messages, finalReply)
      yield* finalizeWorkflow(services, stored)
      ActivityRuntime.markTerminal(services.sessionID)
      State.clearSession(services.sessionID)
      return { continueTurn: false }
    }

    if (findings.length > 0 && round < maxRounds) {
      const signature = findings
        .map((finding) => `${finding.id}:${finding.span ?? ""}`)
        .sort()
        .join("|")
      if (round === 0 || signature !== State.signatureOf(key)) {
        State.setRound(key, round + 1)
        State.setSignature(key, signature)
        const surgical =
          round > 0 ? "\nEdit only the quoted spans and their direct cause. Do not rewrite other content." : ""
        State.setFeedback(key, (ExitGate.directive(findings, advisory) ?? "") + surgical)
        return { continueTurn: true }
      }
    }
    if (terminal && completionFindings.length > 0) {
      yield* reconcileTerminalTodos(services, "needs_input")
      const unresolved = completionFindings
        .slice(0, 6)
        .map((finding) => `- ${finding.id}: ${finding.message}`)
        .join("\n")
      yield* updateAssistantReply(
        services,
        messages,
        terminalReply(
          `OCX requires input to complete: could not validate completion after ${maxRounds} repair rounds.\n${unresolved}`,
          "needs_input",
          pipeline?.workflow.phase ?? services.store.get(services.sessionID)?.phase,
        ),
      )
      services.store.clear(services.sessionID)
      ActivityRuntime.markTerminal(services.sessionID)
      State.clearSession(services.sessionID)
      return { continueTurn: false }
    }

    const escalation = Escalation.message(round, findings)
    if (escalation) State.setFeedback(key, escalation)
    State.clearRound(key)
    yield* updateAssistantReply(services, messages, reply)
    if (terminal) {
      yield* finalizeWorkflow(services, services.store.get(services.sessionID))
      ActivityRuntime.markTerminal(services.sessionID)
    }
    return { continueTurn: false }
  }))
}

function finalizeWorkflow(services: TurnServices, stored: OCXDb.State | undefined): Effect.Effect<void> {
  return Effect.gen(function* () {
    if (stored) {
      const completed = { ...stored, done: true, status: "complete" as const }
      yield* Effect.try({
        try: () => services.store.set(services.sessionID, completed),
        catch: (error) => error,
      }).pipe(Effect.ignore)
      yield* services.publishWorkflow({
        workflow: completed.workflow,
        phase: completed.phase,
        phases: completed.phases,
        ...(completed.variant ? { variant: completed.variant } : {}),
        ...(completed.objective ? { objective: completed.objective } : {}),
        status: "complete",
        ...(completed.revision !== undefined ? { revision: completed.revision } : {}),
        ...(completed.intentRevision !== undefined ? { intentRevision: completed.intentRevision } : {}),
      }).pipe(Effect.ignore)
    }
    services.store.clear(services.sessionID)
  })
}

function reconcileTerminalTodos(services: TurnServices, disposition: SessionDone.Disposition): Effect.Effect<boolean, never, never> {
  if (!disposition || disposition === "working") return Effect.succeed(true)
  const terminalState = disposition === "needs_input" ? "needs_input" : disposition
  return Effect.gen(function* () {
    const existing = yield* services.todoGet(services.sessionID).pipe(
      Effect.match({
        onFailure: () => undefined,
        onSuccess: (value) => value,
      }),
    )
    if (!existing) return false
    const reconciled = TodoSync.reconcileTerminalState(existing, terminalState)
    const updated = yield* services.todoSet(services.sessionID, reconciled).pipe(Effect.match({ onFailure: () => false, onSuccess: () => true }))
    return updated && (terminalState !== "done" || reconciled.length === 0)
  })
}

export interface TextClaimFinding {
  readonly rule: string
  readonly message: string
  readonly evidence: string
  readonly fix: string
  readonly severity: "warning" | "blocker"
}

export function validateTextClaims(replyText: string): readonly TextClaimFinding[] {
  const findings: TextClaimFinding[] = []
  const lines = replyText.split("\n")

  const hasDone = lines.some((l) => /STATE:\s*done\b/i.test(l))
  const unverifiedClaims: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const verifiedMatch = line.match(/VERIFIED:\s*([^\n]+)/)
    if (verifiedMatch) {
      const claimText = verifiedMatch[1].trim()
      const prevLine = lines[i - 1] ?? ""
      const nextLine = lines[i + 1] ?? ""
      const context = prevLine + " " + line + " " + nextLine

      const hasFileLineCitation = /[a-zA-Z0-9_./\\-]+\.[a-zA-Z0-9]+:\d+/.test(context)
      const hasTestExecution = /\b(?:passed|passed in|\d+\s+passed|exit code 0|0 failures|0 fail)\b/i.test(context)
      const hasBuildResult = /\b(?:build succeeded|typecheck passed|compiled successfully|tsc.*passed)\b/i.test(context)

      if (!hasFileLineCitation && !hasTestExecution && !hasBuildResult) {
        const finding: TextClaimFinding = {
          rule: "C-unsubstantiated-verified-claim",
          severity: "warning",
          evidence: "unsubstantiated claim: " + claimText,
          message: "VERIFIED: claim must cite concrete empirical evidence (file:line, test output, or build output)",
          fix: "cite concrete evidence for the claim or downgrade prefix to UNVERIFIED:",
        }
        findings.push(finding)
      }
    }

    const unverifiedMatch = line.match(/UNVERIFIED:\s*([^\n]+)/)
    if (unverifiedMatch) {
      unverifiedClaims.push(unverifiedMatch[1].trim())
    }
  }

  if (hasDone && unverifiedClaims.length > 0) {
    const finding: TextClaimFinding = {
      rule: "C-done-with-unverified-claims",
      severity: "blocker",
      evidence: "STATE: done emitted with " + unverifiedClaims.length + " unverified claims remaining",
      message: "Cannot claim STATE: done while unverified claims remain for primary tasks",
      fix: "verify all remaining claims with concrete evidence before claiming done, or use STATE: needs_input if blocked",
    }
    findings.push(finding)
  }

  return findings
}

export * as Claim from "./claim"
