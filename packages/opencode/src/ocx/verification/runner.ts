export type CheckStatus = "UNTESTED" | "PASS" | "FAIL" | "TIMEOUT"

export interface CheckExecutionResult {
  readonly command: string
  readonly status: CheckStatus
  readonly exitCode: number | null
  readonly stdout: string
  readonly stderr: string
  readonly durationMs: number
  readonly error?: string
}

export interface RunCheckOptions {
  readonly cwd?: string
  readonly timeoutMs?: number
  readonly env?: Record<string, string>
}

export async function runCheck(
  command: string,
  options: RunCheckOptions = {},
): Promise<CheckExecutionResult> {
  const start = Date.now()
  const timeoutMs = options.timeoutMs ?? 30000

  const shellCommand = ["bash", "-c", command]

  try {
    const proc = Bun.spawn(shellCommand, {
      cwd: options.cwd,
      stdout: "pipe",
      stderr: "pipe",
      env: options.env ? { ...process.env, ...options.env } : process.env,
    })

    let timedOut = false
    const timeoutHandle = setTimeout(() => {
      timedOut = true
      proc.kill()
    }, timeoutMs)

    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ])

    const exitCode = await proc.exited
    clearTimeout(timeoutHandle)

    const durationMs = Date.now() - start

    if (timedOut) {
      const timeoutRes: CheckExecutionResult = {
        command,
        status: "TIMEOUT",
        exitCode: null,
        stdout,
        stderr: stderr || "Execution timed out",
        durationMs,
        error: `Timed out after ${timeoutMs}ms`,
      }
      return timeoutRes
    }

    const status: CheckStatus = exitCode === 0 ? "PASS" : "FAIL"
    const result: CheckExecutionResult = {
      command,
      status,
      exitCode,
      stdout,
      stderr,
      durationMs,
    }
    return result
  } catch (err: unknown) {
    const durationMs = Date.now() - start
    const errorMsg = err instanceof Error ? err.message : String(err)
    const errorRes: CheckExecutionResult = {
      command,
      status: "FAIL",
      exitCode: null,
      stdout: "",
      stderr: errorMsg,
      durationMs,
      error: errorMsg,
    }
    return errorRes
  }
}

export async function runChecks(
  commands: readonly string[],
  options: RunCheckOptions = {},
): Promise<readonly CheckExecutionResult[]> {
  const results: CheckExecutionResult[] = []
  for (const command of commands) {
    const res = await runCheck(command, options)
    results.push(res)
    if (res.status !== "PASS") {
      break
    }
  }
  return results
}

export * as VerificationRunner from "./runner"
