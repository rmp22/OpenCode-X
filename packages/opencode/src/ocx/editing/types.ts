export interface FileEdit {
  filePath: string
  oldContent: string
  newContent: string
}

export interface DiffLine {
  type: "add" | "delete" | "context"
  content: string
  oldLineNumber?: number
  newLineNumber?: number
}

export interface DiffHunk {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: DiffLine[]
}

export interface FileDiff {
  filePath: string
  hunks: DiffHunk[]
}

export interface Changeset {
  id: string
  description: string
  edits: FileEdit[]
  timestamp: number
}

export interface ChangesetResult {
  changesetId: string
  applied: boolean
  diffs: FileDiff[]
  error?: string
  rolledBack?: boolean
}
