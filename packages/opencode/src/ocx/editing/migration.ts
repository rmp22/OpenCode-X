export interface MigrationRule {
  targetSymbol?: string
  newSymbol?: string
  oldImportPath?: string
  newImportPath?: string
}

export function applyMigrationRule(content: string, rule: MigrationRule): string {
  let updated = content

  if (rule.oldImportPath && rule.newImportPath) {
    const importPattern = new RegExp(
      `from\\s+["']${rule.oldImportPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`,
      "g",
    )
    updated = updated.replace(importPattern, `from "${rule.newImportPath}"`)
  }

  if (rule.targetSymbol && rule.newSymbol) {
    const symbolPattern = new RegExp(`\\b${rule.targetSymbol}\\b`, "g")
    updated = updated.replace(symbolPattern, rule.newSymbol)
  }

  return updated
}

export function migrateFileContents(
  files: Array<{ filePath: string; content: string }>,
  rules: MigrationRule[],
): Array<{ filePath: string; oldContent: string; newContent: string; modified: boolean }> {
  return files.map((f) => {
    let current = f.content
    for (const rule of rules) {
      current = applyMigrationRule(current, rule)
    }
    return {
      filePath: f.filePath,
      oldContent: f.content,
      newContent: current,
      modified: current !== f.content,
    }
  })
}
