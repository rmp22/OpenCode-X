import { generateFileDiff } from "./diff"
import type { Changeset, ChangesetResult, FileDiff } from "./types"

export async function applyChangeset(
  changeset: Changeset,
  options?: { dryRun?: boolean },
): Promise<ChangesetResult> {
  const diffs: FileDiff[] = []
  const backedUpOriginals = new Map<string, string>()

  for (const edit of changeset.edits) {
    try {
      const file = Bun.file(edit.filePath)
      const exists = await file.exists()
      const currentContent = exists ? await file.text() : ""

      if (exists && edit.oldContent && currentContent !== edit.oldContent) {
        return {
          changesetId: changeset.id,
          applied: false,
          diffs: [],
          error: `Pre-flight conflict in ${edit.filePath}: content does not match expected oldContent`,
          rolledBack: false,
        }
      }

      backedUpOriginals.set(edit.filePath, currentContent)
      diffs.push(generateFileDiff(edit.filePath, currentContent, edit.newContent))
    } catch (err) {
      return {
        changesetId: changeset.id,
        applied: false,
        diffs: [],
        error: `Pre-flight read error on ${edit.filePath}: ${String(err)}`,
        rolledBack: false,
      }
    }
  }

  if (options?.dryRun) {
    return {
      changesetId: changeset.id,
      applied: true,
      diffs,
    }
  }

  const writtenPaths: string[] = []
  try {
    for (const edit of changeset.edits) {
      await Bun.write(edit.filePath, edit.newContent)
      writtenPaths.push(edit.filePath)
    }

    return {
      changesetId: changeset.id,
      applied: true,
      diffs,
    }
  } catch (err) {
    for (const path of writtenPaths) {
      const original = backedUpOriginals.get(path)
      if (original !== undefined) {
        try {
          await Bun.write(path, original)
        } catch (rollbackErr) {
          void rollbackErr
        }
      }
    }

    return {
      changesetId: changeset.id,
      applied: false,
      diffs,
      error: `Write failure during changeset: ${String(err)}`,
      rolledBack: true,
    }
  }
}
