import type {
  AttributionCategory,
  DiffChunkAttribution,
  TurnAttribution,
} from "./types"

export type ParsedDiffHunk = {
  readonly file: string
  readonly oldStart: number
  readonly oldLines: number
  readonly newStart: number
  readonly newLines: number
  readonly addedLines: readonly string[]
  readonly deletedLines: readonly string[]
  readonly contextLines: readonly string[]
}

export type AttributionOptions = {
  readonly turn?: number
  readonly callerMap?: Record<string, readonly string[]>
  readonly preExistingFindingsCount?: number
  readonly newFindingsCount?: number
  readonly promptIntent?: string
}

export function parseUnifiedDiff(diffText: string): readonly ParsedDiffHunk[] {
  const lines = diffText.split("\n")
  const hunks: ParsedDiffHunk[] = []
  let currentFile = "unknown"
  let currentHunk: {
    oldStart: number
    oldLines: number
    newStart: number
    newLines: number
    added: string[]
    deleted: string[]
    context: string[]
  } | null = null

  for (const line of lines) {
    if (line.startsWith("+++ b/")) {
      currentFile = line.slice(6).trim()
    } else if (line.startsWith("+++ ") && !line.startsWith("+++ b/")) {
      currentFile = line.slice(4).trim()
    } else if (line.startsWith("@@ ")) {
      if (currentHunk) {
        const hunk: ParsedDiffHunk = {
          file: currentFile,
          oldStart: currentHunk.oldStart,
          oldLines: currentHunk.oldLines,
          newStart: currentHunk.newStart,
          newLines: currentHunk.newLines,
          addedLines: currentHunk.added,
          deletedLines: currentHunk.deleted,
          contextLines: currentHunk.context,
        }
        hunks.push(hunk)
      }
      const match = /@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line)
      if (match) {
        currentHunk = {
          oldStart: parseInt(match[1], 10),
          oldLines: match[2] ? parseInt(match[2], 10) : 1,
          newStart: parseInt(match[3], 10),
          newLines: match[4] ? parseInt(match[4], 10) : 1,
          added: [],
          deleted: [],
          context: [],
        }
      }
    } else if (currentHunk) {
      if (line.startsWith("+") && !line.startsWith("+++")) {
        currentHunk.added.push(line.slice(1))
      } else if (line.startsWith("-") && !line.startsWith("---")) {
        currentHunk.deleted.push(line.slice(1))
      } else if (line.startsWith(" ")) {
        currentHunk.context.push(line.slice(1))
      }
    }
  }

  if (currentHunk) {
    const hunk: ParsedDiffHunk = {
      file: currentFile,
      oldStart: currentHunk.oldStart,
      oldLines: currentHunk.oldLines,
      newStart: currentHunk.newStart,
      newLines: currentHunk.newLines,
      addedLines: currentHunk.added,
      deletedLines: currentHunk.deleted,
      contextLines: currentHunk.context,
    }
    hunks.push(hunk)
  }

  return hunks
}

export function classifyChunk(
  hunk: ParsedDiffHunk,
  options: AttributionOptions = {},
): DiffChunkAttribution {
  const addedCount = hunk.addedLines.length
  const deletedCount = hunk.deletedLines.length
  const totalDirectLines = Math.max(1, addedCount + deletedCount)

  const hasAbandonedKeywords = hunk.addedLines.some(
    (l) =>
      l.includes("TODO: remove") ||
      l.includes("unreachable") ||
      l.includes("deprecated") ||
      l.includes("return null; // temporary"),
  )

  const isPureAddition = deletedCount === 0 && addedCount > 0
  const isRefactorStyle =
    deletedCount > 0 &&
    addedCount > 0 &&
    (deletedCount >= addedCount ||
      hunk.addedLines.some((l) => l.includes("function") || l.includes("const ") || l.includes("export ")))

  const addedComplexityIndicators = hunk.addedLines.filter(
    (l) =>
      l.includes("if (") ||
      l.includes("for (") ||
      l.includes("while (") ||
      l.includes("switch (") ||
      l.includes("try {") ||
      l.includes("catch ("),
  ).length

  let category: AttributionCategory = "INCIDENTAL_EROSION"
  let qualityDelta = 0
  let explanation = ""

  if (hasAbandonedKeywords) {
    category = "ABANDONED_BRANCH"
    qualityDelta = -0.2
    explanation = "Dead code or unreachable fallback branch introduced in modification."
  } else if (isPureAddition) {
    category = "PURE_ADDITION"
    qualityDelta = addedComplexityIndicators > 3 ? -0.1 : 0.0
    explanation = `Pure addition of ${addedCount} lines with new baseline functionality.`
  } else if (isRefactorStyle && addedComplexityIndicators <= 1) {
    category = "INTENTIONAL_REFACTOR"
    qualityDelta = 0.15
    explanation = "Streamlined existing logic, reducing or replacing debt with cleaner constructs."
  } else {
    category = "INCIDENTAL_EROSION"
    qualityDelta = -0.15 * Math.max(1, addedComplexityIndicators)
    explanation = `Collateral modification added ${addedComplexityIndicators} branch points without simplification.`
  }

  const affectedCallers = options.callerMap?.[hunk.file]?.length ?? 0
  const collateralLines = affectedCallers * 10
  const blastRadius = parseFloat(((totalDirectLines + collateralLines) / totalDirectLines).toFixed(2))

  const startLine = hunk.newStart
  const endLine = hunk.newStart + Math.max(1, hunk.newLines)

  const chunk: DiffChunkAttribution = {
    file: hunk.file,
    startLine,
    endLine,
    category,
    qualityDelta,
    blastRadius,
    explanation,
  }
  return chunk
}

export function attributeDiff(
  diffText: string,
  options: AttributionOptions = {},
): TurnAttribution {
  const hunks = parseUnifiedDiff(diffText)
  const turn = options.turn ?? 1

  if (hunks.length === 0) {
    const emptyResult: TurnAttribution = {
      turn,
      chunks: [],
      blastRadius: 1.0,
      blameScore: 0.0,
      intentionalRefactorRatio: 1.0,
      incidentalErosionCount: 0,
    }
    return emptyResult
  }

  const chunks = hunks.map((h) => classifyChunk(h, options))

  const totalBlastRadius = chunks.reduce((sum, c) => sum + c.blastRadius, 0)
  const avgBlastRadius = parseFloat((totalBlastRadius / chunks.length).toFixed(2))

  const refactorCount = chunks.filter((c) => c.category === "INTENTIONAL_REFACTOR").length
  const erosionCount = chunks.filter((c) => c.category === "INCIDENTAL_EROSION").length
  const intentionalRefactorRatio = parseFloat((refactorCount / chunks.length).toFixed(2))

  let blameScore = 0.0
  const preDebt = options.preExistingFindingsCount ?? 0
  const newDebt = options.newFindingsCount ?? erosionCount

  if (preDebt + newDebt > 0) {
    blameScore = parseFloat((newDebt / (preDebt + newDebt)).toFixed(2))
  } else {
    blameScore = parseFloat((erosionCount / chunks.length).toFixed(2))
  }

  const result: TurnAttribution = {
    turn,
    chunks,
    blastRadius: avgBlastRadius,
    blameScore,
    intentionalRefactorRatio,
    incidentalErosionCount: erosionCount,
  }
  return result
}

export function attributeCodeChange(
  file: string,
  beforeCode: string,
  afterCode: string,
  options: AttributionOptions = {},
): TurnAttribution {
  const beforeLines = beforeCode.split("\n")
  const afterLines = afterCode.split("\n")

  const addedLines: string[] = []
  const deletedLines: string[] = []

  const beforeSet = new Set(beforeLines)
  const afterSet = new Set(afterLines)

  for (const line of afterLines) {
    if (!beforeSet.has(line)) addedLines.push(line)
  }
  for (const line of beforeLines) {
    if (!afterSet.has(line)) deletedLines.push(line)
  }

  const hunk: ParsedDiffHunk = {
    file,
    oldStart: 1,
    oldLines: beforeLines.length,
    newStart: 1,
    newLines: afterLines.length,
    addedLines,
    deletedLines,
    contextLines: [],
  }

  const chunk = classifyChunk(hunk, options)
  const turn = options.turn ?? 1

  const isRefactor = chunk.category === "INTENTIONAL_REFACTOR"
  const isErosion = chunk.category === "INCIDENTAL_EROSION"

  const result: TurnAttribution = {
    turn,
    chunks: [chunk],
    blastRadius: chunk.blastRadius,
    blameScore: isErosion ? 0.8 : 0.1,
    intentionalRefactorRatio: isRefactor ? 1.0 : 0.0,
    incidentalErosionCount: isErosion ? 1 : 0,
  }
  return result
}

export * as ChangeAttribution from "./attribution"
