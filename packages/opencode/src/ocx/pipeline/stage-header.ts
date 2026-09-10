import { Strategy } from "@/ocx/strategy"
import { Workflow } from "@/ocx/workflow"
import { OCXPipeline } from "@/ocx/ocx-pipeline"
import { Effect } from "effect"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import { Knowledge } from "@/ocx/knowledge"
import { OwnerRegistry } from "@/ocx/owner/registry"
import { Requirements } from "@/ocx/requirements"
import { TaskGraph } from "@/ocx/task-graph"
import { PlaybookQueue } from "@/ocx/playbook/queue"
import { PlaybookCatalog } from "@/ocx/playbook/catalog"
import { Header, type Header as SessionHeader } from "@/ocx/header"
import type { TurnServices } from "@/ocx/turn/types"
import * as State from "@/ocx/turn/state"

type WithParts = SessionV1.WithParts

export function processHeaderOnce(
  services: TurnServices,
  messages: ReadonlyArray<WithParts>,
  key: string,
): Effect.Effect<void> {
  const op = Effect.gen(function* () {
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
        const storedRecord = services.store.get(services.sessionID)
        services.store.set(services.sessionID, {
          ...storedRecord,
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
        const rendered = [TaskGraph.render(graph), Requirements.renderLedger(ledger)]
          .filter((item) => item.length > 0)
          .join("\n\n")
        return rendered
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
  return op
}

export * as StageHeader from "./stage-header"
