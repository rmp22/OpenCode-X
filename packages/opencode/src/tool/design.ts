import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./design.txt"

export const Parameters = Schema.Struct({
  audience: Schema.NonEmptyString,
  userTask: Schema.NonEmptyString,
  direction: Schema.NonEmptyString,
  pattern: Schema.NonEmptyString,
  typeRoles: Schema.NonEmptyString,
  composition: Schema.NonEmptyString,
  mediaBehavior: Schema.NonEmptyString,
  surfaceTreatment: Schema.NonEmptyString,
  motionPurpose: Schema.NonEmptyString,
  distinctiveDecisions: Schema.NonEmptyArray(Schema.NonEmptyString),
  rejectedAlternative: Schema.NonEmptyString,
  mediaPlan: Schema.NonEmptyString,
  mediaFallback: Schema.NonEmptyString,
})

type Metadata = {
  direction: string
  distinctiveDecisions: string[]
}

export const DesignTool = Tool.define<typeof Parameters, Metadata, never>(
  "design",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>) =>
        Effect.succeed({
          title: `Recorded design direction: ${params.direction}`,
          output: [
            "DESIGN DIRECTION",
            `Audience: ${params.audience}`,
            `User task: ${params.userTask}`,
            `Direction: ${params.direction}`,
            `Pattern: ${params.pattern}`,
            `Type roles: ${params.typeRoles}`,
            `Composition: ${params.composition}`,
            `Media behavior: ${params.mediaBehavior}`,
            `Surface treatment: ${params.surfaceTreatment}`,
            `Motion purpose: ${params.motionPurpose}`,
            `Distinctive decisions: ${params.distinctiveDecisions.join(", ")}`,
            `Rejected alternative: ${params.rejectedAlternative}`,
            `Media plan: ${params.mediaPlan}`,
            `Media fallback: ${params.mediaFallback}`,
          ].join("\n"),
          metadata: {
            direction: params.direction,
            distinctiveDecisions: [...params.distinctiveDecisions],
          },
        }),
    } satisfies Tool.DefWithoutID<typeof Parameters, Metadata>
  }),
)
