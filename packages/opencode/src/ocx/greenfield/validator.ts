import type { ValidationCheckResult } from "./types"

export async function validateSkeleton(
  directoryPath: string,
  requiredFiles: string[] = ["package.json", "tsconfig.json", "src/index.ts"],
): Promise<ValidationCheckResult> {
  const missingFiles: string[] = []

  for (const rel of requiredFiles) {
    try {
      const exists = await Bun.file(`${directoryPath}/${rel}`).exists()
      if (!exists) {
        missingFiles.push(rel)
      }
    } catch {
      missingFiles.push(rel)
    }
  }

  const passed = missingFiles.length === 0
  const recommendedActions = missingFiles.map((f) => `Create required structural file: ${f}`)

  return {
    passed,
    missingFiles,
    recommendedActions,
  }
}
