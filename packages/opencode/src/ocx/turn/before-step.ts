import { Strategy } from "@/ocx/strategy"
import { Workflow } from "@/ocx/workflow"
import { OCXPipeline } from "@/ocx/ocx-pipeline"
import { Effect } from "effect"
import path from "node:path"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import { Greenfield } from "@/ocx/greenfield"
import { Knowledge } from "@/ocx/knowledge"
import { FailureSignal } from "@/ocx/reasoning/failure-signal"
import { ReasoningControl, ReasoningPrompt } from "@/ocx/reasoning"
import { Ledger } from "@/ocx/ledger"
import { PracticePacks } from "@/ocx/practice-packs"
import { Progress } from "@/ocx/progress"
import { Requirements } from "@/ocx/requirements"
import { TaskGraph } from "@/ocx/task-graph"
import { OwnerRegistry } from "@/ocx/owner/registry"
import { OwnerRouter } from "@/ocx/owner/router"
import { ContextOrchestration } from "@/ocx/context/orchestration"
import { PlaybookQueue } from "@/ocx/playbook/queue"
import { PlaybookCatalog } from "@/ocx/playbook/catalog"
import { PlaybookRunner } from "@/ocx/playbook/runner"
import { WorkstreamRunner } from "@/ocx/workstream-runner"
import { TaskModel } from "@/ocx/task-model"
import { SemanticRuntime } from "@/ocx/semantic-runtime"
import type { TurnServices } from "./types"
import * as State from "./state"
import * as Frame from "./frame"
import { Header, type Header as SessionHeader } from "@/ocx/header"
import { syncPipelineWorkflowFromStore } from "@/ocx/pipeline/stage-pipeline-resolve"
import { stageGuards } from "@/ocx/pipeline/stage-guards"
import { stageBudget } from "@/ocx/pipeline/stage-budget"
import { stageContext } from "@/ocx/pipeline/stage-context"
import { processHeaderOnce as stageProcessHeaderOnce } from "@/ocx/pipeline/stage-header"

type WithParts = SessionV1.WithParts

function processHeaderOnce(
  services: TurnServices,
  messages: ReadonlyArray<WithParts>,
  key: string,
): Effect.Effect<void> {
  return stageProcessHeaderOnce(services, messages, key)
}

function _legacyProcessHeaderOnce(
  services: TurnServices,
  messages: ReadonlyArray<WithParts>,
  key: string,
): Effect.Effect<void> {
  return Effect.gen(function* () {
    let header = State.headerOf(key)
    if (!header) {
      for (const m of messages) {
        const parts = (m as any).parts ?? []
        for (const p of parts) {
          if ((p.type === "tool" || p.type === "tool-call") && (p.tool === "ocx_header" || p.toolName === "ocx_header")) {
            const wrapper = p.input?.wrapper ?? p.args?.wrapper
            if (typeof wrapper === "string") {
              const parsed = Header.parseHeaderWrapper(wrapper)
              if (parsed.header) {
                State.setHeader(key, parsed.header)
                header = parsed.header
                break
              }
            }
          }
        }
        if (header) break
      }
    }
    const base = State.pipelineOf(key)
    if (!header && base && messages.some((m) => ((m as any).info?.role ?? (m as any).role) === "assistant" && (m.parts as any[]).some((p) => p.type === "tool" || p.type === "tool-call"))) {
      const prompt = OCXPipeline.promptText(messages) ?? ""
      const topic = base.topic || prompt.split("\n")[0]?.slice(0, 80) || "Task Execution"
      const seeded: SessionHeader = {
        topic,
        strategies: [...base.strategies],
        unknownStrategies: [],
        workflowName: base.workflow.name,
        risks: [],
        intents: [],
        plan: [],
        workstreams: [],
      }
      State.setHeader(key, seeded)
      header = seeded
    }
    if (!header || !base || State.isHeaderDone(key)) return
    State.markHeaderDone(key)

    const isExplicitSwitch = Boolean(header.workflowName && header.workflowName !== base.workflow.name && (header.topic.toLowerCase().includes("switch") || header.intents.includes("workflow_switch" as any)))
    const stored = services.store.get(services.sessionID)
    const storedWorkflow = stored?.workflow
    const requestedWorkflow = header.workflowName && storedWorkflow && header.workflowName !== storedWorkflow ? header.workflowName : undefined
    if (requestedWorkflow && !isExplicitSwitch) {
      services.store.setWorkflowProposal(services.sessionID, {
        workflow: requestedWorkflow,
        objective: header.topic,
        reason: header.workflowReason ?? header.topic,
        previousWorkflow: storedWorkflow,
        previousPhase: stored?.phase ?? base.workflow.phase,
      })
      State.setExtras(
        key,
        `=== OCX WORKFLOW PROPOSAL ===\nACTIVE WORKFLOW: ${storedWorkflow}\nPROPOSED WORKFLOW: ${requestedWorkflow}\nWHY: ${header.workflowReason ?? header.topic}\nRESPONSE OPTIONS: APPROVE | DENY\n=== END OCX WORKFLOW PROPOSAL ===`,
      )
    }
    if (!storedWorkflow && header.workflowName) {
      services.store.clearWorkflowProposal(services.sessionID)
    }
    const targetWorkflow = isExplicitSwitch || !storedWorkflow
      ? header.workflowName ?? base.workflow.name
      : base.workflow.name
    const definition = Workflow.get(targetWorkflow) ?? Workflow.fromPhases(targetWorkflow, base.workflow.phases)
    const phases = (targetWorkflow === stored?.workflow && stored?.phases && stored.phases.length > 0) ? stored.phases : definition.phases
    const phase = requestedWorkflow && !isExplicitSwitch && stored?.phase
      ? stored.phase
      : header.phase && phases.some((item) => item.id === header.phase)
        ? header.phase
        : targetWorkflow !== base.workflow.name
          ? Workflow.selectPhase({ workflow: definition, requested: header.phase, previousWorkflow: base.workflow.name, previousPhase: base.workflow.phase })
          : phases.some((item) => item.id === base.workflow.phase)
            ? base.workflow.phase
            : Workflow.selectPhase({ workflow: definition, requested: base.workflow.phase })
    if (phases.length > 0 && !phases.some((item) => item.id === phase) && phase !== "understand")
      throw new Error(`workflow/phase invariant: phase "${phase}" missing from ${targetWorkflow}`)
    const workstream = header.workstreams.length > 0 ? header.workstreams : base.workflow.workstream
    const updated = {
      ...base,
      strategies: [
        ...new Set([
          ...header.strategies.filter((name) => name !== "write" || ["coding", "debugging", "design"].includes(targetWorkflow)),
          ...base.strategies.filter(
            (name) =>
              Strategy.stackStrategies(base.stack).includes(name) ||
              Strategy.workflowStrategies(targetWorkflow).includes(name),
          ),
        ]),
      ],
      workflow: {
        ...base.workflow,
        name: targetWorkflow,
        ...(base.workflow.variant ? { variant: base.workflow.variant } : {}),
        phase,
        phases,
        reminder: undefined,
        ...(workstream ? { workstream } : {}),
      },
    }
    State.setPipeline(key, updated)

    yield* Effect.try({
      try: () => {
        const stored = services.store.get(services.sessionID)
        services.store.set(services.sessionID, {
          ...stored,
          workflow: updated.workflow.name,
           phase: updated.workflow.phase,
           phases: updated.workflow.phases,
           ...(updated.workflow.variant ? { variant: updated.workflow.variant } : {}),
           ...(updated.workflow.objective ? { objective: updated.workflow.objective } : {}),
           ...(updated.workflow.status ? { status: updated.workflow.status } : {}),
           ...(updated.workflow.revision !== undefined ? { revision: updated.workflow.revision } : {}),
          ...(updated.workflow.workstream ? { workstream: updated.workflow.workstream } : {}),
          ...(updated.stack ? { stack: updated.stack } : {}),
          ...(updated.requirements ? { requirements: updated.requirements } : {}),
        })
      },
      catch: (error) => error,
    }).pipe(Effect.ignore)

    yield* services.publishWorkflow({
      workflow: updated.workflow.name,
      phase: updated.workflow.phase,
      phases: updated.workflow.phases,
      ...(updated.workflow.variant ? { variant: updated.workflow.variant } : {}),
      ...(updated.workflow.objective ? { objective: updated.workflow.objective } : {}),
      ...(updated.workflow.status ? { status: updated.workflow.status } : {}),
      ...(updated.workflow.revision !== undefined ? { revision: updated.workflow.revision } : {}),
      ...(updated.workflow.intentRevision !== undefined ? { intentRevision: updated.workflow.intentRevision } : {}),
      ...(updated.workflow.operation ? { operation: updated.workflow.operation } : {}),
    })

    const todos = yield* services
      .todoGet(services.sessionID)
      .pipe(Effect.catch(() => Effect.succeed([] as { status: string; content: string }[])))
    const repositoryContext = yield* Effect.try({
      try: () => {
        const repositoryID = OwnerRegistry.repositoryID(services.cwd)
        const ledger = Requirements.merge(services.store.getRequirementLedger(repositoryID), updated.requirements ?? [])
        services.store.setRequirementLedger(repositoryID, ledger)
        const graph = TaskGraph.sync(services.store.getGraph(repositoryID), {
          repositoryID,
          sessionID: services.sessionID,
          topic: header.topic,
          plan: header.plan,
          workstreams: header.workstreams,
          requirements: ledger,
          todos,
        })
        services.store.setGraph(repositoryID, graph)
        return [TaskGraph.render(graph), Requirements.renderLedger(ledger)]
          .filter((item) => item.length > 0)
          .join("\n\n")
      },
      catch: (error) => error,
    }).pipe(Effect.catch(() => Effect.succeed("")))

    const selections = header.strategies.map((name) => ({
      id: name,
      stage: PlaybookCatalog.defaultStage(name),
    }))
      if (updated.workflow.phase === "plan" && selections.length > 0) {
      const passes = PlaybookQueue.selectPasses({ sessionID: services.sessionID, selections })
      if (!State.isPlaybookSelectionEmitted(key)) {
        const selectedNames = [...new Set(passes.map((p) => p.playbookID))].join(", ")
        if (selectedNames) {
          yield* services.publishActivity("playbook", false, `Selected Playbooks: ${selectedNames}`)
          State.markPlaybookSelectionEmitted(key)
        }
      }
    }

    const queued = PlaybookQueue.listPasses(services.sessionID)
    const playbookSelectionBlock =
      queued.length > 0
        ? [
            "=== OCX PLAYBOOK SELECTION ===",
            `Selected ${queued.length} playbook pass(es) (metadata only, bodies deferred to audit):`,
            ...queued.map((p) => `- ${p.playbookID} / ${p.stage} [${p.status}]`),
            "Each playbook will run as a dedicated pass with only its body injected. Do not load other playbooks until the runner injects them.",
            "=== END OCX PLAYBOOK SELECTION ===",
          ].join("\n")
        : undefined

    const riskBlock = [
      "=== OCX GUARD RISKS ===",
      "You named these risks for this task. Run their checks before you finish:",
      ...header.risks.map((risk: string) => `- ${risk}`),
      "=== END OCX GUARD RISKS ===",
    ].join("\n")
    const topicContext = Knowledge.topicContext(header.topic, OCXPipeline.promptText(messages) ?? "")
    const extras = [
      header.risks.length > 0 ? riskBlock : undefined,
      playbookSelectionBlock,
      header.intents.length > 0 ? `Declared intents for this turn: ${header.intents.join(", ")}.` : undefined,
      topicContext.length > 0 ? topicContext.join("\n") : undefined,
      repositoryContext || undefined,
      header.unknownStrategies.length > 0
        ? `Unknown playbook names ignored: ${header.unknownStrategies.join(", ")}`
        : undefined,
    ].filter(Boolean)
    const existingExtras = State.takeExtras(key)
    if (existingExtras) extras.unshift(existingExtras)
    if (extras.length > 0) State.setExtras(key, extras.join("\n\n"))
  })
}

export function run(
  services: TurnServices,
  messages: ReadonlyArray<WithParts>,
  userId: string,
): Effect.Effect<{ deltas: string[]; feedback?: string }> {
  return SemanticRuntime.withProviderModel(services.model, Effect.gen(function* () {
    if (Frame.isDone(services)) return { deltas: [] }
    const key = State.turnKey(services.sessionID, userId)
    yield* processHeaderOnce(services, messages, key)
    syncPipelineWorkflowFromStore(services, key)
    yield* Frame.syncPlanTodos(services, key, State.headerOf(key), messages)

    const deltas: string[] = []
    const budget = stageBudget(services, messages, key)
    deltas.push(...budget.deltas)
    const planInput = { store: services.store, sessionID: services.sessionID }
    const executionPlan = WorkstreamRunner.getPlan(planInput)
    yield* ensurePlaybooks(services, messages, key, executionPlan)

    if (executionPlan && WorkstreamRunner.isComplete(planInput)) {
      const stored = services.store.get(services.sessionID)
      if (stored && stored.workflow && stored.phase) {
        const stageKind = TaskModel.stageKind(stored.phase)
        if (stageKind === "act" || stageKind === "understand" || stageKind === "plan") {
          const phases = stored.phases ?? Workflow.get(stored.workflow)?.phases ?? []
          const auditPhase = phases.find((p) => p.id === "audit" || p.id === "validate" || p.id === "review")?.id ?? "audit"
          if (auditPhase !== stored.phase) {
            services.store.set(services.sessionID, {
              ...stored,
              phase: auditPhase,
              revision: (stored.revision ?? 0) + 1,
            })
            yield* services.publishWorkflow({
              workflow: stored.workflow,
              phase: auditPhase,
              phases,
            }).pipe(Effect.ignore)
          }
        }
      }
    }

    syncPipelineWorkflowFromStore(services, key)

    const failure = FailureSignal.inspect(messages)
    const hasFailure = failure.hasFailure
    const executionStage = PlaybookRunner.reconcileStage({
      store: services.store,
      sessionID: services.sessionID,
      hasFailure,
      implementationSettled: WorkstreamRunner.isComplete(planInput),
    })

    // Pre/post/verification playbooks are real barriers. Do not activate or expose
    // implementation steps while a playbook stage owns the continuation.
    if (executionPlan && executionStage === "implementation" && !WorkstreamRunner.hasActiveStep(planInput)) {
      const ready = WorkstreamRunner.nextReadyStep(planInput)
      if (ready) WorkstreamRunner.activateStep(planInput, ready.workstreamID, ready.stepID)
    }
    if (executionPlan) yield* Frame.syncPlanTodos(services, key, State.headerOf(key), messages)
    if (executionStage === "implementation") {
      const executionPacket = WorkstreamRunner.renderExecutionPacket(planInput)
      if (executionPacket) deltas.push(executionPacket)
    }
    const active = WorkstreamRunner.activeStep(planInput)
    if (services.contextEnabled !== false && services.contextAgentRetrieval === true && !State.isContextInjected(key)) {
      const context = yield* Effect.try({
        try: () =>
          ContextOrchestration.renderPacket({
            workdir: services.cwd,
            prompt: OCXPipeline.promptText(messages) ?? "",
            files: active?.step.targets,
            checkFreshness: services.contextFreshnessChecks === true,
          }),
        catch: (error) => error,
      }).pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (context) deltas.push(context)
      State.markContextInjected(key)
    }
    if (!State.isProgressInjected(key)) {
      deltas.push(yield* Progress.resumeDirective(services.sessionID))
      State.markProgressInjected(key)
    }
    const extras = State.takeExtras(key)
    if (extras) deltas.push(extras)

    const userPromptText = OCXPipeline.promptText(messages) ?? ""
    const activeTargets = active?.step.targets ?? []
    const domainOwners = OwnerRouter.domains({ prompt: userPromptText, paths: activeTargets })
    if (domainOwners.length > 0 && !State.isOwnerGuidanceInjected(key)) {
      const store = yield* OwnerRegistry.open(services.cwd, services.sessionID).pipe(
        Effect.catch(() => Effect.succeed(undefined)),
      )
      const repositoryID = OwnerRegistry.repositoryID(services.cwd)
      const existingOwners = store?.list(repositoryID) ?? []
      const ownerLines = domainOwners.map((d) => {
        const existing = existingOwners.find(
          (o) => o.topic.toLowerCase() === d.topic.toLowerCase() || o.name.toLowerCase() === d.name.toLowerCase(),
        )
        const status = existing?.status ?? "available"
        return `- ${d.name} (${d.topic}) [status: ${status}]: offload complex ${d.topic} tasks using task tool with subagent_type="${d.topic}" or "general"`
      })
      deltas.push(
        [
          "=== OCX CODEBASE DOMAIN OWNERS ===",
          "Relevant codebase domain owners identified for this task scope:",
          ...ownerLines,
          "Task Consolidation & Delegation Rules:",
          "- Group related domain work into a single comprehensive delegation per owner to avoid lock contention (OwnerBusyError).",
          "- Owner agents run with the primary model and can spawn child agents (e.g. explore, general) autonomously.",
          "- Use the task tool with subagent_type set to the owner name/topic (or 'general') to delegate subsystem work.",
          "=== END OCX CODEBASE DOMAIN OWNERS ===",
        ].join("\n"),
      )
      State.markOwnerGuidanceInjected(key)
    }

    const todos = yield* services.todoGet(services.sessionID).pipe(Effect.catch(() => Effect.succeed([])))
    const openTodos = todos.filter((item) => item.status === "pending" || item.status === "in_progress")
    if (!executionPlan && State.shouldInjectTodoState(key, JSON.stringify(todos)) && todos.length > 0) {
      const rows = todos.map((item) => {
        const mark = item.status === "completed" ? "x" : item.status === "in_progress" ? "~" : " "
        return `[${mark}] ${item.content}`
      })
      deltas.push(
        [
          "=== OCX TODO STATE ===",
          ...rows,
          "Keep this list true: mark items completed the moment their work lands, add items for discovered work, cancel stale ones with todowrite.",
          "Never end the turn with items still open that this turn already finished.",
          ...(openTodos.length > 0
            ? [
                "",
                `MANDATORY: The session has ${openTodos.length} open todo item(s). Update status using todowrite before completing.`,
                "Do NOT attempt to finish (STATE: done) while any todo item remains pending or in_progress.",
              ]
            : []),
          "=== END OCX TODO STATE ===",
        ].join("\n"),
      )
    }
    if (!executionPlan && (todos.length === 0 || openTodos.length === 0)) {
      State.markTodoStateInjected(key)
    }

    const pipeline = State.pipelineOf(key)
    const storedWorkflow = services.store.get(services.sessionID)
    const phaseContext =
      storedWorkflow?.workflow && storedWorkflow.phase
        ? {
            workflow: storedWorkflow.workflow,
            phase: storedWorkflow.phase,
            phases: storedWorkflow.phases ?? [],
            epoch: `phase-card:${storedWorkflow.workflow}:${storedWorkflow.phase}`,
            toolsetVersion: 1,
          }
        : pipeline
          ? {
              workflow: pipeline.workflow.name,
              phase: pipeline.workflow.phase,
              phases: pipeline.workflow.phases,
              epoch: `phase-card:${pipeline.workflow.name}:${pipeline.workflow.phase}`,
              toolsetVersion: 1,
            }
          : undefined
    const planRecorded = Boolean(storedWorkflow?.plan)
    const workflowPhase = phaseContext?.phase ?? State.pipelineOf(key)?.workflow.phase
    const planStepCount = executionPlan?.workstreams.reduce((count, workstream) => count + workstream.steps.length, 0) ?? 0
    const workflowName = phaseContext?.workflow ?? pipeline?.workflow.name
    const reasoningProfile = ReasoningControl.profileFor({
      workflow: workflowName,
      workflowPhase,
      hasFailure,
      complexity: executionPlan && (executionPlan.workstreams.length > 1 || planStepCount >= 4) ? "high" : "low",
    })
    const reasoningSignature = `${workflowName ?? "general"}:${workflowPhase ?? "work"}:${reasoningProfile}:${failure.code ?? "ok"}`
    if (State.reasoningSignatureOf(key) !== reasoningSignature) {
      const failureEvidence = FailureSignal.render(failure)
      if (failureEvidence) deltas.push(failureEvidence)
      if (ReasoningPrompt.shouldInject({ profile: reasoningProfile, ocxPipeline: true })) {
        deltas.push(
          ReasoningPrompt.reasoningBlock({
            workflow: workflowName,
            profile: reasoningProfile,
            hasFailure,
            workflowPhase,
            failureSummary: failure.summary,
          }).content,
        )
      }
      State.setReasoningSignature(key, reasoningSignature)
    }

    // Re-emit the operating envelope when the workflow, plan admission, or
    // active work item changes. Structure is optional and is not part of the
    // mutation-admission state.
    const envelopeKey = phaseContext
      ? [
          phaseContext.workflow,
          phaseContext.phase,
          planRecorded ? "plan" : "no-plan",
          active ? `${active.workstreamID}/${active.stepID}` : "no-step",
        ].join(":")
      : undefined
    if (phaseContext && envelopeKey && State.saliencePhaseOf(key) !== envelopeKey) {
      State.setSaliencePhase(key, envelopeKey)
    }

    if (services.ocxPractices && !State.isPracticeInjected(key)) {
      const entries = Ledger.ledger(messages)
      const signals = PracticePacks.signalsFromEntries(entries)
      const selected = PracticePacks.select({
        prompt: OCXPipeline.promptText(messages) ?? "",
        workflow: State.pipelineOf(key)?.workflow.name,
        stack: State.pipelineOf(key)?.stack,
        ...signals,
      })
      State.setPracticeHits(
        key,
        selected.packs.map((pack) => pack.name),
      )
      const rendered = PracticePacks.renderSelected(selected.packs)
      if (rendered) deltas.push(rendered)
      if (selected.invalid.length > 0)
        deltas.push(
          [
            "=== OCX PRACTICE PACK AUDIT ===",
            "Invalid practice packs were excluded:",
            ...selected.invalid.slice(0, 3).map((item) => `- ${item.path}: ${item.reason}`),
            "Fix or remove the invalid pack before relying on it.",
            "=== END OCX PRACTICE PACK AUDIT ===",
          ].join("\n"),
        )
      State.markPracticeInjected(key)
    }

    const guards = yield* stageGuards(services, messages, pipeline?.workflow.name)
    deltas.push(...guards.deltas)

    const context = stageContext(services, messages, workflowName ?? "", workflowPhase ?? "")
    deltas.push(...context.deltas)

    if (services.cwd && !State.isGreenfieldInjected(key)) {
      State.markGreenfieldInjected(key)
      const detection = yield* Effect.promise(() =>
        Greenfield.detectGreenfield(services.cwd).catch(() => undefined),
      )
      if (detection?.isGreenfield) {
        const promptText = OCXPipeline.promptText(messages) ?? ""
        const preset = Greenfield.inferProjectPreset(promptText)
        const plan = Greenfield.createScaffoldPlan(path.basename(services.cwd), preset)
        const lines = [
          "=== OCX GREENFIELD CONSTRUCTION PRESET ===",
          `Detected greenfield workspace. Preset: ${preset}`,
          "Sequence: config/build -> entrypoint -> test -> verify",
          ...plan.steps.map((s) => `- [${s.phase}] ${s.target}: ${s.description}`),
          "=== END OCX GREENFIELD CONSTRUCTION PRESET ===",
        ]
        deltas.push(lines.join("\n"))
      }
    }

    const inAuditPhase = workflowPhase === "audit"

    if (inAuditPhase) {
      yield* services.publishActivity("audit" as never, true, "Entering audit phase — inspecting diff and quality gates")
      PlaybookQueue.markReadyForAudit(services.sessionID)
      const active = PlaybookQueue.activePass(services.sessionID)
      if (active && !active.bodyInjected) {
        const label = `Audit Pass ${active.order + 1}/${PlaybookQueue.listPasses(services.sessionID).length} · ${active.playbookID}`
        yield* services.publishActivity("playbook", true, label)
      } else if (!active) {
        const prepared = PlaybookRunner.prepareNextPass({ sessionID: services.sessionID, mode: "audit" })
        if (prepared) {
          deltas.push(prepared.directive)
          const label = `Audit Pass ${prepared.ctx.order}/${prepared.ctx.total} · ${prepared.ctx.displayName}`
          yield* services.publishActivity("playbook", true, label)
        }
      }
    }

    const feedback = State.takeFeedback(key)
    if (inAuditPhase) yield* services.publishActivity("audit" as never, false)
    return { deltas, feedback }
  }))
}

function ensurePlaybooks(
  services: TurnServices,
  messages: ReadonlyArray<WithParts>,
  key: string,
  plan?: ReturnType<typeof WorkstreamRunner.getPlan>,
): Effect.Effect<void> {
  return Effect.gen(function* () {
    if (PlaybookQueue.listPasses(services.sessionID).length > 0) return
    const header = State.headerOf(key)
    const pipeline = State.pipelineOf(key)
    if (pipeline?.workflow.phase !== "plan") return
    const workflow = pipeline?.workflow.name
    const prompt = OCXPipeline.promptText(messages) ?? ""
    const coding = TaskModel.taskKind(workflow) === "coding"
    const modelSelections = (header?.strategies ?? pipeline?.strategies ?? []).map((id) => ({
      id,
      stage: PlaybookCatalog.defaultStage(id),
      selectedBy: "model" as const,
    }))
    const runtimeSelections = PlaybookCatalog.requiredBaselines({
      prompt,
      topic: header?.topic ?? pipeline?.topic,
      strategies: header?.strategies ?? pipeline?.strategies,
      coding,
    }).map((id) => ({ id, stage: PlaybookCatalog.defaultStage(id), selectedBy: "runtime_required" as const }))
    const selections = [...modelSelections, ...runtimeSelections]
    if (selections.length === 0) return
    const passes = PlaybookQueue.selectPasses({
      sessionID: services.sessionID,
      selections,
      selectedRevision: plan ? `plan:${plan.revision}` : "turn:1",
    })
    PlaybookRunner.restoreCompleted({ store: services.store, sessionID: services.sessionID })
    if (!State.isPlaybookSelectionEmitted(key)) {
      const selectedNames = [...new Set(passes.map((p) => p.playbookID))].join(", ")
      if (selectedNames) {
        yield* services.publishActivity("playbook", false, `Selected Playbooks: ${selectedNames}`)
        State.markPlaybookSelectionEmitted(key)
      }
    }
  })
}

export * as BeforeStep from "./before-step"
