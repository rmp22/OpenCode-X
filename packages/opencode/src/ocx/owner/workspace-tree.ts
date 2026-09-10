import { createHash } from "node:crypto"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { basename, isAbsolute, join, relative, resolve } from "node:path"
import type {
  ConcreteOwner,
  ConcreteScopeKind,
  OwnerID,
  OwnerScope,
  OwnerTree,
  OwnerTreeNode,
  WorkspaceIdentity,
} from "./types"

export type ParsedAospOwners = {
  readonly relativeDir: string
  readonly noParent: boolean
  readonly directOwners: readonly string[]
  readonly perFileDirectives: readonly { readonly pattern: string; readonly owners: readonly string[] }[]
  readonly includes: readonly string[]
}

export type ParsedCodeownersEntry = {
  readonly pattern: string
  readonly owners: readonly string[]
  readonly lineNumber: number
}

export function createWorkspaceIdentity(workdir: string): WorkspaceIdentity {
  const workspaceRoot = resolve(workdir)
  const repoId = createHash("sha256").update(workspaceRoot).digest("hex").slice(0, 16)
  const name = basename(workspaceRoot) || "workspace"
  const identity: WorkspaceIdentity = {
    workspaceRoot,
    repoId,
    name,
  }
  return identity
}

export function toWorkdirRelative(workspaceRoot: string, targetPath: string): string {
  if (!isAbsolute(targetPath)) {
    return targetPath.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/+$/, "")
  }
  const rel = relative(workspaceRoot, targetPath).replaceAll("\\", "/")
  if (rel.startsWith("..")) {
    return basename(targetPath)
  }
  return rel.replace(/^\.\//, "").replace(/\/+$/, "")
}

export function parseAospOwners(content: string, relativeDir = "."): ParsedAospOwners {
  const normDir = relativeDir.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/+$/, "") || "."
  const directOwners: string[] = []
  const perFileDirectives: { pattern: string; owners: string[] }[] = []
  const includes: string[] = []
  let noParent = false

  const lines = content.split(/\r?\n/)
  for (const rawLine of lines) {
    const trimmed = rawLine.trim()
    if (!trimmed || trimmed.startsWith("#")) continue

    if (trimmed === "set noparent") {
      noParent = true
      continue
    }

    if (trimmed.startsWith("include ") || trimmed.startsWith("file:")) {
      const target = trimmed.replace(/^include\s+|^file:/, "").trim()
      if (target) includes.push(target)
      continue
    }

    if (trimmed.startsWith("per-file ")) {
      const match = trimmed.match(/^per-file\s+([^=]+)=\s*(.+)$/)
      if (match) {
        const pattern = match[1].trim()
        const owners = match[2]
          .split(/[\s,]+/)
          .map((s) => s.trim())
          .filter(Boolean)
        perFileDirectives.push({ pattern, owners })
      }
      continue
    }

    const owners = trimmed
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter((s) => s && !s.startsWith("#"))
    directOwners.push(...owners)
  }

  const result: ParsedAospOwners = {
    relativeDir: normDir,
    noParent,
    directOwners,
    perFileDirectives,
    includes,
  }
  return result
}

export function parseCodeowners(content: string): readonly ParsedCodeownersEntry[] {
  const entries: ParsedCodeownersEntry[] = []
  const lines = content.split(/\r?\n/)
  let lineNum = 0

  for (const rawLine of lines) {
    lineNum++
    const trimmed = rawLine.trim()
    if (!trimmed || trimmed.startsWith("#")) continue

    const parts = trimmed.split(/\s+/)
    if (parts.length < 2) continue

    const pattern = parts[0]
    const owners = parts.slice(1).filter((p) => !p.startsWith("#"))
    if (owners.length > 0) {
      entries.push({ pattern, owners, lineNumber: lineNum })
    }
  }

  return entries
}

function safeReadText(filePath: string): string | undefined {
  if (!existsSync(filePath)) return undefined
  try {
    return readFileSync(filePath, "utf8")
  } catch (error) {
    void error
    return undefined
  }
}

function safeReadDir(dirPath: string) {
  if (!existsSync(dirPath)) return []
  try {
    return readdirSync(dirPath, { withFileTypes: true })
  } catch (error) {
    void error
    return []
  }
}

function parseAospNodes(rootPath: string, rootNodeId: string): readonly OwnerTreeNode[] {
  const content = safeReadText(join(rootPath, "OWNERS"))
  if (!content) return []
  const parsed = parseAospOwners(content, ".")
  const nodes = parsed.perFileDirectives.map((d) => {
    const dId = `root-pattern-${d.pattern.replaceAll(/[^a-zA-Z0-9_-]/g, "_")}`
    const node: OwnerTreeNode = {
      id: dId,
      name: `Per-File (${d.pattern})`,
      relativePath: ".",
      scopeKind: "FILE_PATTERN",
      patterns: [d.pattern],
      parentId: rootNodeId,
      childrenIds: [],
      source: "aosp_owners",
    }
    return node
  })
  return nodes
}

function parseCodeownersNodes(rootPath: string, rootNodeId: string): readonly OwnerTreeNode[] {
  const codeownersPath = [
    join(rootPath, "CODEOWNERS"),
    join(rootPath, ".github", "CODEOWNERS"),
    join(rootPath, ".gitlab", "CODEOWNERS"),
  ].find((p) => existsSync(p))

  if (!codeownersPath) return []
  const content = safeReadText(codeownersPath)
  if (!content) return []

  const entries = parseCodeowners(content)
  const nodes = entries.map((entry) => {
    const cleanPattern = entry.pattern.replace(/^\//, "")
    const entryId = `codeowners-${cleanPattern.replaceAll(/[^a-zA-Z0-9_-]/g, "_")}`
    const node: OwnerTreeNode = {
      id: entryId,
      name: `Codeowners: ${entry.pattern}`,
      relativePath: cleanPattern,
      scopeKind: cleanPattern.endsWith("/") ? "DIRECTORY" : "FILE_PATTERN",
      patterns: [cleanPattern],
      parentId: rootNodeId,
      childrenIds: [],
      source: "codeowners",
    }
    return node
  })
  return nodes
}

function discoverSubmodules(fullDir: string, dirRel: string, parentId: string): readonly OwnerTreeNode[] {
  const subEntries = safeReadDir(fullDir)
  const subNodes: OwnerTreeNode[] = []
  for (const sub of subEntries) {
    if (!sub.isDirectory() || sub.name.startsWith(".")) continue
    const subRel = `${dirRel}/${sub.name}`
    const subId = `module-${subRel.replaceAll("/", "-")}`
    subNodes.push({
      id: subId,
      name: `${sub.name}`,
      relativePath: subRel,
      scopeKind: "MODULE",
      parentId,
      childrenIds: [],
      source: "virtual_discovery",
    })
  }
  return subNodes
}

export class VirtualOwnerTreeManager {
  private readonly treeCache = new Map<string, OwnerTree>()

  getTree(workspace: WorkspaceIdentity): OwnerTree | undefined {
    return this.treeCache.get(workspace.repoId)
  }

  setTree(tree: OwnerTree): void {
    this.treeCache.set(tree.workspace.repoId, tree)
  }

  discoverTree(workspace: WorkspaceIdentity): OwnerTree {
    const rootNodeId = "root"
    const nodes: Record<OwnerID, OwnerTreeNode> = {}

    nodes[rootNodeId] = {
      id: rootNodeId,
      name: `${workspace.name} Root`,
      relativePath: ".",
      scopeKind: "DIRECTORY",
      childrenIds: [],
      source: "virtual_discovery",
    }

    const rootChildren: string[] = []
    const rootPath = workspace.workspaceRoot

    if (existsSync(rootPath)) {
      const aospNodes = parseAospNodes(rootPath, rootNodeId)
      for (const node of aospNodes) {
        nodes[node.id] = node
        rootChildren.push(node.id)
      }

      const codeownersNodes = parseCodeownersNodes(rootPath, rootNodeId)
      for (const node of codeownersNodes) {
        if (!nodes[node.id]) {
          nodes[node.id] = node
          rootChildren.push(node.id)
        }
      }

      const topEntries = safeReadDir(rootPath)
      for (const entry of topEntries) {
        if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "dist" || entry.name === "build") {
          continue
        }

        if (!entry.isDirectory()) continue

        const dirRel = entry.name
        const dirId = `dir-${dirRel}`
        const fullDir = join(rootPath, dirRel)
        const isModule =
          existsSync(join(fullDir, "package.json")) ||
          existsSync(join(fullDir, "Cargo.toml")) ||
          existsSync(join(fullDir, "go.mod"))
        const scopeKind: ConcreteScopeKind = isModule ? "MODULE" : "DIRECTORY"

        let childNodeIds: string[] = []
        if (dirRel === "packages" || dirRel === "crates" || dirRel === "services" || dirRel === "apps") {
          const subNodes = discoverSubmodules(fullDir, dirRel, dirId)
          for (const sub of subNodes) {
            nodes[sub.id] = sub
          }
          childNodeIds = subNodes.map((s) => s.id)
        }

        nodes[dirId] = {
          id: dirId,
          name: entry.name,
          relativePath: dirRel,
          scopeKind,
          parentId: rootNodeId,
          childrenIds: childNodeIds,
          source: "virtual_discovery",
        }
        rootChildren.push(dirId)
      }
    }

    nodes[rootNodeId] = {
      ...nodes[rootNodeId],
      childrenIds: rootChildren,
    }

    const tree: OwnerTree = {
      workspace,
      nodes,
      rootNodeId,
      version: 1,
      updatedAt: Date.now(),
    }

    this.treeCache.set(workspace.repoId, tree)
    return tree
  }

  convertToConcreteOwners(tree: OwnerTree): readonly ConcreteOwner[] {
    const owners: ConcreteOwner[] = []
    for (const node of Object.values(tree.nodes)) {
      const scope: OwnerScope = {
        id: `scope-${node.id}`,
        ownerId: node.id,
        kind: node.scopeKind,
        pathPrefixes: [node.relativePath],
        globs: node.patterns,
        moduleRoot: node.scopeKind === "MODULE" || node.scopeKind === "PACKAGE" ? node.relativePath : undefined,
        reviewConcerns: node.reviewConcerns,
      }

      owners.push({
        id: node.id,
        name: node.name,
        topic: node.relativePath,
        kind: node.scopeKind === "MODULE" || node.scopeKind === "PACKAGE" ? "module" : "directory",
        scopes: [scope],
        rootDir: node.relativePath === "." ? undefined : node.relativePath,
        readiness: "ready",
        modelTier: "primary",
      })
    }
    return owners
  }
}

export * as WorkspaceTree from "./workspace-tree"
