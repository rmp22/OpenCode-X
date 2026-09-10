import { Database } from "bun:sqlite"
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"

export const laneTable = sqliteTable("lane", {
  id: text().primaryKey(),
  session_id: text().notNull(),
  objective: text().notNull(),
  kind: text().notNull(),
  status: text().notNull(),
  risk: text().notNull(),
  created_at: integer().notNull(),
  updated_at: integer().notNull(),
})

export const checklistRunTable = sqliteTable("checklist_run", {
  id: text().primaryKey(),
  lane_id: text().notNull(),
  checklist_id: text().notNull(),
  verdict: text().notNull(),
  items: text({ mode: "json" }).notNull(),
  created_at: integer().notNull(),
})

export const gateTable = sqliteTable("gate", {
  id: text().primaryKey(),
  lane_id: text().notNull(),
  effect: text().notNull(),
  payload: text({ mode: "json" }).notNull(),
  options: text({ mode: "json" }).notNull(),
  status: text().notNull(),
  resolution: text({ mode: "json" }),
  created_at: integer().notNull(),
  resolved_at: integer(),
})

export const deviationTable = sqliteTable("deviation", {
  id: text().primaryKey(),
  session_id: text().notNull(),
  lane_id: text(),
  kind: text().notNull(),
  detail: text({ mode: "json" }).notNull(),
  created_at: integer().notNull(),
})

export const graphRunTable = sqliteTable("graph_run", {
  id: text().primaryKey(),
  lane_id: text().notNull(),
  graph_id: text().notNull(),
  status: text().notNull(),
  active_node_ids: text({ mode: "json" }).notNull(),
  context_envelope: text({ mode: "json" }).notNull(),
  created_at: integer().notNull(),
  updated_at: integer().notNull(),
})

export const nodeExecutionTable = sqliteTable("node_execution", {
  id: text().primaryKey(),
  graph_run_id: text().notNull(),
  node_id: text().notNull(),
  iteration: integer().notNull(),
  status: text().notNull(),
  input_payload: text({ mode: "json" }).notNull(),
  output_payload: text({ mode: "json" }),
  error_signature: text(),
  diff_hash: text(),
  duration_ms: integer(),
  created_at: integer().notNull(),
})

export const loopGuardRecordTable = sqliteTable("loop_guard_record", {
  id: text().primaryKey(),
  graph_run_id: text().notNull(),
  edge_id: text().notNull(),
  cycle_count: integer().notNull(),
  historical_error_hashes: text({ mode: "json" }).notNull(),
  historical_diff_hashes: text({ mode: "json" }).notNull(),
  tripped: integer({ mode: "boolean" }).notNull(),
  trip_reason: text(),
  created_at: integer().notNull(),
})

export const graphEventTable = sqliteTable("graph_event", {
  id: text().primaryKey(),
  run_id: text().notNull(),
  lane_id: text().notNull(),
  sequence: integer().notNull(),
  event_type: text().notNull(),
  payload: text({ mode: "json" }).notNull(),
  created_at: integer().notNull(),
})

export type GraphEventRow = {
  id: string
  run_id: string
  lane_id: string
  sequence: number
  event_type: string
  payload: unknown
  created_at: number
}

export type LaneRow = {
  id: string
  session_id: string
  objective: string
  kind: string
  status: string
  risk: string
  created_at: number
  updated_at: number
}

export type ChecklistRunRow = {
  id: string
  lane_id: string
  checklist_id: string
  verdict: string
  items: unknown
  created_at: number
}

export type GateRow = {
  id: string
  lane_id: string
  effect: string
  payload: unknown
  options: unknown
  status: string
  resolution?: unknown
  created_at: number
  resolved_at?: number
}

export type DeviationRow = {
  id: string
  session_id: string
  lane_id?: string
  kind: string
  detail: unknown
  created_at: number
}

export type GraphRunRow = {
  id: string
  lane_id: string
  graph_id: string
  status: string
  active_node_ids: unknown
  context_envelope: unknown
  created_at: number
  updated_at: number
}

export type NodeExecutionRow = {
  id: string
  graph_run_id: string
  node_id: string
  iteration: number
  status: string
  input_payload: unknown
  output_payload?: unknown
  error_signature?: string
  diff_hash?: string
  duration_ms?: number
  created_at: number
}

export type LoopGuardRecordRow = {
  id: string
  graph_run_id: string
  edge_id: string
  cycle_count: number
  historical_error_hashes: unknown
  historical_diff_hashes: unknown
  tripped: boolean
  trip_reason?: string
  created_at: number
}

export const DDL = [
  `CREATE TABLE IF NOT EXISTS lane (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    objective TEXT NOT NULL,
    kind TEXT NOT NULL,
    status TEXT NOT NULL,
    risk TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS checklist_run (
    id TEXT PRIMARY KEY,
    lane_id TEXT NOT NULL,
    checklist_id TEXT NOT NULL,
    verdict TEXT NOT NULL,
    items TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS gate (
    id TEXT PRIMARY KEY,
    lane_id TEXT NOT NULL,
    effect TEXT NOT NULL,
    payload TEXT NOT NULL,
    options TEXT NOT NULL,
    status TEXT NOT NULL,
    resolution TEXT,
    created_at INTEGER NOT NULL,
    resolved_at INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS deviation (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    lane_id TEXT,
    kind TEXT NOT NULL,
    detail TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS graph_run (
    id TEXT PRIMARY KEY,
    lane_id TEXT NOT NULL,
    graph_id TEXT NOT NULL,
    status TEXT NOT NULL,
    active_node_ids TEXT NOT NULL,
    context_envelope TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS node_execution (
    id TEXT PRIMARY KEY,
    graph_run_id TEXT NOT NULL,
    node_id TEXT NOT NULL,
    iteration INTEGER NOT NULL,
    status TEXT NOT NULL,
    input_payload TEXT NOT NULL,
    output_payload TEXT,
    error_signature TEXT,
    diff_hash TEXT,
    duration_ms INTEGER,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS loop_guard_record (
    id TEXT PRIMARY KEY,
    graph_run_id TEXT NOT NULL,
    edge_id TEXT NOT NULL,
    cycle_count INTEGER NOT NULL,
    historical_error_hashes TEXT NOT NULL,
    historical_diff_hashes TEXT NOT NULL,
    tripped INTEGER NOT NULL DEFAULT 0,
    trip_reason TEXT,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS graph_event (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    lane_id TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
]

let sqliteInstance: Database | null = null

function safeJsonEncode(value: unknown): string {
  if (value === undefined || value === null) return "null"
  return JSON.stringify(value)
}

function safeJsonDecode<T = unknown>(value: unknown): T {
  if (typeof value !== "string") return value as T
  try {
    return JSON.parse(value) as T
  } catch {
    return value as T
  }
}

export function getSqliteDb(filePath = ":memory:"): Database {
  if (!sqliteInstance) {
    sqliteInstance = new Database(filePath)
    sqliteInstance.run("PRAGMA journal_mode = WAL;")
    for (const statement of DDL) {
      sqliteInstance.run(statement)
    }
  }
  return sqliteInstance
}

export function resetStore() {
  const db = getSqliteDb()
  db.run("DELETE FROM lane")
  db.run("DELETE FROM checklist_run")
  db.run("DELETE FROM gate")
  db.run("DELETE FROM deviation")
  db.run("DELETE FROM graph_run")
  db.run("DELETE FROM node_execution")
  db.run("DELETE FROM loop_guard_record")
  db.run("DELETE FROM graph_event")
}

export function insertLane(row: LaneRow): LaneRow {
  const db = getSqliteDb()
  db.run(
    `INSERT OR REPLACE INTO lane (id, session_id, objective, kind, status, risk, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [row.id, row.session_id, row.objective, row.kind, row.status, row.risk, row.created_at, row.updated_at],
  )
  return row
}

export function updateLane(id: string, updates: Partial<Omit<LaneRow, "id">>): LaneRow | undefined {
  const existing = getLane(id)
  if (!existing) return undefined
  const updated: LaneRow = {
    ...existing,
    ...updates,
    updated_at: updates.updated_at ?? Date.now(),
  }
  const db = getSqliteDb()
  db.run(
    `UPDATE lane SET session_id = ?, objective = ?, kind = ?, status = ?, risk = ?, created_at = ?, updated_at = ? WHERE id = ?`,
    [updated.session_id, updated.objective, updated.kind, updated.status, updated.risk, updated.created_at, updated.updated_at, id],
  )
  return updated
}

export function getLane(id: string): LaneRow | undefined {
  const db = getSqliteDb()
  const row = db.query("SELECT * FROM lane WHERE id = ?").get(id) as LaneRow | null
  return row ?? undefined
}

export function listLanes(sessionID?: string): LaneRow[] {
  const db = getSqliteDb()
  if (sessionID) {
    return db.query("SELECT * FROM lane WHERE session_id = ?").all(sessionID) as LaneRow[]
  }
  return db.query("SELECT * FROM lane").all() as LaneRow[]
}

export function insertChecklistRun(row: ChecklistRunRow): ChecklistRunRow {
  const db = getSqliteDb()
  db.run(
    `INSERT OR REPLACE INTO checklist_run (id, lane_id, checklist_id, verdict, items, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [
      row.id,
      row.lane_id,
      row.checklist_id,
      row.verdict,
      safeJsonEncode(row.items),
      row.created_at,
    ],
  )
  return row
}

export function getChecklistRun(id: string): ChecklistRunRow | undefined {
  const db = getSqliteDb()
  const row = db.query("SELECT * FROM checklist_run WHERE id = ?").get(id) as any
  if (!row) return undefined
  return {
    ...row,
    items: safeJsonDecode(row.items),
  }
}

export function listChecklistRuns(laneID?: string): ChecklistRunRow[] {
  const db = getSqliteDb()
  const rows = (laneID
    ? db.query("SELECT * FROM checklist_run WHERE lane_id = ?").all(laneID)
    : db.query("SELECT * FROM checklist_run").all()) as any[]
  return rows.map((row) => ({
    ...row,
    items: safeJsonDecode(row.items),
  }))
}

export function insertGate(row: GateRow): GateRow {
  const db = getSqliteDb()
  db.run(
    `INSERT OR REPLACE INTO gate (id, lane_id, effect, payload, options, status, resolution, created_at, resolved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id,
      row.lane_id,
      row.effect,
      safeJsonEncode(row.payload),
      safeJsonEncode(row.options),
      row.status,
      row.resolution ? safeJsonEncode(row.resolution) : null,
      row.created_at,
      row.resolved_at ?? null,
    ],
  )
  return row
}

export function updateGate(id: string, updates: Partial<Omit<GateRow, "id">>): GateRow | undefined {
  const existing = getGate(id)
  if (!existing) return undefined
  const updated: GateRow = {
    ...existing,
    ...updates,
  }
  const db = getSqliteDb()
  db.run(
    `UPDATE gate SET lane_id = ?, effect = ?, payload = ?, options = ?, status = ?, resolution = ?, created_at = ?, resolved_at = ? WHERE id = ?`,
    [
      updated.lane_id,
      updated.effect,
      safeJsonEncode(updated.payload),
      safeJsonEncode(updated.options),
      updated.status,
      updated.resolution ? safeJsonEncode(updated.resolution) : null,
      updated.created_at,
      updated.resolved_at ?? null,
      id,
    ],
  )
  return updated
}

export function getGate(id: string): GateRow | undefined {
  const db = getSqliteDb()
  const row = db.query("SELECT * FROM gate WHERE id = ?").get(id) as any
  if (!row) return undefined
  return {
    ...row,
    payload: safeJsonDecode(row.payload),
    options: safeJsonDecode(row.options),
    resolution: row.resolution ? safeJsonDecode(row.resolution) : undefined,
  }
}

export function listGates(laneID?: string): GateRow[] {
  const db = getSqliteDb()
  const rows = (laneID
    ? db.query("SELECT * FROM gate WHERE lane_id = ?").all(laneID)
    : db.query("SELECT * FROM gate").all()) as any[]
  return rows.map((row) => ({
    ...row,
    payload: safeJsonDecode(row.payload),
    options: safeJsonDecode(row.options),
    resolution: row.resolution ? safeJsonDecode(row.resolution) : undefined,
  }))
}

export function insertDeviation(row: DeviationRow): DeviationRow {
  const db = getSqliteDb()
  db.run(
    `INSERT INTO deviation (id, session_id, lane_id, kind, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [
      row.id,
      row.session_id,
      row.lane_id ?? null,
      row.kind,
      safeJsonEncode(row.detail),
      row.created_at,
    ],
  )
  return row
}

export function listDeviations(sessionID?: string, laneID?: string): DeviationRow[] {
  const db = getSqliteDb()
  let sql = "SELECT * FROM deviation WHERE 1=1"
  const params: any[] = []
  if (sessionID) {
    sql += " AND session_id = ?"
    params.push(sessionID)
  }
  if (laneID) {
    sql += " AND lane_id = ?"
    params.push(laneID)
  }
  const rows = db.query(sql).all(...params) as any[]
  return rows.map((row) => ({
    ...row,
    detail: safeJsonDecode(row.detail),
  }))
}

export function insertGraphRun(row: GraphRunRow): GraphRunRow {
  const db = getSqliteDb()
  db.run(
    `INSERT OR REPLACE INTO graph_run (id, lane_id, graph_id, status, active_node_ids, context_envelope, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id,
      row.lane_id,
      row.graph_id,
      row.status,
      safeJsonEncode(row.active_node_ids),
      safeJsonEncode(row.context_envelope),
      row.created_at,
      row.updated_at,
    ],
  )
  return row
}

export function updateGraphRun(id: string, updates: Partial<Omit<GraphRunRow, "id">>): GraphRunRow | undefined {
  const existing = getGraphRun(id)
  if (!existing) return undefined
  const updated: GraphRunRow = {
    ...existing,
    ...updates,
    updated_at: updates.updated_at ?? Date.now(),
  }
  const db = getSqliteDb()
  db.run(
    `UPDATE graph_run SET lane_id = ?, graph_id = ?, status = ?, active_node_ids = ?, context_envelope = ?, created_at = ?, updated_at = ? WHERE id = ?`,
    [
      updated.lane_id,
      updated.graph_id,
      updated.status,
      safeJsonEncode(updated.active_node_ids),
      safeJsonEncode(updated.context_envelope),
      updated.created_at,
      updated.updated_at,
      id,
    ],
  )
  return updated
}

export function getGraphRun(id: string): GraphRunRow | undefined {
  const db = getSqliteDb()
  const row = db.query("SELECT * FROM graph_run WHERE id = ?").get(id) as any
  if (!row) return undefined
  return {
    ...row,
    active_node_ids: safeJsonDecode(row.active_node_ids),
    context_envelope: safeJsonDecode(row.context_envelope),
  }
}

export function listGraphRuns(laneID?: string): GraphRunRow[] {
  const db = getSqliteDb()
  const rows = (laneID
    ? db.query("SELECT * FROM graph_run WHERE lane_id = ?").all(laneID)
    : db.query("SELECT * FROM graph_run").all()) as any[]
  return rows.map((row) => ({
    ...row,
    active_node_ids: safeJsonDecode(row.active_node_ids),
    context_envelope: safeJsonDecode(row.context_envelope),
  }))
}

export function insertNodeExecution(row: NodeExecutionRow): NodeExecutionRow {
  const db = getSqliteDb()
  db.run(
    `INSERT INTO node_execution (id, graph_run_id, node_id, iteration, status, input_payload, output_payload, error_signature, diff_hash, duration_ms, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id,
      row.graph_run_id,
      row.node_id,
      row.iteration,
      row.status,
      safeJsonEncode(row.input_payload),
      row.output_payload !== undefined ? safeJsonEncode(row.output_payload) : null,
      row.error_signature ?? null,
      row.diff_hash ?? null,
      row.duration_ms ?? null,
      row.created_at,
    ],
  )
  return row
}

export function listNodeExecutions(graphRunID?: string): NodeExecutionRow[] {
  const db = getSqliteDb()
  const rows = (graphRunID
    ? db.query("SELECT * FROM node_execution WHERE graph_run_id = ?").all(graphRunID)
    : db.query("SELECT * FROM node_execution").all()) as any[]
  return rows.map((row) => ({
    ...row,
    input_payload: safeJsonDecode(row.input_payload),
    output_payload: row.output_payload ? safeJsonDecode(row.output_payload) : undefined,
  }))
}

export function insertLoopGuardRecord(row: LoopGuardRecordRow): LoopGuardRecordRow {
  const db = getSqliteDb()
  db.run(
    `INSERT INTO loop_guard_record (id, graph_run_id, edge_id, cycle_count, historical_error_hashes, historical_diff_hashes, tripped, trip_reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id,
      row.graph_run_id,
      row.edge_id,
      row.cycle_count,
      safeJsonEncode(row.historical_error_hashes),
      safeJsonEncode(row.historical_diff_hashes),
      row.tripped ? 1 : 0,
      row.trip_reason ?? null,
      row.created_at,
    ],
  )
  return row
}

export function getLoopGuardRecord(id: string): LoopGuardRecordRow | undefined {
  const db = getSqliteDb()
  const row = db.query("SELECT * FROM loop_guard_record WHERE id = ?").get(id) as any
  if (!row) return undefined
  return {
    ...row,
    historical_error_hashes: safeJsonDecode(row.historical_error_hashes),
    historical_diff_hashes: safeJsonDecode(row.historical_diff_hashes),
    tripped: Boolean(row.tripped),
  }
}

export function listLoopGuardRecords(graphRunID?: string): LoopGuardRecordRow[] {
  const db = getSqliteDb()
  const rows = (graphRunID
    ? db.query("SELECT * FROM loop_guard_record WHERE graph_run_id = ?").all(graphRunID)
    : db.query("SELECT * FROM loop_guard_record").all()) as any[]
  return rows.map((row) => ({
    ...row,
    historical_error_hashes: safeJsonDecode(row.historical_error_hashes),
    historical_diff_hashes: safeJsonDecode(row.historical_diff_hashes),
    tripped: Boolean(row.tripped),
  }))
}

export function insertGraphEvent(row: GraphEventRow): void {
  const db = getSqliteDb()
  db.run(
    `INSERT INTO graph_event (id, run_id, lane_id, sequence, event_type, payload, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [row.id, row.run_id, row.lane_id, row.sequence, row.event_type, safeJsonEncode(row.payload), row.created_at],
  )
}

export function listGraphEvents(runId: string): GraphEventRow[] {
  const db = getSqliteDb()
  const rows = db.query(`SELECT * FROM graph_event WHERE run_id = ? ORDER BY sequence ASC`).all(runId) as any[]
  return rows.map((r) => ({
    id: r.id,
    run_id: r.run_id,
    lane_id: r.lane_id,
    sequence: r.sequence,
    event_type: r.event_type,
    payload: safeJsonDecode(r.payload),
    created_at: r.created_at,
  }))
}

export * as Db from "./db"
