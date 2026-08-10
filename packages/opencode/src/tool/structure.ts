import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./structure.txt"

const FilePlan = Schema.Struct({
  path: Schema.NonEmptyString,
  owns: Schema.NonEmptyString,
  doesNotOwn: Schema.NonEmptyString,
  importsOrUses: Schema.Array(Schema.String),
  publicInputsOrOutputs: Schema.Array(Schema.String),
})

export const Parameters = Schema.Struct({
  operation: Schema.NonEmptyString,
  goal: Schema.NonEmptyString,
  scope: Schema.NonEmptyString,
  allowedChanges: Schema.Array(Schema.String),
  allowedBreaks: Schema.Array(Schema.String),
  nonGoals: Schema.Array(Schema.String),
  acceptanceChecks: Schema.NonEmptyArray(Schema.NonEmptyString),
  rollbackPlan: Schema.NonEmptyString,
  files: Schema.NonEmptyArray(FilePlan),
  dependencyDirection: Schema.NonEmptyString,
  stateOwner: Schema.NonEmptyString,
  preservedContracts: Schema.Array(Schema.String),
})

type Metadata = {
  paths: string[]
  files: number
}

export const StructureTool = Tool.define<typeof Parameters, Metadata, never>(
  "structure",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>) =>
        Effect.succeed({
          title: `Recorded structure for ${params.files.length} files`,
          output: [
            "REQUIREMENTS AND STRUCTURE CONTRACT",
            `Operation: ${params.operation}`,
            `Goal: ${params.goal}`,
            `Scope: ${params.scope}`,
            `Allowed changes: ${params.allowedChanges.join(", ") || "none recorded"}`,
            `Allowed breaks: ${params.allowedBreaks.join(", ") || "none recorded"}`,
            `Non-goals: ${params.nonGoals.join(", ") || "none recorded"}`,
            `Acceptance checks: ${params.acceptanceChecks.join(", ")}`,
            `Rollback or migration plan: ${params.rollbackPlan}`,
            "",
            "FILE PLAN",
            ...params.files.flatMap((file) => [
              `- ${file.path}`,
              `  owns: ${file.owns}`,
              `  does not own: ${file.doesNotOwn}`,
              `  imports or uses: ${file.importsOrUses.join(", ") || "none"}`,
              `  public inputs or outputs: ${file.publicInputsOrOutputs.join(", ") || "none"}`,
            ]),
            "",
            `Dependency direction: ${params.dependencyDirection}`,
            `State owner: ${params.stateOwner}`,
            `Preserved contracts: ${params.preservedContracts.join(", ") || "none recorded"}`,
          ].join("\n"),
          metadata: {
            paths: params.files.map((file) => file.path),
            files: params.files.length,
          },
        }),
    } satisfies Tool.DefWithoutID<typeof Parameters, Metadata>
  }),
)
