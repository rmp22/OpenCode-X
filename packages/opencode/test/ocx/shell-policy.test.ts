import { describe, expect, test } from "bun:test"
import { ShellPolicy } from "../../src/ocx/shell-policy"

const cwd = "/repo"

describe("shell policy", () => {
  test("allows repository search commands (rg, grep, find, fd, git grep)", () => {
    expect(ShellPolicy.check("grep -n token src/auth.ts", cwd)).toBeUndefined()
    expect(ShellPolicy.check("printf '%s\\n' x | grep x", cwd)).toBeUndefined()
    expect(ShellPolicy.check("find . -name '*.ts'", cwd)).toBeUndefined()
    expect(ShellPolicy.check("git grep token", cwd)).toBeUndefined()
    expect(ShellPolicy.check("rg token src", cwd)).toBeUndefined()
    expect(ShellPolicy.check("rg --count token src", cwd)).toBeUndefined()
    expect(ShellPolicy.check("rg --multiline 'a.b' src", cwd)).toBeUndefined()
    expect(ShellPolicy.check('grep -c "section" index.html', cwd)).toBeUndefined()
    expect(ShellPolicy.check('grep --count "section" index.html', cwd)).toBeUndefined()
  })

  test("rejects shell echo/cat used to output assistant responses", () => {
    expect(ShellPolicy.check('echo "PHASE: apply\\nSTATE: done"', cwd)?.rule).toBe("shell-output")
    expect(ShellPolicy.check("cat << 'EOF'\\nPHASE: apply\\nSTATE: done\\nEOF", cwd)?.rule).toBe("shell-output")
  })

  test("rejects redirection into the project", () => {
    expect(ShellPolicy.check("cat >> README.md", cwd)?.rule).toBe("repo-redirection")
    expect(ShellPolicy.check("printf x > ./src/file.ts", cwd)?.rule).toBe("repo-redirection")
  })

  test("allows temporary output and quoted search text", () => {
    expect(ShellPolicy.check("cat > /tmp/output.txt", cwd)).toBeUndefined()
    expect(ShellPolicy.check('printf "%s" "grep token"', cwd)).toBeUndefined()
  })

  test("finds repository and external writes while ignoring null sinks", () => {
    const cwd = "/repo"
    expect(ShellPolicy.writeTargetAnalysis("curl -L https://example.test/a.jpg -o assets/a.jpg", cwd)).toEqual({
      targets: ["/repo/assets/a.jpg"],
      unresolved: false,
    })
    expect(ShellPolicy.writeTargets("printf x > index.html", cwd)).toContain("/repo/index.html")
    expect(ShellPolicy.writeTargets("curl -O https://example.test/hero.jpg", cwd)).toContain("/repo/hero.jpg")
    expect(ShellPolicy.writeTargets("wget -P assets https://example.test/hero.jpg", cwd)).toContain(
      "/repo/assets/hero.jpg",
    )
    expect(ShellPolicy.writeTargets("ls -la 2>/dev/null", cwd)).toEqual([])
    expect(ShellPolicy.writeTargets("printf x > /tmp/output.txt", cwd)).toEqual(["/tmp/output.txt"])
  })

  test("detects interpreter writes and unresolved dynamic targets", () => {
    const cwd = "/repo"
    expect(
      ShellPolicy.writeTargets("python3 << 'PY'\nopen('assets/generated.txt', 'w').write('x')\nPY", cwd),
    ).toContain("/repo/assets/generated.txt")
    expect(
      ShellPolicy.writeTargets("node -e 'require(\"fs\").writeFileSync(\"src/generated.ts\", \"x\")'", cwd),
    ).toContain("/repo/src/generated.ts")
    expect(
      ShellPolicy.writeTargets("python3 -c \"import urllib.request; urllib.request.urlretrieve(url, 'assets/hero.jpg')\"", cwd),
    ).toContain("/repo/assets/hero.jpg")
    expect(ShellPolicy.writeTargetAnalysis("python3 -c \"open(target, 'w').write('x')\"", cwd).unresolved).toBe(true)
    expect(ShellPolicy.classifyEffects("curl -L https://example.test/a.jpg -o assets/a.jpg").effects).toContain(
      "FILESYSTEM_WRITE",
    )
  })

  test("classifies test commands without marking them as ambiguous", () => {
    expect(ShellPolicy.classifyEffects("pytest").ambiguous).toBe(false)
    expect(ShellPolicy.classifyEffects("pytest -k test_gesture").ambiguous).toBe(false)
    expect(ShellPolicy.classifyEffects("bun test").ambiguous).toBe(false)
    expect(ShellPolicy.classifyEffects("npm test").ambiguous).toBe(false)
  })
})
