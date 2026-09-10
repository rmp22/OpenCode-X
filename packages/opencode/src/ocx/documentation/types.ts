export interface ApiDocEntry {
  symbolName: string
  kind: "function" | "class" | "interface" | "type"
  signature: string
  description: string
  parameters?: Array<{ name: string; type: string; description: string }>
  returnType?: string
}

export interface PullRequestArtifact {
  title: string
  summary: string
  changes: string[]
  verificationEvidence: string[]
  testingInstructions: string
}

export interface ReleaseNotesArtifact {
  version: string
  date: string
  features: string[]
  fixes: string[]
  breakingChanges: string[]
}
