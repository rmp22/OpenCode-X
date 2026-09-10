import type { PullRequestArtifact, ReleaseNotesArtifact } from "./types"

export function formatPullRequestDescription(artifact: PullRequestArtifact): string {
  let output = `## Summary\n${artifact.summary}\n\n`
  output += "## Changes\n"
  for (const change of artifact.changes) {
    output += `- ${change}\n`
  }
  output += "\n## Verification Evidence\n"
  for (const ev of artifact.verificationEvidence) {
    output += `- ${ev}\n`
  }
  output += `\n## Testing Instructions\n${artifact.testingInstructions}\n`
  return output
}

export function formatReleaseNotes(notes: ReleaseNotesArtifact): string {
  let output = `# Release v${notes.version} (${notes.date})\n\n`

  if (notes.breakingChanges.length > 0) {
    output += "## Breaking Changes\n"
    for (const b of notes.breakingChanges) {
      output += `- ${b}\n`
    }
    output += "\n"
  }

  if (notes.features.length > 0) {
    output += "## Features\n"
    for (const f of notes.features) {
      output += `- ${f}\n`
    }
    output += "\n"
  }

  if (notes.fixes.length > 0) {
    output += "## Fixes\n"
    for (const fix of notes.fixes) {
      output += `- ${fix}\n`
    }
    output += "\n"
  }

  return output
}
