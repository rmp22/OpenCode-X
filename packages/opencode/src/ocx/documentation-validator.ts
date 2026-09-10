import { existsSync, readFileSync } from "node:fs"
import path from "node:path"

export type Finding = {
  readonly id: string
  readonly message: string
  readonly span?: string
}

export function validate(input: { readonly cwd: string; readonly changed: readonly string[] }): Finding[] {
  return input.changed.flatMap((file) => {
    if (!/\.(?:md|mdx|rst|adoc|txt)$/i.test(file)) return []
    const full = path.isAbsolute(file) ? file : path.join(input.cwd, file)
    const content = readFile(full)
    if (content === undefined) return [{ id: "DOC-READ-UNKNOWN", message: `could not inspect changed documentation ${file}`, span: file }]
    return missingLinks(full, content)
  })
}

function missingLinks(file: string, content: string): Finding[] {
  const findings: Finding[] = []
  for (const match of content.matchAll(/\]\(([^)]+)\)/g)) {
    const reference = match[1]?.trim()
    if (!reference || reference.startsWith("#") || /^(?:[a-z]+:|\/\/)/i.test(reference)) continue
    const target = reference.split(/[?#]/, 1)[0]
    if (!target || existsSync(path.resolve(path.dirname(file), target))) continue
    findings.push({ id: "DOC-LINK-MISSING", message: `documentation link does not resolve: ${reference}`, span: reference })
    if (findings.length === 5) break
  }
  return findings
}

function readFile(file: string): string | undefined {
  try {
    return readFileSync(file, "utf8")
  } catch {
    return undefined
  }
}

export * as DocumentationValidator from "./documentation-validator"
