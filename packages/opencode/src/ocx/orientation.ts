export type OrientationContext = {
  readonly workflow: string
  readonly phase: string
  readonly owner?: string
  readonly availableTools?: readonly string[]
  readonly verification?: readonly string[]
  readonly recovery?: readonly string[]
  readonly constraints?: readonly string[]
}

export function formatCapabilityOrientation(context: OrientationContext): string {
  const capabilities = phaseCapabilities(context.phase)
  const tools = context.availableTools?.filter((tool) => capabilities.some((capability) => capability.toLocaleLowerCase().includes(tool.toLocaleLowerCase())))
  const lines = [
    `OCX orientation: workflow=${context.workflow}; phase=${context.phase}.`,
    `Capabilities: ${capabilities.join("; ")}.`,
    ...(context.owner ? [`Owner boundary: ${context.owner}.`] : []),
    ...(tools && tools.length > 0 ? [`Relevant tools: ${tools.join(", ")}.`] : []),
    ...(context.verification && context.verification.length > 0 ? [`Verification: ${context.verification.join("; ")}.`] : []),
    ...(context.recovery && context.recovery.length > 0 ? [`Recovery: ${context.recovery.join("; ")}.`] : []),
    ...(context.constraints && context.constraints.length > 0 ? [`Constraints: ${context.constraints.join("; ")}.`] : []),
  ]
  return lines.join("\n")
}

export const AgentOrientation = { formatCapabilityOrientation }

function phaseCapabilities(phase: string): readonly string[] {
  const normalized = phase.toLocaleLowerCase()
  if (/(?:discover|understand|inspect|gather|frame|triage|context|orient)/.test(normalized)) return ["inspect repository context, read source, and search dependencies before deciding", "verify caller contracts and ground truth", "explore autonomously"]
  if (/(?:plan|define|prepare|hypothesize)/.test(normalized)) return ["formulate concrete verifiable checks and target paths", "decompose complex dependencies for parallel execution", "prepare surgical mutations"]
  if (/(?:act|change|build|implement|edit|mutate)/.test(normalized)) return ["execute surgical mutations across read, edit, write, and shell tools", "keep dependent changes ordered", "verify changed behavior empirically"]
  if (/(?:validate|verify|check|test|observe|remeasure|recover|evaluate)/.test(normalized)) return ["execute test, typecheck, and build verification tools", "capture empirical evidence and failure logs", "bounded feedback loop: repair on failure"]
  if (/(?:audit|review|diagnose|converge)/.test(normalized)) return ["use read, search, and diff tools to inspect the complete changed surface", "verify test evidence and anti-slop rules", "do not claim completion without proof"]
  if (/(?:deliver|commit|release|signoff)/.test(normalized)) return ["reconcile task state before delivery", "report verified evidence and outcomes", "deliver clean final result"]
  return ["execute autonomous feedback loops", "use the smallest coherent change", "verify empirically"]
}
