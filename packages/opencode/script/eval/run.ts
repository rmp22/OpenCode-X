// Eval harness runner for the OCX prompt stack (plan: WS0, /tmp/ocx/prompt-optimization-plan.md).
// Dry-run mode validates the plumbing without any model: fresh worktree at the
// task base commit, test patch applied, oracle must FAIL before the agent runs.
// Live mode adds one non-interactive `ocx run` turn between the two oracle runs.
// Usage: bun run script/eval/run.ts [--dry-run] [--model provider/id] [--filter id] [--keep]
import { mkdir, rm, writeFile } from "node:fs/promises"
import path from "path"
import { loadTasks, patchPath, type EvalTask } from "./task"

const PACKAGE_DIR = path.resolve(import.meta.dir, "../..")
const REPO_ROOT = path.resolve(PACKAGE_DIR, "../..")
const DEFAULT_TASKS_DIR = path.join(import.meta.dir, "tasks")
const WORKTREE_ROOT = "/tmp/ocx/eval/worktrees"
const DEFAULT_OUT_DIR = "/tmp/ocx/eval/results"

type Args = Record<string, string | boolean>

type StepResult = {
  code: number
  stdout: string
  stderr: string
  timedOut: boolean
}

type TaskResult = {
  id: string
  mode: "dry-run" | "live"
  validateOk: boolean
  agentRan: boolean
  agentExit?: number
  oracleAfterOk?: boolean
  durationMs: number
  error?: string
}

const args = parseArgs(process.argv.slice(2))
const tasksDir = str(args.tasks) || DEFAULT_TASKS_DIR
const outDir = str(args.out) || DEFAULT_OUT_DIR
const dryRun = args["dry-run"] === true
const model = str(args.model)
const filter = str(args.filter)
const keep = args.keep === true

if (!dryRun && !model) {
  console.error("live mode requires --model provider/model-id (or pass --dry-run)")
  process.exit(1)
}

await main()

async function main() {
  const tasks = await loadTasks(tasksDir)
  const selected = filter ? tasks.filter((task) => task.id === filter) : tasks
  if (selected.length === 0) {
    console.error(`no eval tasks matched filter "${filter}"`)
    process.exit(1)
  }
  await mkdir(outDir, { recursive: true })
  await mkdir(WORKTREE_ROOT, { recursive: true })

  const results: TaskResult[] = []
  for (const task of selected) {
    process.stdout.write(`eval ${task.id} ... `)
    const result = await runTask(task)
    results.push(result)
    console.log(summarize(result))
  }

  await writeFile(path.join(outDir, "summary.json"), JSON.stringify({ results }, null, 2) + "\n")

  const failed = results.filter((result) => !result.validateOk || (result.mode === "live" && !result.oracleAfterOk))
  if (failed.length > 0) {
    console.error(`eval failed for: ${failed.map((result) => result.id).join(", ")}`)
    process.exit(1)
  }
}

async function runTask(task: EvalTask): Promise<TaskResult> {
  const started = performance.now()
  const wtPath = path.join(WORKTREE_ROOT, task.id)
  const base: TaskResult = { id: task.id, mode: dryRun ? "dry-run" : "live", validateOk: false, agentRan: false, durationMs: 0 }
  try {
    await removeWorktree(wtPath)
    const added = await sh(["git", "worktree", "add", "--detach", wtPath, task.base], REPO_ROOT)
    if (added.code !== 0) throw new Error(`worktree add failed: ${added.stderr.trim()}`)
    const applied = await sh(["git", "apply", "--whitespace=nowarn", patchPath(tasksDir, task.id)], wtPath)
    if (applied.code !== 0) throw new Error(`patch apply failed: ${applied.stderr.trim()}`)

    const install = await sh(["bun", "install", "--frozen-lockfile"], wtPath)
    if (install.code !== 0) throw new Error(`bun install failed: ${install.stderr.trim()}`)

    const before = await oracle(task, wtPath)
    if (before.code === 0) throw new Error("oracle passes at base commit; task is invalid")
    base.validateOk = true

    if (!dryRun) {
      const agent = await sh(
        ["bun", path.join(PACKAGE_DIR, "bin", "ocx"), "run", "--dir", wtPath, "--model", model, task.prompt],
        wtPath,
        task.timeoutMs,
      )
      base.agentRan = true
      base.agentExit = agent.code
      if (agent.code !== 0)
        throw new Error(`ocx run exited ${agent.code}${agent.timedOut ? " (timeout)" : ""}: ${agent.stderr.trim()}`)
      const after = await oracle(task, wtPath)
      base.oracleAfterOk = after.code === 0
    }
  } catch (error) {
    base.error = error instanceof Error ? (error.stack ?? error.message) : String(error)
  } finally {
    if (!keep) await removeWorktree(wtPath)
  }
  base.durationMs = Math.round(performance.now() - started)
  await writeFile(path.join(outDir, `${task.id}.json`), JSON.stringify(base, null, 2) + "\n")
  return base
}

async function oracle(task: EvalTask, wtPath: string) {
  return sh(task.oracle, path.join(wtPath, task.oracleCwd), task.timeoutMs)
}

async function removeWorktree(wtPath: string) {
  await sh(["git", "worktree", "remove", "--force", wtPath], REPO_ROOT)
  await rm(wtPath, { recursive: true, force: true })
}

async function sh(cmd: string[], cwd: string, timeoutMs?: number): Promise<StepResult> {
  const proc = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe", env: Bun.env })
  let timedOut = false
  const timer =
    timeoutMs === undefined
      ? undefined
      : setTimeout(() => {
          timedOut = true
          proc.kill()
        }, timeoutMs)
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (timer !== undefined) clearTimeout(timer)
  return { code, stdout, stderr, timedOut }
}

function summarize(result: TaskResult) {
  const parts = [`validate=${result.validateOk ? "ok" : "FAIL"}`]
  if (result.mode === "live") parts.push(`agent=${result.oracleAfterOk ? "pass" : "fail"}`)
  if (result.error) parts.push(`error=${result.error.split("\n")[0]}`)
  return parts.join(" ")
}

function parseArgs(argv: string[]): Args {
  const parsed: Args = {}
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === undefined || !arg.startsWith("--")) continue
    const key = arg.slice(2)
    const next = argv[index + 1]
    if (next === undefined || next.startsWith("--")) {
      parsed[key] = true
    } else {
      parsed[key] = next
      index++
    }
  }
  return parsed
}

function str(value: string | boolean | undefined) {
  return typeof value === "string" ? value : ""
}
