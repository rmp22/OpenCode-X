export * as TailBudget from "./tail-budget"

import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import type { Provider } from "@/provider/provider"
import { ProviderTransform } from "@/provider/transform"
import { usable } from "@/session/overflow"

const SYSTEM_RESERVE_FALLBACK = 20_000

export function tailBudget(input: {
  cfg: ConfigV1.Info
  model: Provider.Model
  digestModel: Provider.Model
  outputTokenMax?: number
}): number {
  const usableTokens = usable({ cfg: input.cfg, model: input.model, outputTokenMax: input.outputTokenMax })
  if (usableTokens <= 0) return 0
  const digestOutput = ProviderTransform.maxOutputTokens(input.digestModel, input.outputTokenMax)
  const systemReserve = input.cfg.compaction?.reserved ?? Math.min(SYSTEM_RESERVE_FALLBACK, digestOutput)
  return Math.max(0, usableTokens - digestOutput - systemReserve)
}
