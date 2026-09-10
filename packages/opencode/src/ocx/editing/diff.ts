import type { DiffHunk, DiffLine, FileDiff } from "./types"

export function generateFileDiff(filePath: string, oldContent: string, newContent: string): FileDiff {
  const oldLines = oldContent.split("\n")
  const newLines = newContent.split("\n")
  const diffLines: DiffLine[] = []

  let i = 0
  let j = 0

  while (i < oldLines.length || j < newLines.length) {
    if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
      diffLines.push({
        type: "context",
        content: oldLines[i],
        oldLineNumber: i + 1,
        newLineNumber: j + 1,
      })
      i++
      j++
    } else if (i < oldLines.length && (j >= newLines.length || !newLines.includes(oldLines[i]))) {
      diffLines.push({
        type: "delete",
        content: oldLines[i],
        oldLineNumber: i + 1,
      })
      i++
    } else if (j < newLines.length) {
      diffLines.push({
        type: "add",
        content: newLines[j],
        newLineNumber: j + 1,
      })
      j++
    }
  }

  const hunk: DiffHunk = {
    oldStart: 1,
    oldLines: oldLines.length,
    newStart: 1,
    newLines: newLines.length,
    lines: diffLines,
  }

  return {
    filePath,
    hunks: [hunk],
  }
}

export function formatUnifiedDiff(diff: FileDiff): string {
  let output = `--- a/${diff.filePath}\n+++ b/${diff.filePath}\n`
  for (const hunk of diff.hunks) {
    output += `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@\n`
    for (const line of hunk.lines) {
      output += `${line.type === "add" ? "+" : line.type === "delete" ? "-" : " "}${line.content}\n`
    }
  }
  return output
}
