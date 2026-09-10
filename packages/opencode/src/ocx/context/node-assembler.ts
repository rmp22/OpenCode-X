import type { CapabilityProfile } from "../graph/capabilities"
import type { EvidenceRecord } from "../graph/types"
import type { WorkStep } from "../work/model"

export type ContextDeclaration = {
  readonly requiredContext?: readonly string[]
  readonly optionalContext?: readonly string[]
  readonly excludedContext?: readonly string[]
  readonly maxChars?: number
  readonly maxTokens?: number
}

export type NodeContext = {
  readonly nodeId: string
  readonly instruction: string
  readonly activeStep?: WorkStep
  readonly capabilities: CapabilityProfile
  readonly relevantFiles: readonly string[]
  readonly domainGuidance?: string
  readonly practicePacks?: string
  readonly recentEvidence?: readonly EvidenceRecord[]
}

export type AssembledNodeContext = {
  readonly promptEnvelope: string
  readonly charCount: number
  readonly tokenCountEstimated: number
  readonly truncatedSections: readonly string[]
  readonly admittedSections: readonly string[]
}

type InternalSection = {
  readonly name: string
  readonly content: string
  readonly priority: number
  readonly isStatic: boolean
  readonly isRequired: boolean
}

export class NodeContextAssembler {
  static assemble(
    ctx: NodeContext,
    declaration?: ContextDeclaration,
  ): AssembledNodeContext {
    const budgetChars = declaration?.maxTokens
      ? declaration.maxTokens * 4
      : declaration?.maxChars ?? 10000

    const excluded = new Set(declaration?.excludedContext ?? [])
    const explicitRequired = new Set(declaration?.requiredContext ?? [])

    const sections: InternalSection[] = []

    if (!excluded.has("nodeInstruction")) {
      const isReq = explicitRequired.has("nodeInstruction") || true
      sections.push({
        name: "nodeInstruction",
        content: "=== NODE INSTRUCTION (" + ctx.nodeId + ") ===\n" + ctx.instruction + "\n=== END NODE INSTRUCTION ===",
        priority: 1,
        isStatic: true,
        isRequired: isReq,
      })
    }

    if (!excluded.has("capabilities")) {
      const isReq = explicitRequired.has("capabilities") || true
      sections.push({
        name: "capabilities",
        content: "=== CAPABILITIES ===\nALLOWED: " + ctx.capabilities.allowedTools.join(", ") + "\nDENIED: " + ctx.capabilities.deniedTools.join(", ") + "\n=== END CAPABILITIES ===",
        priority: 1,
        isStatic: true,
        isRequired: isReq,
      })
    }

    if (ctx.domainGuidance && !excluded.has("domainGuidance")) {
      const isReq = explicitRequired.has("domainGuidance")
      sections.push({
        name: "domainGuidance",
        content: ctx.domainGuidance,
        priority: 3,
        isStatic: true,
        isRequired: isReq,
      })
    }

    if (ctx.practicePacks && !excluded.has("practicePacks")) {
      const isReq = explicitRequired.has("practicePacks")
      sections.push({
        name: "practicePacks",
        content: ctx.practicePacks,
        priority: 4,
        isStatic: true,
        isRequired: isReq,
      })
    }

    if (ctx.activeStep && !excluded.has("activeStep")) {
      const isReq = explicitRequired.has("activeStep") || true
      sections.push({
        name: "activeStep",
        content: "=== ACTIVE STEP ===\n" + ctx.activeStep.title + ": " + ctx.activeStep.action + "\n=== END ACTIVE STEP ===",
        priority: 2,
        isStatic: false,
        isRequired: isReq,
      })
    }

    if (ctx.relevantFiles && ctx.relevantFiles.length > 0 && !excluded.has("relevantFiles")) {
      const isReq = explicitRequired.has("relevantFiles")
      sections.push({
        name: "relevantFiles",
        content: "=== RELEVANT FILES ===\n" + ctx.relevantFiles.join("\n") + "\n=== END RELEVANT FILES ===",
        priority: 5,
        isStatic: false,
        isRequired: isReq,
      })
    }

    if (ctx.recentEvidence && ctx.recentEvidence.length > 0 && !excluded.has("recentEvidence")) {
      const isReq = explicitRequired.has("recentEvidence")
      sections.push({
        name: "recentEvidence",
        content: "=== RECENT EVIDENCE ===\n" + ctx.recentEvidence.map((e) => "- [" + e.kind + "] " + e.detail).join("\n") + "\n=== END RECENT EVIDENCE ===",
        priority: 6,
        isStatic: false,
        isRequired: isReq,
      })
    }

    const requiredSections = sections.filter((s) => s.isRequired)
    const optionalSections = sections.filter((s) => !s.isRequired)
    optionalSections.sort((a, b) => a.priority - b.priority)

    const admitted: InternalSection[] = [...requiredSections]
    const truncatedSections: string[] = []

    let currentLength = admitted.map((s) => s.content).join("\n\n").length

    for (const opt of optionalSections) {
      const additional = opt.content.length + 2
      if (currentLength + additional <= budgetChars) {
        admitted.push(opt)
        currentLength += additional
      } else {
        truncatedSections.push(opt.name)
      }
    }

    admitted.sort((a, b) => {
      if (a.isStatic && !b.isStatic) return -1
      if (!a.isStatic && b.isStatic) return 1
      return a.priority - b.priority
    })

    const promptEnvelope = admitted.map((s) => s.content).join("\n\n")
    const charCount = promptEnvelope.length
    const tokenCountEstimated = Math.round(charCount / 4)

    const result: AssembledNodeContext = {
      promptEnvelope,
      charCount,
      tokenCountEstimated,
      truncatedSections,
      admittedSections: admitted.map((s) => s.name),
    }
    return result
  }
}

export * as NodeContextAssemblerModule from "./node-assembler"
