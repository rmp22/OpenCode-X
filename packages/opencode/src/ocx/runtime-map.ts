export type SubsystemClassification = "CANONICAL" | "DUPLICATE" | "LEGACY" | "DEAD" | "MIGRATION_ONLY"

export interface SubsystemTrace {
  readonly id: string
  readonly name: string
  readonly canonical: readonly string[]
  readonly duplicate: readonly string[]
  readonly legacy: readonly string[]
  readonly dead: readonly string[]
  readonly migrationOnly: readonly string[]
}

export interface RuntimeMapBaseline {
  readonly commit: string
  readonly status: string
  readonly pinnedAt: string
  readonly subsystems: readonly SubsystemTrace[]
}

export const BASELINE_COMMIT = "27578d348bde24b452974305302f79c6334e4233"
export const BASELINE_STATUS = "clean"

export const SUBSYSTEM_TRACES: readonly SubsystemTrace[] = [
  {
    id: "search-tool-selection",
    name: "search/tool selection",
    canonical: [
      "packages/opencode/src/tool/grep.ts",
      "packages/opencode/src/tool/glob.ts",
      "packages/opencode/src/session/tools.ts",
      "packages/opencode/src/ocx/search/index.ts",
      "packages/core/src/ripgrep.ts",
    ],
    duplicate: [
      "packages/opencode/src/ocx/codebase/search.ts",
    ],
    legacy: [
      "packages/opencode/src/tool/shell.ts (direct shell search invocations)",
    ],
    dead: [
      "packages/opencode/src/ocx/search/cache.ts (partially unwired cache methods)",
    ],
    migrationOnly: [
      "packages/opencode/src/ocx/codebase/tool.ts",
    ],
  },
  {
    id: "bash-command-guarding",
    name: "bash command guarding",
    canonical: [
      "packages/opencode/src/tool/shell.ts",
      "packages/opencode/src/ocx/codebase/service.ts",
      "packages/opencode/src/ocx/search-routing.ts",
    ],
    duplicate: [
      "packages/opencode/src/ocx/shell-policy.ts",
    ],
    legacy: [
      "packages/opencode/src/tool/shell.ts (legacy regex command safety checks)",
    ],
    dead: [],
    migrationOnly: [
      "packages/opencode/src/ocx/codebase/search.ts (unconnected bash search advice)",
    ],
  },
  {
    id: "anti-slop-anti-tunnel",
    name: "anti-slop/anti-tunnel",
    canonical: [
      "packages/opencode/src/ocx/antislop/gate.ts",
      "packages/opencode/src/ocx/antislop/hard-rule-checker.ts",
      "packages/opencode/src/ocx/antislop/style-contract.ts",
      "packages/opencode/src/ocx/turn/claim.ts",
    ],
    duplicate: [
      "packages/opencode/src/ocx/antislop/architecture.ts",
      "packages/opencode/src/ocx/antislop/systems.ts",
    ],
    legacy: [
      "packages/opencode/src/ocx/prompt/ocx-structure.txt",
    ],
    dead: [
      "packages/opencode/src/ocx/antislop/test-slop.ts (unreachable strict checks)",
    ],
    migrationOnly: [
      "packages/opencode/src/ocx/turn/stages/",
    ],
  },
  {
    id: "greenfield-construction",
    name: "greenfield construction",
    canonical: [
      "packages/opencode/src/ocx/greenfield/scaffold.ts",
      "packages/opencode/src/ocx/greenfield/detector.ts",
      "packages/opencode/src/ocx/greenfield/validator.ts",
    ],
    duplicate: [
      "packages/opencode/src/ocx/codebase/profile.ts (embedded greenfield inference)",
    ],
    legacy: [
      "packages/opencode/src/tool/shell.ts (raw mkdir project bootstrap)",
    ],
    dead: [],
    migrationOnly: [
      "packages/opencode/src/ocx/greenfield/types.ts",
    ],
  },
  {
    id: "work-graph",
    name: "WorkGraph",
    canonical: [
      "packages/opencode/src/ocx/work-graph/runtime.ts",
      "packages/opencode/src/ocx/work-graph/compiler.ts",
      "packages/opencode/src/ocx/work-graph/reducer.ts",
      "packages/opencode/src/ocx/work-graph/projections.ts",
    ],
    duplicate: [
      "packages/opencode/src/ocx/turn/state.ts (step state duplication)",
    ],
    legacy: [
      "packages/opencode/src/session/todo.ts",
    ],
    dead: [
      "packages/opencode/src/ocx/work-graph/types.ts (unused edge predicates)",
    ],
    migrationOnly: [
      "packages/opencode/src/ocx/workstream-runner.ts",
    ],
  },
  {
    id: "findings",
    name: "findings",
    canonical: [
      "packages/opencode/src/ocx/findings/ledger.ts",
      "packages/opencode/src/ocx/findings/types.ts",
    ],
    duplicate: [
      "packages/opencode/src/ocx/context/service.ts (embedded findings array)",
    ],
    legacy: [
      "packages/opencode/src/ocx/context/evidence.ts",
    ],
    dead: [],
    migrationOnly: [
      "packages/opencode/src/ocx/findings/index.ts",
    ],
  },
  {
    id: "verification",
    name: "verification",
    canonical: [
      "packages/opencode/src/ocx/verification/runner.ts",
      "packages/opencode/src/ocx/verification/ladder.ts",
      "packages/opencode/src/ocx/verification/oracle.ts",
      "packages/opencode/src/ocx/verification/check-matcher.ts",
    ],
    duplicate: [
      "packages/opencode/src/ocx/turn/gate.ts",
    ],
    legacy: [
      "packages/opencode/src/tool/shell.ts (unstructured test running)",
    ],
    dead: [],
    migrationOnly: [
      "packages/opencode/src/ocx/verification/index.ts",
    ],
  },
  {
    id: "session-processor",
    name: "session processor",
    canonical: [
      "packages/opencode/src/session/processor.ts",
      "packages/opencode/src/session/stream.ts",
    ],
    duplicate: [
      "packages/opencode/src/ocx/turn/state.ts (secondary execution loop)",
    ],
    legacy: [
      "packages/opencode/src/session/prompt.ts",
    ],
    dead: [
      "packages/opencode/src/session/turn-lifecycle.ts (stale transition hooks)",
    ],
    migrationOnly: [
      "packages/opencode/src/session/run-state.ts",
    ],
  },
  {
    id: "retry-empty-response",
    name: "retry/empty response",
    canonical: [
      "packages/opencode/src/session/retry.ts",
      "packages/opencode/src/session/processor.ts",
    ],
    duplicate: [
      "packages/opencode/src/session/llm.ts",
    ],
    legacy: [
      "manual user continue prompts on empty model output",
    ],
    dead: [],
    migrationOnly: [
      "packages/opencode/src/session/message-error.ts",
    ],
  },
  {
    id: "activity-runtime",
    name: "activity runtime",
    canonical: [
      "packages/opencode/src/ocx/activity/runtime.ts",
      "packages/opencode/src/ocx/activity/types.ts",
    ],
    duplicate: [
      "packages/opencode/src/ocx/turn/state.ts (direct event bus emissions)",
    ],
    legacy: [
      "raw status strings without structured phase/step payloads",
    ],
    dead: [
      "packages/opencode/src/ocx/activity/selector.ts",
    ],
    migrationOnly: [
      "packages/opencode/src/ocx/activity/index.ts",
    ],
  },
  {
    id: "session-status",
    name: "session status",
    canonical: [
      "packages/opencode/src/session/status.ts",
    ],
    duplicate: [
      "packages/opencode/src/session/run-state.ts",
    ],
    legacy: [
      "unstructured boolean flags in legacy session entity",
    ],
    dead: [],
    migrationOnly: [
      "packages/schema/src/session-status-event.ts",
    ],
  },
  {
    id: "owner-subagent-activity",
    name: "owner/subagent activity",
    canonical: [
      "packages/opencode/src/agent/index.ts",
      "packages/opencode/src/session/processor.ts",
    ],
    duplicate: [
      "packages/opencode/src/ocx/turn/state.ts (agent tracker)",
    ],
    legacy: [
      "conflating parent session status with child subagent executions",
    ],
    dead: [],
    migrationOnly: [
      "packages/opencode/src/session/instruction.ts",
    ],
  },
  {
    id: "schema-sdk-tui-rendering",
    name: "schema/SDK/TUI status rendering",
    canonical: [
      "packages/schema/src/ocx-activity-event.ts",
      "packages/schema/src/session-status-event.ts",
      "packages/tui/src/ocx/activity-row.tsx",
      "packages/tui/src/context/sync.tsx",
    ],
    duplicate: [
      "packages/app/src/context/server-session.ts",
    ],
    legacy: [
      "packages/tui/src/ocx/delivery-header.tsx (raw reasoning displays)",
    ],
    dead: [],
    migrationOnly: [
      "packages/tui/src/ocx/workflow-rows.tsx",
    ],
  },
]

export const RUNTIME_MAP: RuntimeMapBaseline = {
  commit: BASELINE_COMMIT,
  status: BASELINE_STATUS,
  pinnedAt: "Thu Sep 10 2026",
  subsystems: SUBSYSTEM_TRACES,
}

export function getSubsystemTrace(id: string): SubsystemTrace | undefined {
  return SUBSYSTEM_TRACES.find((s) => s.id === id)
}

export * as RuntimeMap from "./runtime-map"
