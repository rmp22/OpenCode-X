import { describe, expect, it } from "bun:test"
import { OwnershipResolver } from "../../src/ocx/owner/resolver"
import type { ConcreteOwner } from "../../src/ocx/owner/types"
import { createWorkspaceIdentity } from "../../src/ocx/owner/workspace-tree"

describe("OwnershipResolver and Auto-Routing", () => {
  const workspace = createWorkspaceIdentity("/home/user/project")

  const owners: ConcreteOwner[] = [
    {
      id: "root",
      name: "Root",
      topic: ".",
      kind: "directory",
      scopes: [
        {
          id: "scope-root",
          ownerId: "root",
          kind: "DIRECTORY",
          pathPrefixes: ["."],
        },
      ],
      readiness: "ready",
      modelTier: "primary",
    },
    {
      id: "core",
      name: "Core Package",
      topic: "packages/core",
      kind: "module",
      rootDir: "packages/core",
      scopes: [
        {
          id: "scope-core",
          ownerId: "core",
          kind: "MODULE",
          pathPrefixes: ["packages/core"],
          moduleRoot: "packages/core",
        },
      ],
      readiness: "ready",
      modelTier: "primary",
    },
    {
      id: "owner-system",
      name: "Owner Subsystem",
      topic: "packages/core/src/owner",
      kind: "subsystem",
      rootDir: "packages/core/src/owner",
      scopes: [
        {
          id: "scope-owner",
          ownerId: "owner-system",
          kind: "DIRECTORY",
          pathPrefixes: ["packages/core/src/owner"],
        },
      ],
      readiness: "ready",
      modelTier: "primary",
    },
    {
      id: "ui",
      name: "UI Components",
      topic: "packages/ui",
      kind: "module",
      rootDir: "packages/ui",
      scopes: [
        {
          id: "scope-ui",
          ownerId: "ui",
          kind: "MODULE",
          pathPrefixes: ["packages/ui"],
          moduleRoot: "packages/ui",
          reviewConcerns: ["ui", "accessibility"],
        },
      ],
      readiness: "ready",
      modelTier: "primary",
    },
  ]

  const resolver = new OwnershipResolver(owners, workspace)

  it("resolves exact file with longest prefix match", () => {
    const res = resolver.resolve({
      paths: ["packages/core/src/owner/resolver.ts"],
    })
    expect(res.owner.id).toBe("owner-system")
    expect(res.matchType).toBe("longest_path_prefix")
    expect(res.matchedPrefix).toBe("packages/core/src/owner")
  })

  it("resolves wider prefix when sub-prefix does not match", () => {
    const res = resolver.resolve({
      paths: ["packages/core/src/session.ts"],
    })
    expect(res.owner.id).toBe("core")
    expect(res.matchedPrefix).toBe("packages/core")
  })

  it("normalizes absolute paths to workdir relative and avoids system root matching", () => {
    const res = resolver.resolve({
      paths: ["/home/user/project/packages/ui/button.tsx"],
    })
    expect(res.owner.id).toBe("ui")
    expect(res.matchedPrefix).toBe("packages/ui")
  })

  it("respects pinned owner override", () => {
    const res = resolver.resolve({
      pinnedOwnerId: "core",
      paths: ["packages/ui/button.tsx"],
    })
    expect(res.owner.id).toBe("core")
    expect(res.matchType).toBe("pinned")
  })

  it("detects review concerns without routing authority", () => {
    const res = resolver.resolve({
      paths: ["packages/core/src/auth.ts"],
      prompt: "Implement security audit for networking tokens and ui feedback",
    })
    expect(res.owner.id).toBe("core")
    expect(res.reviewConcerns).toContain("security")
    expect(res.reviewConcerns).toContain("networking")
    expect(res.reviewConcerns).toContain("ui")
  })

  it("intercepts cross-boundary operations and partitions them", () => {
    const intercept = resolver.interceptOperation([
      "packages/core/src/index.ts",
      "packages/ui/src/button.tsx",
    ])
    expect(intercept.intercepted).toBe(true)
    expect(intercept.isCrossBoundary).toBe(true)
    expect(intercept.affectedOwners).toContain("core")
    expect(intercept.affectedOwners).toContain("ui")
    expect(intercept.partitions?.core).toEqual(["packages/core/src/index.ts"])
    expect(intercept.partitions?.ui).toEqual(["packages/ui/src/button.tsx"])
  })

  it("intercepts when target owner does not match current owner", () => {
    const intercept = resolver.interceptOperation(
      ["packages/ui/src/button.tsx"],
      "core"
    )
    expect(intercept.intercepted).toBe(true)
    expect(intercept.isCrossBoundary).toBe(false)
    expect(intercept.requiredOwnerId).toBe("ui")
  })

  it("allows operation when current owner matches target", () => {
    const intercept = resolver.interceptOperation(
      ["packages/ui/src/button.tsx"],
      "ui"
    )
    expect(intercept.intercepted).toBe(false)
    expect(intercept.requiredOwnerId).toBe("ui")
  })
})
