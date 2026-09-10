import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Context, Effect, Layer } from "effect"

import { InstanceState } from "@/effect/instance-state"

import PROMPT_PHASE_RULES from "../ocx/prompt/ocx-phase-rules.txt"
import PROMPT_OPENCODEX from "../ocx/prompt/opencodex.txt"
import PROMPT_THINKING from "../ocx/prompt/ocx-thinking.txt"
import type { Provider } from "@/provider/provider"
import type { Agent } from "@/agent/agent"
import { Permission } from "@/permission"
import { Skill } from "@/skill"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Location } from "@opencode-ai/core/location"
import { LocationServiceMap, locationServiceMapLayer } from "@opencode-ai/core/location-services"
import { Reference } from "@opencode-ai/core/reference"
import { MCP } from "@/mcp"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { Codebase } from "@/ocx/codebase/service"

type ProviderInput = {
  readonly mode?: Agent.Info["mode"]
  readonly hidden?: boolean
  readonly small?: boolean
  readonly pipeline?: boolean
}

type EnvironmentInput = {
  readonly model: Pick<Provider.Model, "api" | "providerID" | "variants">
  readonly variant?: string
  readonly sessionID?: string
}

const PROMPTS = [PROMPT_OPENCODEX, PROMPT_THINKING]

export function provider(input: ProviderInput = {}): string[] {
  if (input.small || input.hidden) return []
  if (input.mode !== "primary" && input.mode !== "all" && input.mode !== "subagent") return [...PROMPTS]
  if (input.pipeline) return [...PROMPTS]
  return [...PROMPTS, PROMPT_PHASE_RULES]
}

export interface Interface {
  readonly environment: (input: EnvironmentInput) => Effect.Effect<string[]>
  readonly skills: (agent: Agent.Info) => Effect.Effect<string | undefined>
  readonly mcp: (agent: Agent.Info, permission?: PermissionV1.Ruleset) => Effect.Effect<string | undefined>
}

export function modelIdentity(input: EnvironmentInput) {
  const variant = input.variant && input.variant !== "default" ? input.variant : undefined
  const options = variant ? input.model.variants?.[variant] : undefined
  const reasoningEffort = typeof options?.reasoningEffort === "string" ? options.reasoningEffort : undefined
  const slug = [input.model.api.id, variant]
    .filter((value): value is string => Boolean(value))
    .join("-")
    .replace(/[^A-Za-z0-9._-]+/g, "-")

  return [
    `You are powered by the model named ${input.model.api.id}. The exact model ID is ${input.model.providerID}/${input.model.api.id}`,
    `Selected model variant: ${variant ?? "default"}`,
    ...(reasoningEffort ? [`Reasoning effort: ${reasoningEffort}`] : []),
    `Benchmark model slug: ${slug}`,
    "When a benchmark output path contains the literal <model>, replace only that placeholder with the benchmark model slug above.",
  ].join("\n")
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SystemPrompt") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const skill = yield* Skill.Service
    const mcp = yield* MCP.Service
    const locations = yield* LocationServiceMap.Service
    const codebase = yield* Codebase.Service

    return Service.of({
      environment: Effect.fn("SystemPrompt.environment")(function* (input: EnvironmentInput) {
        const ctx = yield* InstanceState.context
        const references = yield* Effect.gen(function* () {
          return (yield* (yield* Reference.Service).list()).filter((reference) => reference.description !== undefined)
        }).pipe(Effect.provide(locations.get(Location.Ref.make({ directory: AbsolutePath.make(ctx.directory) }))))
        const codebaseContext = yield* codebase.context(input.sessionID)
        return [
          [
            modelIdentity(input),
            `Here is some useful information about the environment you are running in:`,
            `<env>`,
            `  Working directory: ${ctx.directory}`,
            `  Workspace root folder: ${ctx.worktree}`,
            `  Is directory a git repo: ${ctx.project.vcs === "git" ? "yes" : "no"}`,
            `  Platform: ${process.platform}`,
            `  Today's date: ${new Date().toDateString()}`,
            `</env>`,
          ].join("\n"),
          references.length === 0
            ? undefined
            : [
                "Project references provide additional directories that can be accessed when relevant.",
                "<available_references>",
                ...references
                  .toSorted((a, b) => a.name.localeCompare(b.name))
                  .flatMap((reference) => [
                    "  <reference>",
                    `    <name>${reference.name}</name>`,
                    `    <path>${reference.path}</path>`,
                    ...(reference.description === undefined
                      ? []
                      : [`    <description>${reference.description}</description>`]),
                    "  </reference>",
                  ]),
                "</available_references>",
              ].join("\n"),
          codebaseContext,
        ].filter((part): part is string => part !== undefined)
      }),

      skills: Effect.fn("SystemPrompt.skills")(function* (agent: Agent.Info) {
        if (Permission.disabled(["skill"], agent.permission).has("skill")) return

        const list = yield* skill.available(agent)

        return [
          "Skills provide specialized instructions and workflows for specific tasks.",
          "Use the skill tool to load a skill when a task matches its description.",
          // the agents seem to ingest the information about skills a bit better if we present a more verbose
          // version of them here and a less verbose version in tool description, rather than vice versa.
          Skill.fmt(list, { verbose: true }),
        ].join("\n")
      }),

      mcp: Effect.fn("SystemPrompt.mcp")(function* (agent: Agent.Info, permission?: PermissionV1.Ruleset) {
        const ruleset = Permission.merge(agent.permission, permission ?? [])
        const instructions = (yield* mcp.instructions()).filter(
          (item) => item.tools.length === 0 || Permission.disabled(item.tools, ruleset).size < item.tools.length,
        )
        if (instructions.length === 0) return

        return [
          "<mcp_instructions>",
          ...instructions.flatMap((item) => [
            `  <server name="${item.name}">`,
            ...item.instructions.split("\n").map((line) => `    ${line}`),
            "  </server>",
          ]),
          "</mcp_instructions>",
        ].join("\n")
      }),
    })
  }),
)

const locationServiceMapNode = LayerNode.make({
  service: LocationServiceMap.Service,
  layer: locationServiceMapLayer,
  deps: [],
})

export const node = LayerNode.make({
  service: Service,
  layer: layer,
  deps: [Skill.node, MCP.node, Codebase.node, locationServiceMapNode],
})

export * as SystemPrompt from "./system"
