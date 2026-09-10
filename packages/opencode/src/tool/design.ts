import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./design.txt"

export const Parameters = Schema.Struct({
  audience: Schema.NonEmptyString,
  userTask: Schema.optional(Schema.String),
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

// Media plans that lean on dead or unverifiable hot-link services shipped
// broken pages in logged sessions; the plan must commit to local assets.
const DEAD_MEDIA_SERVICES = /\bsource\.unsplash\.com\b|\bplacekitten\b|\bplacehold\.co\b|\bfakeimg\b/i
const HOTLINK_PLAN = /(?:images\.unsplash\.com|images\.pexels\.com|cdn\.pixabay\.com|picsum\.photos)\//i

// Product surfaces live on their subject imagery: an SVG drawing where a
// photograph of the actual product belongs defeats the page's purpose no
// matter how polished it looks. One logged session shipped four hand-drawn
// SVG "houses" for a booking landing page while passing every asset gate.
export const PRODUCT_SIGNALS =
  /\b(?:landing|marketing|product|sell|selling|conversion|book(?:ing)?|reservation|property|properties|house|homes?|apartment|apartments|rental|rentals|stay|stays|hotel|listing|listings)\b/i
export const GENERATED_SUBJECT =
  /(?:mediaPlan|mediaBehavior)[^]*?(?:svg|illustration|drawn|generated (?:locally )?(?:svg|graphics)|vector)[^]*?/i

export const DesignTool = Tool.define<typeof Parameters, Metadata, never>(
  "design",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>) => {
        const thinDecision = params.distinctiveDecisions.find((d) => d.trim().split(/\s+/).length < 4)
        if (thinDecision)
          throw new Error(
            `distinctive decision "${thinDecision}" is too vague to shape anything. Each decision must name what it changes and why it fits this product (for example: "dark charcoal base because hospitality evenings", not "modern look"). Resubmit.`,
          )
        if (params.rejectedAlternative.trim().split(/\s+/).length < 4)
          throw new Error(
            'rejectedAlternative must name the pattern you refused and why. Resubmit.',
          )

        const mediaPlan = `${params.mediaPlan} ${params.mediaBehavior}`
        if (DEAD_MEDIA_SERVICES.test(mediaPlan))
          throw new Error(
            "mediaPlan names a dead image service (source.unsplash.com is shut down and returns 503). Plan downloaded local assets or generated SVG instead, then resubmit.",
          )
        if (HOTLINK_PLAN.test(mediaPlan))
          throw new Error(
            "mediaPlan hot-links stock CDNs; hot-linked URLs ship broken and were never verified. Commit to downloading licensed images into the project or generating local SVG placeholders, then resubmit.",
          )
        const userTask = params.userTask?.trim() || "Design and build web page"
        const productSurface = PRODUCT_SIGNALS.test(
          `${params.direction} ${params.pattern} ${userTask}`,
        )
        const generatedSubject =
          GENERATED_SUBJECT.test(`mediaPlan: ${params.mediaPlan}`) ||
          /(?:hero|house|homes?|room|property|product|listing)/i.test(params.mediaPlan)
        if (productSurface && generatedSubject && !/photo|photograph|download/i.test(mediaPlan))
          throw new Error(
            "This is a product surface: its subject must be real photography of the actual product, not generated SVG illustrations. SVG is for icons, logos, and abstract decoration only. Download licensed photographs into the project (or ask the user how to source them); if truly unavailable, say so explicitly in mediaFallback instead of substituting drawings. Then resubmit.",
          )
        return Effect.succeed({
          title: `Recorded design direction: ${params.direction}`,
          output: [
            "DESIGN DIRECTION",
            `Audience: ${params.audience}`,
            `User task: ${userTask}`,
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
          })
        }
      } satisfies Tool.DefWithoutID<typeof Parameters, Metadata>
  }),
)
