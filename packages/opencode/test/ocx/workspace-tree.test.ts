import { describe, expect, it } from "bun:test"
import {
  createWorkspaceIdentity,
  parseAospOwners,
  parseCodeowners,
  toWorkdirRelative,
  VirtualOwnerTreeManager,
} from "../../src/ocx/owner/workspace-tree"

describe("WorkspaceTree and Ownership Discovery", () => {
  it("normalizes paths to workdir relative", () => {
    const root = "/home/user/project"
    expect(toWorkdirRelative(root, "/home/user/project/src/index.ts")).toBe("src/index.ts")
    expect(toWorkdirRelative(root, "src/components/button.tsx")).toBe("src/components/button.tsx")
    expect(toWorkdirRelative(root, "./packages/core/index.ts")).toBe("packages/core/index.ts")
  })

  it("parses AOSP OWNERS file with directives", () => {
    const content = `alice@example.com
bob@example.com
set noparent
include //build/make/OWNERS
per-file *.bp = charlie@example.com, dave@example.com
per-file *.mk = eve@example.com`
    const parsed = parseAospOwners(content, "services/core")
    expect(parsed.relativeDir).toBe("services/core")
    expect(parsed.noParent).toBe(true)
    expect(parsed.directOwners).toEqual(["alice@example.com", "bob@example.com"])
    expect(parsed.includes).toEqual(["//build/make/OWNERS"])
    expect(parsed.perFileDirectives.length).toBe(2)
    expect(parsed.perFileDirectives[0].pattern).toBe("*.bp")
    expect(parsed.perFileDirectives[0].owners).toEqual(["charlie@example.com", "dave@example.com"])
    expect(parsed.perFileDirectives[1].pattern).toBe("*.mk")
    expect(parsed.perFileDirectives[1].owners).toEqual(["eve@example.com"])
  })

  it("parses CODEOWNERS entries", () => {
    const content = `/packages/ui/ @frontend-team
*.go @backend-lead
docs/ @tech-writers`
    const entries = parseCodeowners(content)
    expect(entries.length).toBe(3)
    expect(entries[0].pattern).toBe("/packages/ui/")
    expect(entries[0].owners).toEqual(["@frontend-team"])
    expect(entries[1].pattern).toBe("*.go")
    expect(entries[1].owners).toEqual(["@backend-lead"])
    expect(entries[2].pattern).toBe("docs/")
    expect(entries[2].owners).toEqual(["@tech-writers"])
  })

  it("discovers virtual owner tree without polluting repo", () => {
    const workspace = createWorkspaceIdentity(process.cwd())
    expect(workspace.workspaceRoot).toBeDefined()
    expect(workspace.repoId).toBeDefined()

    const mgr = new VirtualOwnerTreeManager()
    const tree = mgr.discoverTree(workspace)
    expect(tree.rootNodeId).toBe("root")
    expect(tree.nodes.root).toBeDefined()

    const concreteOwners = mgr.convertToConcreteOwners(tree)
    expect(concreteOwners.length).toBeGreaterThan(0)
    const rootOwner = concreteOwners.find((o) => o.id === "root")
    expect(rootOwner).toBeDefined()
    expect(rootOwner?.scopes[0].pathPrefixes).toContain(".")
  })
})
