// Renders a summary table from an eval results directory written by run.ts.
// Usage: bun run script/eval/report.ts [--results /tmp/ocx/eval/results]
import { readdir } from "node:fs/promises"
import path from "path"

const args = parseArgs(process.argv.slice(2))
const resultsDir = typeof args.results === "string" ? args.results : "/tmp/ocx/eval/results"

const entries = (await readdir(resultsDir)).filter((entry) => entry.endsWith(".json") && entry !== "summary.json")
if (entries.length === 0) {
  console.error(`no result files in ${resultsDir}`)
  process.exit(1)
}

const rows = []
for (const entry of entries.toSorted()) {
  const raw = await Bun.file(path.join(resultsDir, entry)).json()
  rows.push({
    id: str(raw.id),
    mode: str(raw.mode),
    validate: raw.validateOk === true ? "ok" : "FAIL",
    after: raw.mode === "live" ? (raw.oracleAfterOk === true ? "pass" : "fail") : "-",
    seconds: (Number(raw.durationMs) / 1000).toFixed(1),
    error: str(raw.error),
  })
}

const idWidth = Math.max(...rows.map((row) => row.id.length), 2)
console.log(`${"task".padEnd(idWidth)}  mode      validate  after  seconds  error`)
for (const row of rows) {
  console.log(
    `${row.id.padEnd(idWidth)}  ${row.mode.padEnd(9)}  ${row.validate.padEnd(8)}  ${row.after.padEnd(5)}  ${row.seconds.padStart(7)}  ${row.error}`,
  )
}

const validated = rows.filter((row) => row.validate === "ok").length
console.log(`\ntasks=${rows.length} validated=${validated} live-pass=${rows.filter((row) => row.after === "pass").length}`)

function parseArgs(argv: string[]) {
  const parsed: Record<string, string | boolean> = {}
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

function str(value: unknown) {
  return typeof value === "string" ? value : ""
}
