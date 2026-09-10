import { readdir } from "node:fs/promises"
import path from "path"

export type EvalTask = {
  id: string
  base: string
  fix: string
  testPaths: string[]
  oracle: string[]
  oracleCwd: string
  timeoutMs: number
  prompt: string
}

const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/
const SHA_PATTERN = /^[0-9a-f]{7,40}$/

export function patchPath(tasksDir: string, id: string) {
  return path.join(tasksDir, "patches", `${id}.patch`)
}

export async function loadTasks(tasksDir: string): Promise<EvalTask[]> {
  const entries = await readdir(tasksDir)
  const files = entries.filter((entry) => entry.endsWith(".json")).toSorted()
  const tasks = []
  for (const file of files) tasks.push(await readTask(path.join(tasksDir, file)))
  const ids = new Set<string>()
  for (const task of tasks) {
    if (ids.has(task.id)) throw new Error(`duplicate eval task id ${task.id}`)
    ids.add(task.id)
  }
  return tasks
}

async function readTask(file: string): Promise<EvalTask> {
  const raw: unknown = await Bun.file(file).json()
  if (!isRecord(raw)) throw new Error(`${file}: task must be a JSON object`)
  const id = str(raw.id)
  if (!id || !ID_PATTERN.test(id)) throw new Error(`${file}: bad id`)
  if (!isSha(raw.base)) throw new Error(`${file}: bad base sha`)
  if (!isSha(raw.fix)) throw new Error(`${file}: bad fix sha`)
  if (!isStrArray(raw.testPaths) || raw.testPaths.length === 0) throw new Error(`${file}: bad testPaths`)
  if (!isStrArray(raw.oracle) || raw.oracle.length === 0) throw new Error(`${file}: bad oracle`)
  const oracleCwd = str(raw.oracleCwd)
  if (!oracleCwd) throw new Error(`${file}: bad oracleCwd`)
  if (typeof raw.timeoutMs !== "number" || !Number.isInteger(raw.timeoutMs) || raw.timeoutMs <= 0)
    throw new Error(`${file}: bad timeoutMs`)
  const prompt = str(raw.prompt)
  if (!prompt) throw new Error(`${file}: bad prompt`)
  return {
    id,
    base: raw.base,
    fix: raw.fix,
    testPaths: raw.testPaths,
    oracle: raw.oracle,
    oracleCwd,
    timeoutMs: raw.timeoutMs,
    prompt,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isSha(value: unknown): value is string {
  return typeof value === "string" && SHA_PATTERN.test(value)
}

function isStrArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string")
}

function str(value: unknown) {
  return typeof value === "string" ? value : ""
}
