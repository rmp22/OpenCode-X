export interface GreenfieldDetection {
  isGreenfield: boolean
  hasPackageJson: boolean
  hasTsConfig: boolean
  hasTests: boolean
  hasSourceRoot: boolean
  totalFiles: number
}

export type GreenfieldPresetType = "node-ts" | "python" | "rust" | "go" | "java"

export interface ScaffoldFile {
  relativePath: string
  content: string
}

export interface ProjectSkeleton {
  name: string
  files: ScaffoldFile[]
  entryPoint: string
  testRunner: string
}

export interface ScaffoldStep {
  readonly phase: "config/build" | "entrypoint" | "test" | "verify"
  readonly target: string
  readonly description: string
}

export interface ScaffoldPlan {
  readonly preset: GreenfieldPresetType
  readonly steps: readonly ScaffoldStep[]
  readonly skeleton: ProjectSkeleton
}

export interface ValidationCheckResult {
  passed: boolean
  missingFiles: string[]
  recommendedActions: string[]
}
