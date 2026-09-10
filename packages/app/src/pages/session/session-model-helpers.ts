import type { UserMessage } from "@opencode-ai/sdk/v2"

type Local = {
  session: {
    reset(): void
    restore(msg: UserMessage): void
  }
}

type ModelSelection = {
  model: {
    current(): { id: string; provider: { id: string } } | undefined
    set(model: { providerID: string; modelID: string }): void
    variant: {
      current(): string | undefined
      set(variant: string | undefined): void
    }
  }
  agent?: {
    current(): { name: string; mode?: string } | undefined
    set(name: string | undefined): void
  }
}

type PromptState = {
  model: {
    current(): { providerID: string; modelID: string; variant?: string | null } | undefined
    set(model: { providerID: string; modelID: string; variant?: string | null }): void
  }
  agent?: {
    current(): { name: string; mode?: string } | undefined
    set(name: string | undefined): void
  }
}

export const resetSessionModel = (local: Local) => {
  local.session.reset()
}

export const syncSessionModel = (local: Local, msg: UserMessage) => {
  if (msg.agent === "explore" || msg.agent === "general") return
  local.session.restore(msg)
}

export const syncPromptModel = (local: ModelSelection, prompt: PromptState) => {
  const model = local.model.current()
  if (!model) return
  const next = {
    providerID: model.provider.id,
    modelID: model.id,
    variant: local.model.variant.current(),
  }
  const current = prompt.model.current()
  if (current?.providerID === next.providerID && current.modelID === next.modelID && current.variant === next.variant)
    return
  prompt.model.set(next)
}

export const restorePromptModel = (local: ModelSelection, prompt: PromptState) => {
  const model = prompt.model.current()
  let changed = false
  if (model) {
    const current = local.model.current()
    if (
      current?.provider.id !== model.providerID ||
      current.id !== model.modelID ||
      local.model.variant.current() !== (model.variant ?? undefined)
    ) {
      local.model.set({ providerID: model.providerID, modelID: model.modelID })
      local.model.variant.set(model.variant ?? undefined)
      changed = true
    }
  }
  const promptAgent = prompt.agent?.current?.()
  if (promptAgent && promptAgent.mode !== "subagent") {
    local.agent?.set(promptAgent.name)
    changed = true
  }
  return changed || Boolean(model)
}
