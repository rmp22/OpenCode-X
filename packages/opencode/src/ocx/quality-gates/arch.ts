export * as ArchGate from "./arch"

export type ArchFinding = {
  readonly id: string
  readonly message: string
  readonly file: string
  readonly severity: "error" | "warning" | "info"
}

export function checkArchitecture(paths: readonly string[], contentByPath: Record<string, string>): readonly ArchFinding[] {
  const findings: ArchFinding[] = []

  const importMap = new Map<string, readonly string[]>()
  for (const path of paths) {
    const content = contentByPath[path] ?? ""
    const imports = content.match(/from\s+['"]([^'"]+)['"]/g) ?? []
    importMap.set(path, imports.map((imp) => imp.replace(/from\s+['"]/, "").replace(/['"]$/, "")))
  }

  for (const [path, imports] of importMap) {
    for (const imp of imports) {
      const reverseImports = importMap.get(imp) ?? []
      if (reverseImports.some((ri) => ri === path || ri.includes(path.split("/").pop() ?? ""))) {
        findings.push({
          id: "A1-circular-dependency",
          message: `circular dependency detected between ${path} and ${imp}`,
          file: path,
          severity: "error",
        })
      }
    }
  }

  for (const path of paths) {
    const content = contentByPath[path] ?? ""
    const exportCount = (content.match(/^export /gm) ?? []).length
    if (exportCount > 10) {
      findings.push({
        id: "A2-god-object",
        message: `file has ${exportCount} exports; consider splitting into focused modules`,
        file: path,
        severity: "warning",
      })
    }
  }

  return findings
}

export * as Arch from "./arch"