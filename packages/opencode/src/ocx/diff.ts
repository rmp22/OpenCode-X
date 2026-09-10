import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { join } from "node:path"

export function addedLines(paths: readonly string[], cwd: string): Map<string, string[]> {
  const out = new Map<string, string[]>()
  if (paths.length === 0) return out
  for (const path of paths) {
    const proc = spawnSync("git", ["diff", "HEAD", "-U0", "--", path], { cwd, encoding: "utf8" })
    if (proc.status !== 0 || !proc.stdout) {
      const status = spawnSync("git", ["status", "--short", "--untracked-files=all", "--", path], { cwd, encoding: "utf8" })
      if (!/^(?:\?\?|A\s)/.test(status.stdout?.trim() ?? "")) continue
      const absolutePath = path.startsWith("/") ? path : join(cwd, path)
      let content: string
      try {
        content = readFileSync(absolutePath, "utf8")
      } catch {
        continue
      }
      if (content.length > 0) out.set(path, content.split("\n"))
      continue
    }
    const lines: string[] = []
    let inHunk = false
    for (const line of proc.stdout.split("\n")) {
      if (line.startsWith("@@")) {
        inHunk = true
        continue
      }
      if (!inHunk) continue
      if (line.startsWith("+") && !line.startsWith("+++")) lines.push(line.slice(1))
    }
    if (lines.length > 0) out.set(path, lines)
  }
  return out
}

export * as Diff from "./diff"
