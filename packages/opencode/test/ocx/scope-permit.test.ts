import { describe, expect, test } from "bun:test"
import { ScopePermit } from "../../src/ocx/scope-permit"

const CWD = "/workspace/project-tests"

describe("scope-permit", () => {
  test("mints roots from work-only-inside directives", () => {
    const permit = ScopePermit.mintFromDirectives(
      ["Work only inside: thinkingmachines-inkling-free-max/web-design/", "Create the directory if needed."],
      CWD,
    )
    expect(permit?.roots).toEqual(["/workspace/project-tests/thinkingmachines-inkling-free-max/web-design"])
    expect(permit?.grantedBy).toBe("user-directive")
  })

  test("grants stock-photo network read when downloads are ordered", () => {
    const permit = ScopePermit.mintFromDirectives(
      ["Work only inside: model/web-design", "Download required resources."],
      CWD,
    )
    expect(permit?.networkRead).toContain("images.unsplash.com")
  })

  test("no scope directive means no permit", () => {
    expect(ScopePermit.mintFromDirectives(["Fix the bug in src/main.ts"], CWD)).toBeUndefined()
  })

  test("allows nested paths and rejects escapes", () => {
    const permit = ScopePermit.mintFromDirectives(["Work only inside: model/web-design"], CWD)!
    expect(ScopePermit.isPathAllowed(`${CWD}/model/web-design/assets/images/hero.jpg`, permit, CWD)).toBe(true)
    expect(ScopePermit.isPathAllowed(`${CWD}/model/other/file.txt`, permit, CWD)).toBe(false)
    expect(ScopePermit.isPathAllowed(`${CWD}/model/web-design-evil/file.txt`, permit, CWD)).toBe(false)
    expect(ScopePermit.isPathAllowed(`${CWD}/model/web-design/../escape.txt`, permit, CWD)).toBe(false)
  })

  test("tmp outputs are recognized", () => {
    expect(ScopePermit.isTmpOutput("/tmp/screenshot_hero.png")).toBe(true)
    expect(ScopePermit.isTmpOutput("/workspace/project-tests/index.html")).toBe(false)
  })

  test("redirect targets are extracted", () => {
    expect(ScopePermit.redirectTargets("python3 -m http.server 8765 > /tmp/http_server.log 2>&1")).toEqual([
      "/tmp/http_server.log",
    ])
    expect(ScopePermit.redirectTargets("ls -la")).toEqual([])
  })
})
