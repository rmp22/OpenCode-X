import { describe, expect, test } from "bun:test"
import { PathConstraint } from "../../../src/ocx/scope/path-constraint"
import { ShellPolicy } from "../../../src/ocx/shell-policy"

const workdir = "/work/project"

const messages = (text: string) =>
  [
    {
      info: { role: "user", id: "user", time: { created: 1 } },
      parts: [{ type: "text", text }],
    },
  ] as never

describe("OCX path constraints", () => {
  test("compiles the cwd-only read request", () => {
    const constraints = PathConstraint.fromMessages(messages("Do not read anything outside the working directory."), workdir)
    expect(constraints).toEqual([{ operation: "read", root: workdir, allowOutside: false, source: "user" }])
  })

  test("blocks outside reads and allows paths inside cwd", () => {
    const constraints = PathConstraint.compile("Do not read anything outside the working directory.", workdir)
    expect(PathConstraint.authorize(constraints, "read", "/tmp/helper.py")?.allowed).toBe(false)
    expect(PathConstraint.authorize(constraints, "read", `${workdir}/src/file.ts`)?.allowed).toBe(true)
    expect(PathConstraint.authorize(constraints, "execute", "/tmp")?.allowed).toBe(false)
    expect(PathConstraint.authorize(constraints, "write", "/tmp/output.txt")).toBeUndefined()
  })

  test("finds shell reads of outside files and generated helpers", () => {
    expect(ShellPolicy.readTargets("cat /etc/hosts", workdir)).toContain("/etc/hosts")
    expect(ShellPolicy.readTargets("python3 /tmp/helper.py", workdir)).toContain("/tmp/helper.py")
    expect(ShellPolicy.readTargets("python3 -c \"open('/etc/hosts', 'r').read()\"", workdir)).toContain("/etc/hosts")
    expect(ShellPolicy.readTargets("python3 -c \"print(1)\"", workdir)).toEqual([])
  })

  test("does not compile a restriction from unrelated wording", () => {
    expect(PathConstraint.compile("Read the working directory and inspect the parent.", workdir)).toEqual([])
  })
  test("blocked recovery tells weak models not to probe alternate outside roots", () => {
    const constraints = PathConstraint.compile("Do not read anything outside the working directory.", workdir)
    const decision = PathConstraint.authorize(constraints, "read", "/home/user/AGENTS.md")!
    const output = PathConstraint.renderBlocked(decision)
    expect(output).toContain("Do not retry with a different parent, home, global config, or temporary path")
    expect(output).toContain("treat them as unavailable")
  })

  test("compiles write restrictions alongside read restrictions", () => {
    expect(PathConstraint.compile("Do not write anything outside the working directory.", workdir)).toEqual([
      { operation: "write", root: workdir, allowOutside: false, source: "user" },
    ])
    expect(PathConstraint.compile("Never modify files outside the working directory.", workdir)).toEqual([
      { operation: "write", root: workdir, allowOutside: false, source: "user" },
    ])
    expect(PathConstraint.compile("Do not read or write anything outside the working directory.", workdir)).toEqual([
      { operation: "read", root: workdir, allowOutside: false, source: "user" },
      { operation: "write", root: workdir, allowOutside: false, source: "user" },
    ])
  })

  test("compiles inside-the-working-directory restrictions", () => {
    expect(PathConstraint.compile("Only edit files inside the working directory.", workdir)).toEqual([
      { operation: "write", root: workdir, allowOutside: false, source: "user" },
    ])
    expect(PathConstraint.compile("You can only read files inside the working directory.", workdir)).toEqual([
      { operation: "read", root: workdir, allowOutside: false, source: "user" },
    ])
    expect(PathConstraint.compile("Look inside the working directory for the config file.", workdir)).toEqual([])
  })

  test("authorizes write operations against write constraints only", () => {
    const constraints = PathConstraint.compile("Do not write anything outside the working directory.", workdir)
    expect(PathConstraint.authorize(constraints, "write", "/tmp/output.txt")?.allowed).toBe(false)
    expect(PathConstraint.authorize(constraints, "write", `${workdir}/src/file.ts`)?.allowed).toBe(true)
    expect(PathConstraint.authorize(constraints, "read", "/tmp/output.txt")).toBeUndefined()
    expect(PathConstraint.authorize(constraints, "execute", "/tmp/output.txt")).toBeUndefined()
  })

})
