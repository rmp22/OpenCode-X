export * as OCXDb from "./ocx-db"

import { randomUUID } from "node:crypto"
import { Effect } from "effect"
import { mkdirSync } from "fs"
import { dirname, join } from "path"
import { Global } from "@opencode-ai/core/global"
import { Recovery } from "./recovery"
import { Workflow } from "./workflow"
import type { Phase, Workstream } from "./workflow"
import { Requirements } from "./requirements"
import { TaskGraph } from "./task-graph"
import { Eval } from "./eval"
import { Changeset } from "./changeset"
import { Evidence } from "./evidence"
import { SecretRedaction } from "./secret-redaction"
import { PlanWorkstreamState, type ExecutionPlan } from "./plan-workstream-state"
import type { PlaybookPassRecord, PlaybookStageState } from "./playbook/catalog"
import { WorkGraphReducer } from "./work-graph/reducer"
import type { Event as WorkGraphEvent, Graph as WorkGraph } from "./work-graph/types"

export type State = {
  readonly workflow: string
  readonly phase: string
  readonly phases: readonly Phase[]
  readonly variant?: string
  readonly objective?: string
  readonly status?: Workflow.WorkflowStatus
  readonly revision?: number
  readonly intentRevision?: number
  readonly workstream?: readonly Workstream[]
  readonly stack?: string
  readonly done?: boolean
  readonly requirements?: readonly Requirements.Record[]
  readonly plan?: ExecutionPlan
  readonly playbookStage?: PlaybookStageState
}

export type WorkflowProposal = {
  readonly workflow: string
  readonly variant?: string
  readonly phase?: string
  readonly objective?: string
  readonly reason: string
  readonly previousWorkflow?: string
  readonly previousVariant?: string
  readonly previousPhase?: string
  readonly previousObjective?: string
}

export type OperationRecord = {
  readonly id: string
  readonly sessionID: string
  readonly operation: Recovery.Operation
  readonly status: "failed" | "cancelled"
  readonly category: Recovery.Category
  readonly message: string
  readonly retryable: boolean
  readonly nextAction: string
  readonly timeCreated: number
}

export interface Store {
  readonly get: (sessionID: string) => State | undefined
  readonly set: (sessionID: string, state: State) => void
  readonly clear: (sessionID: string) => void
  readonly getWorkflowProposal: (sessionID: string) => WorkflowProposal | undefined
  readonly setWorkflowProposal: (sessionID: string, proposal: WorkflowProposal) => void
  readonly clearWorkflowProposal: (sessionID: string) => void
  readonly recordOperation: (input: Omit<OperationRecord, "id" | "timeCreated">) => OperationRecord
  readonly operations: (sessionID: string, limit?: number) => OperationRecord[]
  readonly getGraph: (repositoryID: string) => TaskGraph.Graph | undefined
  readonly setGraph: (repositoryID: string, graph: TaskGraph.Graph) => void
  readonly getRequirementLedger: (repositoryID: string) => Requirements.Record[]
  readonly setRequirementLedger: (repositoryID: string, records: readonly Requirements.Record[]) => void
  readonly recordEvaluation: (record: Eval.RunRecord) => Eval.RunRecord
  readonly evaluations: (fixtureID?: string, limit?: number) => Eval.RunRecord[]
  readonly recordChangeset: (record: Changeset.Record) => Changeset.Record
  readonly getChangeset: (id: string) => Changeset.Record | undefined
  readonly changesets: (repositoryID: string) => Changeset.Record[]
  readonly updateChangeset: (id: string, patch: Partial<Pick<Changeset.Record, "status" | "resultingRevision" | "integrationNotes">>) => void
  readonly recordVerification: (record: Evidence.Verification) => Evidence.Verification
  readonly verifications: (sessionID?: string, limit?: number) => Evidence.Verification[]
  readonly recordLink: (record: Evidence.LinkRecord) => Evidence.LinkRecord
  readonly links: (target?: string, limit?: number) => Evidence.LinkRecord[]
  readonly getWorkGraph: (sessionID: string) => WorkGraph | undefined
  readonly workGraphEvents: (sessionID: string, afterSequence?: number) => WorkGraphEvent[]
  readonly saveWorkGraph: (graph: WorkGraph, events: readonly WorkGraphEvent[]) => void
}

type Statement = {
  get: (...params: unknown[]) => unknown
  all: (...params: unknown[]) => unknown[]
  run: (...params: unknown[]) => unknown
}
type Driver = {
  exec: (sql: string) => void
  prepare: (sql: string) => Statement
}

const createTable = `
  CREATE TABLE IF NOT EXISTS session_workflow (
    session_id TEXT PRIMARY KEY,
    workflow TEXT NOT NULL,
    phase TEXT NOT NULL,
    phases TEXT NOT NULL,
    variant TEXT,
    objective TEXT,
    state_status TEXT,
    revision INTEGER NOT NULL DEFAULT 0,
    intent_revision INTEGER NOT NULL DEFAULT 0,
    workstream TEXT NOT NULL DEFAULT '[]',
    stack TEXT,
    requirements TEXT NOT NULL DEFAULT '[]',
    execution_plan TEXT,
    playbook_stage TEXT,
    time_created INTEGER NOT NULL,
    time_updated INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS session_workflow_proposal (
    session_id TEXT PRIMARY KEY,
    workflow TEXT NOT NULL,
    variant TEXT,
    phase TEXT,
    objective TEXT,
    reason TEXT NOT NULL,
    previous_workflow TEXT,
    previous_variant TEXT,
    previous_phase TEXT,
    previous_objective TEXT,
    time_created INTEGER NOT NULL,
    time_updated INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS ocx_work_graphs (
    graph_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL UNIQUE,
    repository_id TEXT,
    revision INTEGER NOT NULL,
    intent_revision INTEGER NOT NULL,
    snapshot_json TEXT NOT NULL,
    time_created INTEGER NOT NULL,
    time_updated INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS ocx_work_graphs_session_idx ON ocx_work_graphs(session_id);
  CREATE TABLE IF NOT EXISTS ocx_work_events (
    event_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    graph_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    graph_revision INTEGER NOT NULL,
    intent_revision INTEGER NOT NULL,
    node_id TEXT,
    node_revision INTEGER,
    causation_id TEXT,
    correlation_id TEXT,
    idempotency_key TEXT,
    payload_json TEXT NOT NULL,
    time_created INTEGER NOT NULL,
    UNIQUE(session_id, seq),
    UNIQUE(session_id, idempotency_key)
  );
  CREATE INDEX IF NOT EXISTS ocx_work_events_session_idx ON ocx_work_events(session_id, seq);
  CREATE TABLE IF NOT EXISTS ocx_operations (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    operation TEXT NOT NULL,
    status TEXT NOT NULL,
    category TEXT NOT NULL,
    message TEXT NOT NULL,
    retryable INTEGER NOT NULL,
    next_action TEXT NOT NULL,
    time_created INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS ocx_operations_session_idx ON ocx_operations(session_id, time_created DESC)
  ;
  CREATE TABLE IF NOT EXISTS ocx_task_graph (
    repository_id TEXT PRIMARY KEY,
    graph TEXT NOT NULL,
    time_updated INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS ocx_requirement_ledger (
    repository_id TEXT PRIMARY KEY,
    requirements TEXT NOT NULL,
    time_updated INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS ocx_evaluations (
    run_id TEXT PRIMARY KEY,
    fixture_id TEXT NOT NULL,
    time_started INTEGER NOT NULL,
    run TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS ocx_evaluations_fixture_idx ON ocx_evaluations(fixture_id, time_started DESC)
  ;
  CREATE TABLE IF NOT EXISTS ocx_changesets (
    id TEXT PRIMARY KEY,
    repository_id TEXT NOT NULL,
    time_updated INTEGER NOT NULL,
    record TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS ocx_changesets_repository_idx ON ocx_changesets(repository_id, time_updated DESC)
  ;
  CREATE TABLE IF NOT EXISTS ocx_verification_evidence (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    time_created INTEGER NOT NULL,
    record TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS ocx_verification_session_idx ON ocx_verification_evidence(session_id, time_created DESC)
  ;
  CREATE TABLE IF NOT EXISTS ocx_provenance_links (
    id TEXT PRIMARY KEY,
    target TEXT NOT NULL,
    time_created INTEGER NOT NULL,
    record TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS ocx_provenance_target_idx ON ocx_provenance_links(target, time_created DESC)
`

async function loadDriver(filename: string): Promise<Driver> {
  const specifier = typeof Bun !== "undefined" ? "bun:sqlite" : "node:sqlite"
  const mod: Record<string, unknown> = await import(specifier)
  if (typeof Bun !== "undefined") {
    const Database = mod.default as new (file: string) => {
      exec: (sql: string) => void
      prepare: (sql: string) => Statement
    }
    const db = new Database(filename)
    return {
      exec: (sql) => db.exec(sql),
      prepare: (sql) => {
        const statement = db.prepare(sql)
        return {
          get: (...params) => statement.get(...params),
          all: (...params) => statement.all(...params),
          run: (...params) => statement.run(...params),
        }
      },
    }
  }
  const DatabaseSync = mod.DatabaseSync as new (file: string) => {
    exec: (sql: string) => void
    prepare: (sql: string) => Statement
  }
  const db = new DatabaseSync(filename)
  return {
    exec: (sql) => db.exec(sql),
    prepare: (sql) => {
      const statement = db.prepare(sql)
      return {
        get: (...params) => statement.get(...params),
        all: (...params) => statement.all(...params),
        run: (...params) => statement.run(...params),
      }
    },
  }
}

function decodeState(row: unknown): State | undefined {
  if (!row || typeof row !== "object") return undefined
  const record = row as Record<string, unknown>
  if (typeof record.workflow !== "string" || typeof record.phase !== "string") return undefined
  let phases: unknown
  try {
    phases = JSON.parse(record.phases as string)
  } catch {
    return undefined
  }
  let workstream: unknown = []
  try {
    workstream = JSON.parse((record.workstream as string | undefined) ?? "[]")
  } catch {
    workstream = []
  }
  let requirements: unknown = []
  try {
    requirements = JSON.parse((record.requirements as string | undefined) ?? "[]")
  } catch {
    requirements = []
  }
  let executionPlan: unknown
  try {
    executionPlan = record.execution_plan ? JSON.parse(record.execution_plan as string) : undefined
  } catch {
    executionPlan = undefined
  }
  let playbookStage: unknown
  try {
    playbookStage = record.playbook_stage ? JSON.parse(record.playbook_stage as string) : undefined
  } catch {
    playbookStage = undefined
  }
  if (!Array.isArray(phases)) return undefined
  const decoded: Phase[] = []
  for (const item of phases) {
    if (!item || typeof item !== "object") return undefined
    const entry = item as Record<string, unknown>
    if (typeof entry.id !== "string" || typeof entry.goal !== "string") return undefined
    const gate = typeof entry.gate === "string" && entry.gate.length > 0 ? entry.gate : undefined
    decoded.push(gate === undefined ? { id: entry.id, goal: entry.goal } : { id: entry.id, goal: entry.goal, gate })
  }
  const streams = Workflow.parseWorkstreams(workstream)
  const requirementRows = Requirements.parseList(requirements)
  const plan = PlanWorkstreamState.parseStoredPlan(executionPlan)
  const stage = parsePlaybookStage(playbookStage)
  const stack = typeof record.stack === "string" && record.stack.length > 0 ? record.stack : undefined
  const state: State = {
    workflow: record.workflow as string,
    phase: record.phase as string,
    phases: decoded,
    ...(typeof record.variant === "string" && record.variant.length > 0 ? { variant: record.variant } : {}),
    ...(typeof record.objective === "string" && record.objective.length > 0 ? { objective: record.objective } : {}),
    ...(stateStatus(record.state_status) ? { status: stateStatus(record.state_status) } : {}),
    ...(stateNumber(record.revision) ? { revision: stateNumber(record.revision) } : {}),
    ...(stateNumber(record.intent_revision) ? { intentRevision: stateNumber(record.intent_revision) } : {}),
    ...(streams ? { workstream: streams } : {}),
    ...(stack ? { stack } : {}),
    ...(record.done === 1 ? { done: true } : {}),
    ...(requirementRows.length > 0 ? { requirements: requirementRows } : {}),
    ...(plan ? { plan } : {}),
    ...(stage ? { playbookStage: stage } : {}),
  }
  return state
}

function decodeWorkflowProposal(row: unknown): WorkflowProposal | undefined {
  if (!row || typeof row !== "object") return undefined
  const record = row as Record<string, unknown>
  const workflow = text(record.workflow)
  const reason = text(record.reason)
  if (!workflow || !reason) return undefined
  return {
    workflow,
    ...(text(record.variant) ? { variant: text(record.variant) } : {}),
    ...(text(record.phase) ? { phase: text(record.phase) } : {}),
    ...(text(record.objective) ? { objective: text(record.objective) } : {}),
    reason,
    ...(text(record.previous_workflow) ? { previousWorkflow: text(record.previous_workflow) } : {}),
    ...(text(record.previous_variant) ? { previousVariant: text(record.previous_variant) } : {}),
    ...(text(record.previous_phase) ? { previousPhase: text(record.previous_phase) } : {}),
    ...(text(record.previous_objective) ? { previousObjective: text(record.previous_objective) } : {}),
  }
}

function stateStatus(value: unknown): Workflow.WorkflowStatus | undefined {
  return value === "active" || value === "waiting" || value === "blocked" || value === "complete" ? value : undefined
}

function stateNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined
}

function normalizeState(state: State): State {
  if (!state || typeof state !== "object") return state
  const canonical = Workflow.canonicalID(state.workflow)
  const preset = canonical ? Workflow.get(canonical) : undefined
  const phases = state.phases && state.phases.length > 0 ? state.phases : preset?.phases ?? []
  const phase = typeof state.phase === "string" && state.phase.trim().length > 0 ? state.phase.trim() : (phases[0]?.id ?? "context")
  return {
    ...state,
    workflow: state.workflow ?? canonical ?? "coding",
    phase,
    phases,
    ...(state.objective ? { objective: state.objective } : {}),
    ...(state.status ? { status: state.status } : {}),
    ...(state.revision !== undefined ? { revision: state.revision } : {}),
    ...(state.intentRevision !== undefined ? { intentRevision: state.intentRevision } : {}),
    ...(state.done ? { done: true } : {}),
    workstream: Array.isArray(state.workstream) ? state.workstream : [],
    ...(typeof state.stack === "string" ? { stack: state.stack } : {}),
    requirements: Array.isArray(state.requirements) ? state.requirements : [],
    ...(state.plan ? { plan: state.plan } : {}),
    ...(state.playbookStage ? { playbookStage: state.playbookStage } : {}),
  }
}

function parsePlaybookStage(value: unknown): PlaybookStageState | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const stages = ["none", "pre_implementation", "implementation", "post_implementation", "verification", "recovery"] as const
  if (!stages.includes(record.stage as (typeof stages)[number])) return undefined
  if (typeof record.revision !== "number" || !Number.isInteger(record.revision) || record.revision < 0) return undefined
  if (record.previousStage !== undefined && !stages.includes(record.previousStage as (typeof stages)[number])) return undefined
  const selectionRevision = record.selectionRevision === undefined ? undefined : text(record.selectionRevision)
  if (record.selectionRevision !== undefined && !selectionRevision) return undefined
  const passes = parsePlaybookPasses(record.passes)
  if (record.passes !== undefined && !passes) return undefined
  return {
    stage: record.stage as (typeof stages)[number],
    revision: record.revision,
    ...(record.previousStage ? { previousStage: record.previousStage as (typeof stages)[number] } : {}),
    ...(selectionRevision ? { selectionRevision } : {}),
    ...(passes ? { passes } : {}),
  }
}

function parsePlaybookPasses(value: unknown): PlaybookPassRecord[] | undefined {
  if (!Array.isArray(value) || value.length > 32) return undefined
  const outcomes = ["completed", "failed", "skipped", "cancelled", "invalidated"] as const
  const result: PlaybookPassRecord[] = []
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return undefined
    const record = item as Record<string, unknown>
    const playbookID = text(record.playbookID)
    const stage = text(record.stage)
    const hash = text(record.hash)
    const selectionRevision = text(record.selectionRevision)
    const outcome = record.outcome
    const reason = record.reason === undefined ? undefined : text(record.reason)
    if (
      !playbookID ||
      !stage ||
      !["pre_implementation", "post_implementation", "verification", "recovery"].includes(stage) ||
      !hash ||
      !selectionRevision ||
      !outcomes.includes(outcome as (typeof outcomes)[number])
    )
      return undefined
    if (record.reason !== undefined && !reason) return undefined
    result.push({
      playbookID: playbookID as PlaybookPassRecord["playbookID"],
      stage: stage as PlaybookPassRecord["stage"],
      hash,
      selectionRevision,
      outcome: outcome as PlaybookPassRecord["outcome"],
      ...(reason ? { reason } : {}),
    })
  }
  return result
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function operation(value: unknown): Recovery.Operation | undefined {
  return value === "read" || value === "patch" || value === "task" || value === "cancel" || value === "partial"
    ? value
    : undefined
}

function category(value: unknown): Recovery.Category | undefined {
  return value === "spec" || value === "env" || value === "agent" || value === "artifact" || value === "evaluator"
    ? value
    : undefined
}

function operationStatus(value: unknown): OperationRecord["status"] | undefined {
  return value === "failed" || value === "cancelled" ? value : undefined
}

function decodeOperation(row: unknown): OperationRecord | undefined {
  if (!row || typeof row !== "object") return undefined
  const record = row as Record<string, unknown>
  const id = text(record.id)
  const sessionID = text(record.session_id)
  const operationValue = operation(record.operation)
  const status = operationStatus(record.status)
  const categoryValue = category(record.category)
  const message = text(record.message)
  const nextAction = text(record.next_action)
  const timeCreated = number(record.time_created)
  if (!id || !sessionID || !operationValue || !status || !categoryValue || !message || !nextAction || timeCreated === undefined)
    return undefined
  return {
    id,
    sessionID,
    operation: operationValue,
    status,
    category: categoryValue,
    message,
    retryable: record.retryable === 1,
    nextAction,
    timeCreated,
  }
}

function decodeGraph(row: unknown): TaskGraph.Graph | undefined {
  if (!row || typeof row !== "object") return undefined
  const value = (row as Record<string, unknown>).graph
  if (typeof value !== "string") return undefined
  try {
    return TaskGraph.parse(JSON.parse(value))
  } catch {
    return undefined
  }
}

function decodeRequirementLedger(row: unknown): Requirements.Record[] {
  if (!row || typeof row !== "object") return []
  const value = (row as Record<string, unknown>).requirements
  if (typeof value !== "string") return []
  try {
    return Requirements.parseList(JSON.parse(value))
  } catch {
    return []
  }
}

function decodeEvaluation(row: unknown): Eval.RunRecord | undefined {
  if (!row || typeof row !== "object") return undefined
  const value = (row as Record<string, unknown>).run
  if (typeof value !== "string") return undefined
  try {
    return Eval.parseRun(JSON.parse(value))
  } catch {
    return undefined
  }
}

function decodeChangeset(row: unknown): Changeset.Record | undefined {
  if (!row || typeof row !== "object") return undefined
  const value = (row as Record<string, unknown>).record
  if (typeof value !== "string") return undefined
  try {
    return Changeset.parse(JSON.parse(value))
  } catch {
    return undefined
  }
}

function decodeVerification(row: unknown): Evidence.Verification | undefined {
  if (!row || typeof row !== "object") return undefined
  const value = (row as Record<string, unknown>).record
  if (typeof value !== "string") return undefined
  try {
    return Evidence.parseVerification(JSON.parse(value))
  } catch {
    return undefined
  }
}

function decodeLink(row: unknown): Evidence.LinkRecord | undefined {
  if (!row || typeof row !== "object") return undefined
  const value = (row as Record<string, unknown>).record
  if (typeof value !== "string") return undefined
  try {
    return Evidence.parseLink(JSON.parse(value))
  } catch {
    return undefined
  }
}

function decodeWorkGraph(row: unknown): WorkGraph | undefined {
  if (!row || typeof row !== "object") return undefined
  const value = (row as Record<string, unknown>).snapshot_json
  if (typeof value !== "string") return undefined
  try {
    return WorkGraphReducer.parse(JSON.parse(value))
  } catch {
    return undefined
  }
}

function decodeWorkGraphEvent(row: unknown): WorkGraphEvent | undefined {
  if (!row || typeof row !== "object") return undefined
  const record = row as Record<string, unknown>
  let payload: unknown
  try {
    payload = JSON.parse(record.payload_json as string)
  } catch {
    return undefined
  }
  return WorkGraphReducer.parseEvent({
    eventID: record.event_id,
    sessionID: record.session_id,
    graphID: record.graph_id,
    sequence: record.seq,
    type: record.event_type,
    graphRevision: record.graph_revision,
    intentRevision: record.intent_revision,
    ...(record.node_id ? { nodeID: record.node_id } : {}),
    ...(record.node_revision !== null && record.node_revision !== undefined ? { nodeRevision: record.node_revision } : {}),
    ...(record.causation_id ? { causationID: record.causation_id } : {}),
    ...(record.correlation_id ? { correlationID: record.correlation_id } : {}),
    ...(record.idempotency_key ? { idempotencyKey: record.idempotency_key } : {}),
    timestamp: record.time_created,
    payload,
  })
}

function createOperation(input: Omit<OperationRecord, "id" | "timeCreated">): OperationRecord {
  return {
    ...input,
    id: `ocx_operation_${randomUUID().replaceAll("-", "")}`,
    timeCreated: Date.now(),
  }
}

function normalizeWorkflowProposal(proposal: WorkflowProposal): WorkflowProposal {
  const workflow = proposal.workflow.trim()
  const reason = proposal.reason.replace(/\s+/g, " ").trim()
  if (!workflow || !reason) throw new Error("workflow proposal requires a workflow and reason")
  return {
    workflow,
    ...(text(proposal.variant) ? { variant: text(proposal.variant) } : {}),
    ...(text(proposal.phase) ? { phase: text(proposal.phase) } : {}),
    ...(text(proposal.objective) ? { objective: text(proposal.objective) } : {}),
    reason,
    ...(text(proposal.previousWorkflow) ? { previousWorkflow: text(proposal.previousWorkflow) } : {}),
    ...(text(proposal.previousVariant) ? { previousVariant: text(proposal.previousVariant) } : {}),
    ...(text(proposal.previousPhase) ? { previousPhase: text(proposal.previousPhase) } : {}),
    ...(text(proposal.previousObjective) ? { previousObjective: text(proposal.previousObjective) } : {}),
  }
}

export function path(): string {
  return join(Global.Path.data, "ocx", "workflow.db")
}

export function open(filename = path()): Effect.Effect<Store, unknown> {
  return Effect.gen(function* () {
    yield* Effect.try({
      try: () => mkdirSync(dirname(filename), { recursive: true }),
      catch: (error) => error,
    })
    const driver = yield* Effect.tryPromise({
      try: () => loadDriver(filename),
      catch: (error) => error,
    })
    driver.exec("PRAGMA journal_mode = WAL")
    driver.exec("PRAGMA busy_timeout = 5000")
    driver.exec(createTable)
    const columns = driver.prepare("PRAGMA table_info(session_workflow)").all() as Record<string, unknown>[]
    if (!columns.some((column) => column.name === "variant"))
      driver.exec("ALTER TABLE session_workflow ADD COLUMN variant TEXT")
    if (!columns.some((column) => column.name === "objective"))
      driver.exec("ALTER TABLE session_workflow ADD COLUMN objective TEXT")
    if (!columns.some((column) => column.name === "state_status"))
      driver.exec("ALTER TABLE session_workflow ADD COLUMN state_status TEXT")
    if (!columns.some((column) => column.name === "revision"))
      driver.exec("ALTER TABLE session_workflow ADD COLUMN revision INTEGER NOT NULL DEFAULT 0")
    if (!columns.some((column) => column.name === "intent_revision"))
      driver.exec("ALTER TABLE session_workflow ADD COLUMN intent_revision INTEGER NOT NULL DEFAULT 0")
    if (!columns.some((column) => column.name === "workstream"))
      driver.exec("ALTER TABLE session_workflow ADD COLUMN workstream TEXT NOT NULL DEFAULT '[]'")
    if (!columns.some((column) => column.name === "stack"))
      driver.exec("ALTER TABLE session_workflow ADD COLUMN stack TEXT")
    if (!columns.some((column) => column.name === "requirements"))
      driver.exec("ALTER TABLE session_workflow ADD COLUMN requirements TEXT NOT NULL DEFAULT '[]'")
    if (!columns.some((column) => column.name === "done"))
      driver.exec("ALTER TABLE session_workflow ADD COLUMN done INTEGER NOT NULL DEFAULT 0")
    if (!columns.some((column) => column.name === "execution_plan"))
      driver.exec("ALTER TABLE session_workflow ADD COLUMN execution_plan TEXT")
    if (!columns.some((column) => column.name === "playbook_stage"))
      driver.exec("ALTER TABLE session_workflow ADD COLUMN playbook_stage TEXT")
    const select = driver.prepare(
      "SELECT workflow, phase, phases, variant, objective, state_status, revision, intent_revision, workstream, stack, done, requirements, execution_plan, playbook_stage FROM session_workflow WHERE session_id = ?",
    )
    const proposalSelect = driver.prepare(
      "SELECT workflow, variant, phase, objective, reason, previous_workflow, previous_variant, previous_phase, previous_objective FROM session_workflow_proposal WHERE session_id = ?",
    )
    const upsert = driver.prepare(
      `INSERT INTO session_workflow (session_id, workflow, phase, phases, variant, objective, state_status, revision, intent_revision, workstream, stack, done, requirements, execution_plan, playbook_stage, time_created, time_updated)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET workflow = excluded.workflow, phase = excluded.phase, phases = excluded.phases, variant = excluded.variant, objective = excluded.objective, state_status = excluded.state_status, revision = excluded.revision, intent_revision = excluded.intent_revision, workstream = excluded.workstream, stack = excluded.stack, done = excluded.done, requirements = excluded.requirements, execution_plan = excluded.execution_plan, playbook_stage = excluded.playbook_stage, time_updated = excluded.time_updated`,
    )
    const remove = driver.prepare("DELETE FROM session_workflow WHERE session_id = ?")
    const proposalUpsert = driver.prepare(
      `INSERT INTO session_workflow_proposal (session_id, workflow, variant, phase, objective, reason, previous_workflow, previous_variant, previous_phase, previous_objective, time_created, time_updated)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET workflow = excluded.workflow, variant = excluded.variant, phase = excluded.phase, objective = excluded.objective, reason = excluded.reason, previous_workflow = excluded.previous_workflow, previous_variant = excluded.previous_variant, previous_phase = excluded.previous_phase, previous_objective = excluded.previous_objective, time_updated = excluded.time_updated`,
    )
    const proposalRemove = driver.prepare("DELETE FROM session_workflow_proposal WHERE session_id = ?")
    const workGraphSelect = driver.prepare("SELECT snapshot_json FROM ocx_work_graphs WHERE session_id = ?")
    const workGraphUpsert = driver.prepare(
      `INSERT INTO ocx_work_graphs (graph_id, session_id, repository_id, revision, intent_revision, snapshot_json, time_created, time_updated)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET graph_id = excluded.graph_id, repository_id = excluded.repository_id, revision = excluded.revision, intent_revision = excluded.intent_revision, snapshot_json = excluded.snapshot_json, time_updated = excluded.time_updated`,
    )
    const workGraphEventRows = driver.prepare(
      "SELECT event_id, session_id, graph_id, seq, event_type, graph_revision, intent_revision, node_id, node_revision, causation_id, correlation_id, idempotency_key, payload_json, time_created FROM ocx_work_events WHERE session_id = ? AND seq > ? ORDER BY seq ASC",
    )
    const workGraphEventMax = driver.prepare("SELECT MAX(seq) AS max_seq FROM ocx_work_events WHERE session_id = ?")
    const workGraphEventBySequence = driver.prepare("SELECT event_id, idempotency_key, payload_json FROM ocx_work_events WHERE session_id = ? AND seq = ?")
    const workGraphEventByIdempotency = driver.prepare(
      "SELECT event_id, seq, payload_json FROM ocx_work_events WHERE session_id = ? AND idempotency_key = ?",
    )
    const workGraphEventInsert = driver.prepare(
      `INSERT INTO ocx_work_events (event_id, session_id, graph_id, seq, event_type, graph_revision, intent_revision, node_id, node_revision, causation_id, correlation_id, idempotency_key, payload_json, time_created)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    const workGraphEventRemove = driver.prepare("DELETE FROM ocx_work_events WHERE session_id = ?")
    const workGraphRemove = driver.prepare("DELETE FROM ocx_work_graphs WHERE session_id = ?")
    const operationRows = driver.prepare(
      "SELECT id, session_id, operation, status, category, message, retryable, next_action, time_created FROM ocx_operations WHERE session_id = ? ORDER BY time_created DESC, id DESC LIMIT ?",
    )
    const insertOperation = driver.prepare(
      "INSERT INTO ocx_operations (id, session_id, operation, status, category, message, retryable, next_action, time_created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    const graphSelect = driver.prepare("SELECT graph FROM ocx_task_graph WHERE repository_id = ?")
    const graphUpsert = driver.prepare(
      `INSERT INTO ocx_task_graph (repository_id, graph, time_updated) VALUES (?, ?, ?)
       ON CONFLICT(repository_id) DO UPDATE SET graph = excluded.graph, time_updated = excluded.time_updated`,
    )
    const requirementLedgerSelect = driver.prepare("SELECT requirements FROM ocx_requirement_ledger WHERE repository_id = ?")
    const requirementLedgerUpsert = driver.prepare(
      `INSERT INTO ocx_requirement_ledger (repository_id, requirements, time_updated) VALUES (?, ?, ?)
       ON CONFLICT(repository_id) DO UPDATE SET requirements = excluded.requirements, time_updated = excluded.time_updated`,
    )
    const evaluationRows = driver.prepare(
      "SELECT run FROM ocx_evaluations WHERE (? IS NULL OR fixture_id = ?) ORDER BY time_started DESC, run_id DESC LIMIT ?",
    )
    const evaluationInsert = driver.prepare(
      "INSERT INTO ocx_evaluations (run_id, fixture_id, time_started, run) VALUES (?, ?, ?, ?)",
    )
    const changesetRows = driver.prepare(
      "SELECT record FROM ocx_changesets WHERE repository_id = ? ORDER BY time_updated ASC, id ASC",
    )
    const changesetRow = driver.prepare("SELECT record FROM ocx_changesets WHERE id = ?")
    const changesetInsert = driver.prepare(
      "INSERT OR REPLACE INTO ocx_changesets (id, repository_id, time_updated, record) VALUES (?, ?, ?, ?)",
    )
    const verificationRows = driver.prepare(
      "SELECT record FROM ocx_verification_evidence WHERE (? IS NULL OR session_id = ?) ORDER BY time_created DESC, id DESC LIMIT ?",
    )
    const verificationInsert = driver.prepare(
      "INSERT OR REPLACE INTO ocx_verification_evidence (id, session_id, time_created, record) VALUES (?, ?, ?, ?)",
    )
    const linkRows = driver.prepare(
      "SELECT record FROM ocx_provenance_links WHERE (? IS NULL OR target = ?) ORDER BY time_created DESC, id DESC LIMIT ?",
    )
    const linkInsert = driver.prepare(
      "INSERT OR REPLACE INTO ocx_provenance_links (id, target, time_created, record) VALUES (?, ?, ?, ?)",
    )
    const workGraphEvents = (sessionID: string, afterSequence = 0): WorkGraphEvent[] =>
      workGraphEventRows.all(sessionID, Math.max(0, Math.floor(afterSequence))).flatMap((row) => {
        const event = decodeWorkGraphEvent(row)
        return event ? [event] : []
      })
    const saveWorkGraph = (graph: WorkGraph, events: readonly WorkGraphEvent[]): void => {
      if (!WorkGraphReducer.validate(graph)) throw new Error("invalid work graph snapshot")
      for (const event of events) {
        if (
          event.sessionID !== graph.sessionID ||
          event.graphID !== graph.id ||
          event.sequence < 1 ||
          !Number.isInteger(event.sequence)
        )
          throw new Error("work graph event does not match snapshot")
      }
      driver.exec("BEGIN IMMEDIATE")
      try {
        const maxRow = workGraphEventMax.get(graph.sessionID) as Record<string, unknown> | undefined
        let maxSequence = typeof maxRow?.max_seq === "number" ? maxRow.max_seq : 0
        for (const event of events) {
          const payload = JSON.stringify(event.payload)
          const idempotency = event.idempotencyKey
            ? (workGraphEventByIdempotency.get(event.sessionID, event.idempotencyKey) as Record<string, unknown> | undefined)
            : undefined
          if (idempotency) {
            if (idempotency.payload_json === payload) continue
            throw new Error(`work graph idempotency conflict: ${event.idempotencyKey}`)
          }
          const sequence = workGraphEventBySequence.get(event.sessionID, event.sequence) as Record<string, unknown> | undefined
          if (sequence) {
            if (sequence.payload_json === payload) continue
            throw new Error(`work graph sequence conflict: ${event.sequence}`)
          }
          if (event.sequence !== maxSequence + 1) throw new Error(`work graph sequence gap: expected ${maxSequence + 1}`)
          workGraphEventInsert.run(
            event.eventID,
            event.sessionID,
            event.graphID,
            event.sequence,
            event.type,
            event.graphRevision,
            event.intentRevision,
            event.nodeID ?? null,
            event.nodeRevision ?? null,
            event.causationID ?? null,
            event.correlationID ?? null,
            event.idempotencyKey ?? null,
            payload,
            event.timestamp,
          )
          maxSequence = event.sequence
        }
        const now = Date.now()
        workGraphUpsert.run(
          graph.id,
          graph.sessionID,
          graph.repositoryID ?? null,
          graph.revision,
          graph.intentRevision,
          JSON.stringify(graph),
          graph.createdAt,
          now,
        )
        driver.exec("COMMIT")
      } catch (error) {
        driver.exec("ROLLBACK")
        throw error
      }
    }
    return {
      get: (sessionID) => decodeState(select.get(sessionID)),
      set: (sessionID, state) => {
        const normalized = normalizeState(state)
        if (!normalized) throw new Error(`invalid workflow state for ${sessionID}`)
        const now = Date.now()
        upsert.run(
          sessionID,
          normalized.workflow ?? "",
          normalized.phase ?? "",
          JSON.stringify(normalized.phases ?? []),
          normalized.variant ?? null,
          normalized.objective ?? null,
          normalized.status ?? null,
          normalized.revision ?? 0,
          normalized.intentRevision ?? 0,
          JSON.stringify(normalized.workstream ?? []),
          normalized.stack ?? null,
          normalized.done === true ? 1 : 0,
          JSON.stringify(normalized.requirements ?? []),
          normalized.plan ? JSON.stringify(normalized.plan) : null,
          normalized.playbookStage ? JSON.stringify(normalized.playbookStage) : null,
          now,
          now,
        )
      },
      clear: (sessionID) => {
        remove.run(sessionID)
        workGraphEventRemove.run(sessionID)
        workGraphRemove.run(sessionID)
      },
      getWorkflowProposal: (sessionID) => decodeWorkflowProposal(proposalSelect.get(sessionID)),
      setWorkflowProposal: (sessionID, proposal) => {
        const normalized = normalizeWorkflowProposal(proposal)
        const now = Date.now()
        proposalUpsert.run(
          sessionID,
          normalized.workflow,
          normalized.variant ?? null,
          normalized.phase ?? null,
          normalized.objective ?? null,
          normalized.reason,
          normalized.previousWorkflow ?? null,
          normalized.previousVariant ?? null,
          normalized.previousPhase ?? null,
          normalized.previousObjective ?? null,
          now,
          now,
        )
      },
      clearWorkflowProposal: (sessionID) => proposalRemove.run(sessionID),
      recordOperation: (input) => {
        const record = createOperation(input)
        insertOperation.run(
          record.id,
          record.sessionID,
          record.operation,
          record.status,
          record.category,
          record.message,
          record.retryable ? 1 : 0,
          record.nextAction,
          record.timeCreated,
        )
        return record
      },
      operations: (sessionID, limit = 24) =>
        operationRows.all(sessionID, Math.max(1, Math.floor(limit))).flatMap((row) => {
          const operation = decodeOperation(row)
          return operation ? [operation] : []
        }),
      getGraph: (repositoryID) => decodeGraph(graphSelect.get(repositoryID)),
      setGraph: (repositoryID, graph) => graphUpsert.run(repositoryID, JSON.stringify(graph), Date.now()),
      getRequirementLedger: (repositoryID) => decodeRequirementLedger(requirementLedgerSelect.get(repositoryID)),
      setRequirementLedger: (repositoryID, records) => requirementLedgerUpsert.run(repositoryID, JSON.stringify(records), Date.now()),
      recordEvaluation: (record) => {
        evaluationInsert.run(record.runID, record.fixtureID, record.startedAt, JSON.stringify(record))
        return record
      },
      evaluations: (fixtureID, limit = 24) =>
        evaluationRows.all(fixtureID ?? null, fixtureID ?? null, Math.max(1, Math.floor(limit))).flatMap((row) => {
          const record = decodeEvaluation(row)
          return record ? [record] : []
        }),
      recordChangeset: (record) => {
        changesetInsert.run(record.id, record.repositoryID, record.updatedAt, JSON.stringify(record))
        return record
      },
      getChangeset: (id) => decodeChangeset(changesetRow.get(id)),
      changesets: (repositoryID) => changesetRows.all(repositoryID).flatMap((row) => {
        const record = decodeChangeset(row)
        return record ? [record] : []
      }),
      updateChangeset: (id, patch) => {
        const current = decodeChangeset(changesetRow.get(id))
        if (!current) return
        const updated = Changeset.parse({ ...current, ...patch, updatedAt: Date.now() })
        if (updated) changesetInsert.run(updated.id, updated.repositoryID, updated.updatedAt, JSON.stringify(updated))
      },
      recordVerification: (record) => {
        const safe = record.command ? { ...record, command: SecretRedaction.redact(record.command).value } : record
        verificationInsert.run(safe.id, safe.sessionID, safe.createdAt, JSON.stringify(safe))
        return safe
      },
      verifications: (sessionID, limit = 24) =>
        verificationRows.all(sessionID ?? null, sessionID ?? null, Math.max(1, Math.floor(limit))).flatMap((row) => {
          const record = decodeVerification(row)
          return record ? [record] : []
        }),
      recordLink: (record) => {
        linkInsert.run(record.id, record.target, record.createdAt, JSON.stringify(record))
        return record
      },
      links: (target, limit = 24) =>
        linkRows.all(target ?? null, target ?? null, Math.max(1, Math.floor(limit))).flatMap((row) => {
          const record = decodeLink(row)
          return record ? [record] : []
        }),
      getWorkGraph: (sessionID) => decodeWorkGraph(workGraphSelect.get(sessionID)),
      workGraphEvents,
      saveWorkGraph,
    } satisfies Store
  })
}

export function memory(): Store {
  const rows = new Map<string, State>()
  const proposals = new Map<string, WorkflowProposal>()
  const operationRows = new Map<string, OperationRecord[]>()
  const graphs = new Map<string, TaskGraph.Graph>()
  const requirementLedgers = new Map<string, Requirements.Record[]>()
  const evaluations: Eval.RunRecord[] = []
  const changesets = new Map<string, Changeset.Record>()
  const verifications: Evidence.Verification[] = []
  const links: Evidence.LinkRecord[] = []
  const workGraphs = new Map<string, WorkGraph>()
  const workEvents = new Map<string, WorkGraphEvent[]>()
  const saveWorkGraph = (graph: WorkGraph, events: readonly WorkGraphEvent[]): void => {
    if (!WorkGraphReducer.validate(graph)) throw new Error("invalid work graph snapshot")
    const current = workEvents.get(graph.sessionID) ?? []
    let expected = (current.at(-1)?.sequence ?? 0) + 1
    for (const event of events) {
      if (event.sessionID !== graph.sessionID || event.graphID !== graph.id || event.sequence < 1 || !Number.isInteger(event.sequence))
        throw new Error("work graph event does not match snapshot")
      const duplicate = event.idempotencyKey
        ? current.find((item) => item.idempotencyKey === event.idempotencyKey)
        : current.find((item) => item.sequence === event.sequence)
      if (duplicate) {
        if (JSON.stringify(duplicate.payload) === JSON.stringify(event.payload)) continue
        throw new Error(`work graph idempotency conflict: ${event.idempotencyKey ?? event.sequence}`)
      }
      if (event.sequence !== expected) throw new Error(`work graph sequence gap: expected ${expected}`)
      current.push(event)
      expected++
    }
    workEvents.set(graph.sessionID, current)
    workGraphs.set(graph.sessionID, graph)
  }
  return {
    get: (sessionID) => rows.get(sessionID),
    set: (sessionID, state) => {
      const normalized = normalizeState(state)
      if (!normalized) throw new Error(`invalid workflow state for ${sessionID}`)
      rows.set(sessionID, normalized)
    },
    clear: (sessionID) => {
      rows.delete(sessionID)
      workGraphs.delete(sessionID)
      workEvents.delete(sessionID)
    },
    getWorkflowProposal: (sessionID) => proposals.get(sessionID),
    setWorkflowProposal: (sessionID, proposal) => proposals.set(sessionID, normalizeWorkflowProposal(proposal)),
    clearWorkflowProposal: (sessionID) => proposals.delete(sessionID),
    recordOperation: (input) => {
      const record = createOperation(input)
      operationRows.set(input.sessionID, [...(operationRows.get(input.sessionID) ?? []), record])
      return record
    },
    operations: (sessionID, limit = 24) => [...(operationRows.get(sessionID) ?? [])].slice(-Math.max(1, Math.floor(limit))).reverse(),
    getGraph: (repositoryID) => graphs.get(repositoryID),
    setGraph: (repositoryID, graph) => graphs.set(repositoryID, graph),
    getRequirementLedger: (repositoryID) => requirementLedgers.get(repositoryID) ?? [],
    setRequirementLedger: (repositoryID, records) => requirementLedgers.set(repositoryID, [...records]),
    recordEvaluation: (record) => {
      evaluations.push(record)
      return record
    },
    evaluations: (fixtureID, limit = 24) =>
      evaluations
        .filter((record) => fixtureID === undefined || record.fixtureID === fixtureID)
        .slice(-Math.max(1, Math.floor(limit)))
        .reverse(),
    recordChangeset: (record) => {
      changesets.set(record.id, record)
      return record
    },
    getChangeset: (id) => changesets.get(id),
    changesets: (repositoryID) => [...changesets.values()].filter((record) => record.repositoryID === repositoryID),
    updateChangeset: (id, patch) => {
      const current = changesets.get(id)
      if (!current) return
      changesets.set(id, { ...current, ...patch, updatedAt: Date.now() })
    },
    recordVerification: (record) => {
      const safe = record.command ? { ...record, command: SecretRedaction.redact(record.command).value } : record
      verifications.push(safe)
      return safe
    },
    verifications: (sessionID, limit = 24) =>
      verifications
        .filter((record) => sessionID === undefined || record.sessionID === sessionID)
        .slice(-Math.max(1, Math.floor(limit)))
        .reverse(),
    recordLink: (record) => {
      links.push(record)
      return record
    },
    links: (target, limit = 24) =>
      links
        .filter((record) => target === undefined || record.target === target)
        .slice(-Math.max(1, Math.floor(limit)))
        .reverse(),
    getWorkGraph: (sessionID) => workGraphs.get(sessionID),
    workGraphEvents: (sessionID, afterSequence = 0) =>
      (workEvents.get(sessionID) ?? []).filter((event) => event.sequence > Math.max(0, Math.floor(afterSequence))),
    saveWorkGraph,
  }
}

let sharedPromise: Promise<Store> | undefined

export const shared: Effect.Effect<Store, unknown> = Effect.tryPromise({
  try: () => {
    if (!sharedPromise) {
      sharedPromise = Effect.runPromise(open()).catch((error) => {
        sharedPromise = undefined
        throw error
      })
    }
    return sharedPromise
  },
  catch: (error) => error,
})
