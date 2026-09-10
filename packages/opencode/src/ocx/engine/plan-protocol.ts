import { z } from "zod"

export const PlanStepSchema = z.object({
  id: z.string().min(1),
  action: z.string().min(1),
  target: z.string().optional(),
  checks: z.array(z.string()).default([]),
  dependencies: z.array(z.string()).default([]),
})

export const WorkstreamSchema = z.object({
  id: z.string().min(1),
  goal: z.string().min(1),
  steps: z.array(PlanStepSchema).min(1),
})

export const PlanDocumentSchema = z.object({
  goal: z.string().min(1),
  workstreams: z.array(WorkstreamSchema).min(1),
})

export type PlanDocument = z.infer<typeof PlanDocumentSchema>
export type WorkstreamInput = z.infer<typeof WorkstreamSchema>
export type PlanStepInput = z.infer<typeof PlanStepSchema>

export function validatePlanDocument(input: unknown): {
  readonly success: boolean
  readonly plan?: PlanDocument
  readonly errors?: readonly string[]
} {
  const result = PlanDocumentSchema.safeParse(input)
  if (result.success) {
    return {
      success: true,
      plan: result.data,
    }
  }
  return {
    success: false,
    errors: result.error.issues.map((e) => `${e.path.join(".")}: ${e.message}`),
  }
}

export * as PlanProtocol from "./plan-protocol"
