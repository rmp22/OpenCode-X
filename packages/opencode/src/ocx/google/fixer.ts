import type { FixResult } from "./types"

export function fixContent(filePath: string, content: string, defaultUsername = "owner"): FixResult {
  const lines = content.split("\n")
  let fixedCount = 0
  const appliedRuleIds: string[] = []

  const newLines = lines.map((line) => {
    let modifiedLine = line

    if (line.startsWith("\t")) {
      const replaced = line.replace(/^\t+/, (tabs) => "  ".repeat(tabs.length))
      if (replaced !== modifiedLine) {
        modifiedLine = replaced
        fixedCount++
        if (!appliedRuleIds.includes("google-indent")) appliedRuleIds.push("google-indent")
      }
    }

    if (/\bvar\s+[a-zA-Z0-9_]/.test(modifiedLine) && !modifiedLine.trim().startsWith("//")) {
      const replaced = modifiedLine.replace(/\bvar\s+/, "const ")
      if (replaced !== modifiedLine) {
        modifiedLine = replaced
        fixedCount++
        if (!appliedRuleIds.includes("google-no-var")) appliedRuleIds.push("google-no-var")
      }
    }

    if (/\/\/\s*TODO(?!\s*\([a-zA-Z0-9_\-.]+\):)/.test(modifiedLine) && !modifiedLine.includes("// TODO(")) {
      const replaced = modifiedLine.replace(/\/\/\s*TODO(?:\s*:)?\s*/, `// TODO(${defaultUsername}): `)
      if (replaced !== modifiedLine) {
        modifiedLine = replaced
        fixedCount++
        if (!appliedRuleIds.includes("google-todo-owner")) appliedRuleIds.push("google-todo-owner")
      }
    }

    if (filePath.endsWith(".ts") || filePath.endsWith(".js")) {
      const trimmed = modifiedLine.trim()
      if (/^(const|let|return|throw|import|export const|export let|export type)\b/.test(trimmed)) {
        if (!trimmed.endsWith(";") && !trimmed.endsWith("{") && !trimmed.endsWith("}")) {
          modifiedLine = `${modifiedLine};`
          fixedCount++
          if (!appliedRuleIds.includes("google-semicolon")) appliedRuleIds.push("google-semicolon")
        }
      }
    }

    if ((filePath.endsWith(".cpp") || filePath.endsWith(".cc") || filePath.endsWith(".h")) && /([=!]==?|\()\s*NULL\b/.test(modifiedLine)) {
      const replaced = modifiedLine.replace(/\bNULL\b/g, "nullptr")
      if (replaced !== modifiedLine) {
        modifiedLine = replaced
        fixedCount++
        if (!appliedRuleIds.includes("google-cpp-nullptr")) appliedRuleIds.push("google-cpp-nullptr")
      }
    }

    return modifiedLine
  })

  const fixedContent = newLines.join("\n")
  return {
    filePath,
    fixedCount,
    originalContent: content,
    fixedContent,
    modified: fixedContent !== content,
    appliedRuleIds,
  }
}
