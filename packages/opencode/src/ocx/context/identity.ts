export * as RepositoryIdentityResolver from "./identity"

import { createHash } from "node:crypto"
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs"
import path from "node:path"
import type { RepositoryIdentity, RepositoryID } from "./types"

export type ResolveInput = {
  readonly root: string
  readonly remotes?: readonly string[]
  readonly projectID?: string
  readonly workspaceNamespace?: string
  readonly rootFingerprint?: string
}

export type ResolvedRepository = {
  readonly id: RepositoryID
  readonly root: string
  readonly identity: RepositoryIdentity
  readonly displayName: string
}

export function resolve(input: ResolveInput): ResolvedRepository {
  const root = realRoot(input.root)
  const remotes = [...new Set((input.remotes ?? []).map(normalizeRemote).filter(Boolean))].sort()
  const rootFingerprint = input.rootFingerprint?.trim() || fingerprint(root)
  const identity: RepositoryIdentity = {
    vcs: remotes.length > 0 || existsSync(path.join(root, ".git")) ? "git" : "unknown",
    remotes,
    rootFingerprint,
    ...(input.projectID?.trim() ? { projectID: input.projectID.trim() } : {}),
    ...(input.workspaceNamespace?.trim() ? { workspaceNamespace: input.workspaceNamespace.trim() } : {}),
  }
  const key = [
    identity.vcs,
    identity.remotes.join("\n"),
    identity.remotes.length > 0 ? "" : identity.rootFingerprint,
    identity.projectID ?? "",
    identity.workspaceNamespace ?? "",
  ].join("\0")
  const id = `repo-${createHash("sha256").update(key).digest("hex").slice(0, 32)}` as RepositoryID
  return { id, root, identity, displayName: path.basename(root) || "repository" }
}

export function fromDirectory(
  directory: string,
  options: Omit<ResolveInput, "root" | "remotes" | "rootFingerprint"> = {},
): ResolvedRepository {
  const root = repositoryRoot(directory)
  return resolve({ ...options, root, remotes: gitRemotes(root), rootFingerprint: fingerprint(root) })
}

export function normalizeRemote(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ""
  const withoutScheme = trimmed.replace(/^[a-z]+:\/\//i, "")
  const withoutCredentials = withoutScheme.startsWith("git@") ? withoutScheme : withoutScheme.replace(/^[^/@\s]+@/, "")
  if (withoutCredentials.startsWith("git@"))
    return withoutCredentials
      .slice(4)
      .replace(/:([\w./-]+)$/, "/$1")
      .replace(/\.git$/, "")
      .toLocaleLowerCase()
  return withoutCredentials
    .replace(/\/$/, "")
    .replace(/\.git$/, "")
    .toLocaleLowerCase()
}

export function fingerprint(root: string): string {
  const normalized = realRoot(root)
  const gitHead = readText(path.join(normalized, ".git", "HEAD"))
  const gitConfig = readText(path.join(normalized, ".git", "config"))
  const markers = ["package.json", "Cargo.toml", "go.mod", "pom.xml", "BUILD", "WORKSPACE", "CMakeLists.txt"]
    .filter((item) => existsSync(path.join(normalized, item)))
    .sort()
  const markerContent = markers.map(
    (item) => `${item}\0${readText(path.join(normalized, item))?.slice(0, 32_768) ?? ""}`,
  )
  const value = [gitHead, gitConfig, markers.join("\n"), rootEntries(normalized), ...markerContent]
    .filter(Boolean)
    .join("\0")
  return createHash("sha256")
    .update(value || path.basename(normalized))
    .digest("hex")
}

export function repositoryRoot(start: string): string {
  const original = realRoot(start)
  let current = original
  while (true) {
    if (existsSync(path.join(current, ".git"))) return current
    const parent = path.dirname(current)
    if (parent === current) return original
    current = parent
  }
}

function gitRemotes(root: string): string[] {
  const config = readText(path.join(root, ".git", "config"))
  if (!config) return []
  return [...config.matchAll(/^\s*url\s*=\s*(.+)$/gm)].map((match) => normalizeRemote(match[1] ?? "")).filter(Boolean)
}

function realRoot(root: string): string {
  const resolved = path.resolve(root)
  try {
    return realpathSync(resolved)
  } catch {
    return resolved
  }
}

function readText(file: string): string | undefined {
  try {
    return readFileSync(file, "utf8")
  } catch {
    return undefined
  }
}

function rootEntries(root: string): string {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.name !== ".git")
      .map((entry) => `${entry.name}:${entry.isDirectory() ? "d" : "f"}`)
      .sort()
      .slice(0, 256)
      .join("\n")
  } catch {
    return ""
  }
}
