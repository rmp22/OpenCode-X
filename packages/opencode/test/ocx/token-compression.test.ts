import { describe, expect, test } from "bun:test"
import { TokenCompression } from "../../src/ocx/token-compression"

describe("TokenCompression", () => {
  test("compresses long output with head and tail preservation", () => {
    const lines = Array.from({ length: 200 }, (_, i) => `Log line ${i + 1}: processing step data`)
    const raw = lines.join("\n")
    const compressed = TokenCompression.compressToolOutput(raw, { maxOutputLines: 100 })

    expect(compressed.length).toBeLessThan(raw.length)
    expect(compressed).toContain("Log line 1:")
    expect(compressed).toContain("Log line 25:")
    expect(compressed).toContain("omitted to conserve tokens")
    expect(compressed).toContain("Log line 200:")
  })

  test("does not truncate short output", () => {
    const raw = "Short terminal output\nEverything OK"
    expect(TokenCompression.compressToolOutput(raw)).toBe(raw)
  })

  test("compresses absolute path into workspace relative path", () => {
    const root = "/workspace/my-project"
    const file = "/workspace/my-project/src/core/auth.ts"
    expect(TokenCompression.compressPath(file, root)).toBe("./src/core/auth.ts")
  })

  test("leaves external path untouched", () => {
    const root = "/workspace/my-project"
    const file = "/etc/systemd/system/app.service"
    expect(TokenCompression.compressPath(file, root)).toBe(file)
  })

  test("collapses excessive whitespace and blank lines", () => {
    const raw = "word1     word2\n\n\n\n\n\nword3"
    const collapsed = TokenCompression.collapseWhitespace(raw)
    expect(collapsed).toBe("word1  word2\n\nword3")
  })

  test("generates compact semantic summaries of historical tool calls", () => {
    const readHandle = TokenCompression.summarizeToolOutputForHistory("read", { filePath: "src/auth.ts" }, "line1\nline2\nline3")
    expect(readHandle).toBe("[Read: 'src/auth.ts' (3 lines)]")

    const bashHandle = TokenCompression.summarizeToolOutputForHistory("bash", { command: "mkdir -p assets/images" }, "directories created")
    expect(bashHandle).toBe("[Ran: 'mkdir -p assets/images' -> success]")

    const globHandle = TokenCompression.summarizeToolOutputForHistory("glob", { pattern: "*.ts" }, "a.ts\nb.ts")
    expect(globHandle).toBe("[Glob: '*.ts' -> 2 match(es)]")
  })

  test("compresses and expands session variables and key aliases", () => {
    const sessionID = "ses_terminology_test"
    const cwd = "/workspace/test-design/my-model/web-design"
    TokenCompression.initSession({ sessionID, cwd })

    const fullPath = `${cwd}/assets/images/hero.jpg`
    const compressed = TokenCompression.compressString(sessionID, fullPath)
    expect(compressed).toBe("$WD/assets/images/hero.jpg")

    const expanded = TokenCompression.expandString(sessionID, compressed)
    expect(expanded).toBe(fullPath)

    const fullJson = {
      filePath: fullPath,
      reference_path: `${cwd}/src/auth.ts`,
      command: "ls -la",
    }
    const compressedObj = TokenCompression.compressJson(sessionID, fullJson) as Record<string, string>
    expect(compressedObj.fp).toBe("$WD/assets/images/hero.jpg")
    expect(compressedObj.rp).toBe("$WD/src/auth.ts")
    expect(compressedObj.cmd).toBe("ls -la")

    const expandedObj = TokenCompression.expandJson(sessionID, compressedObj) as Record<string, string>
    expect(expandedObj.filePath).toBe(fullPath)
    expect(expandedObj.reference_path).toBe(`${cwd}/src/auth.ts`)
    expect(expandedObj.command).toBe("ls -la")

    const savings = TokenCompression.getSavings(sessionID)
    expect(savings.savedChars).toBeGreaterThan(0)
    expect(savings.estimatedTokensSaved).toBeGreaterThan(0)

    const header = TokenCompression.renderTerminologyHeader(sessionID)
    expect(header).toContain("=== OCX SESSION TERMINOLOGY (TOKEN COMPRESSION) ===")
    expect(header).toContain("$" + "WD=/workspace/test-design/my-model/web-design")
    expect(header).toContain("Token reduction in effect:")
  })

  test("handles short key aliases and $PselfPth variable expansions", () => {
    const sessionID = "ses_test_short_keys"
    const cwd = "/workspace/project"
    TokenCompression.initSession({ sessionID, cwd })

    const inputWithShortKeys = {
      cmd: "ls -la",
      pln: "goal=Create tech landing page\nworkstream=design\nstep=1",
      wrpr: "goal=Create tech landing page\n  step=Plan design",
      fPth: "$PselfPth/package.json",
    }

    const expanded = TokenCompression.expandJson(sessionID, inputWithShortKeys) as Record<string, string>
    expect(expanded.command).toBe("ls -la")
    expect(expanded.plan).toBe("goal=Create tech landing page\nworkstream=design\nstep=1")
    expect(expanded.wrapper).toBe("goal=Create tech landing page\n  step=Plan design")
    expect(expanded.filePath).toBe(`${cwd}/package.json`)

    const compressed = TokenCompression.compressJson(sessionID, {
      command: "ls -la",
      plan: "goal=Create tech landing page",
      wrapper: "step=Plan design",
      filePath: `${cwd}/package.json`,
    }) as Record<string, string>

    expect(compressed.cmd).toBe("ls -la")
    expect(compressed.pln).toBe("goal=Create tech landing page")
    expect(compressed.wrpr).toBe("step=Plan design")
    expect(compressed.fPth).toBe("$" + "WD/package.json")
  })
})
