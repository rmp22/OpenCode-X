import type { ScopeLevel, RequestIntent } from "./types"

export type DynamicScopePolicy = {
  readonly enabled: boolean
  readonly defaultStrategy: string
  readonly primaryRule: string
  readonly minimalPatch: {
    readonly default: boolean
    readonly onlyWhenExplicitlyRequestedOrProvenLocal: boolean
  }
  readonly dimensions: {
    readonly depth: { readonly min: number; readonly max: number }
    readonly width: { readonly min: number; readonly max: number }
    readonly coupling: { readonly min: number; readonly max: number }
    readonly risk: { readonly min: number; readonly max: number }
    readonly requestBreadth: { readonly min: number; readonly max: number }
  }
  readonly scopeLevels: readonly ScopeLevel[]
  readonly reevaluateOn: readonly string[]
  readonly wipSafety: {
    readonly protectUnrelatedChanges: boolean
    readonly destructiveGitOperations: string
    readonly impliesMinimalPatch: boolean
  }
  readonly completion: {
    readonly requireRootCauseCheck: boolean
    readonly requireEquivalentPathCheck: boolean
    readonly requireRemainingFindingsClassification: boolean
    readonly diffSizeIsValidPreservationReason: boolean
  }
}

export const DEFAULT_POLICY: DynamicScopePolicy = {
  enabled: true,
  defaultStrategy: "evidence_driven",
  primaryRule: "minimize_unnecessary_change_not_necessary_change",
  minimalPatch: {
    default: false,
    onlyWhenExplicitlyRequestedOrProvenLocal: true,
  },
  dimensions: {
    depth: { min: 0, max: 5 },
    width: { min: 0, max: 5 },
    coupling: { min: 0, max: 5 },
    risk: { min: 0, max: 5 },
    requestBreadth: { min: 0, max: 5 },
  },
  scopeLevels: ["local", "component", "feature", "subsystem", "structural"],
  reevaluateOn: [
    "new_shared_state",
    "duplicate_defect",
    "interface_change_required",
    "lifecycle_issue",
    "concurrency_issue",
    "test_reveals_wider_behavior",
    "root_cause_hypothesis_invalidated",
  ],
  wipSafety: {
    protectUnrelatedChanges: true,
    destructiveGitOperations: "forbidden_without_explicit_user_approval",
    impliesMinimalPatch: false,
  },
  completion: {
    requireRootCauseCheck: true,
    requireEquivalentPathCheck: true,
    requireRemainingFindingsClassification: true,
    diffSizeIsValidPreservationReason: false,
  },
}

export function loadPolicy(json: unknown): DynamicScopePolicy {
  if (!json || typeof json !== "object") return DEFAULT_POLICY
  const obj = json as Record<string, unknown>
  const dynamic = obj["dynamic_scope"] as Record<string, unknown> | undefined
  if (!dynamic) return DEFAULT_POLICY

  return {
    enabled: typeof dynamic["enabled"] === "boolean" ? dynamic["enabled"] : DEFAULT_POLICY.enabled,
    defaultStrategy:
      typeof dynamic["default_strategy"] === "string"
        ? dynamic["default_strategy"]
        : DEFAULT_POLICY.defaultStrategy,
    primaryRule:
      typeof dynamic["primary_rule"] === "string"
        ? dynamic["primary_rule"]
        : DEFAULT_POLICY.primaryRule,
    minimalPatch: {
      default:
        typeof dynamic["minimal_patch"] === "object" &&
        dynamic["minimal_patch"] !== null &&
        typeof (dynamic["minimal_patch"] as Record<string, unknown>)["default"] === "boolean"
          ? (dynamic["minimal_patch"] as Record<string, boolean>)["default"]
          : DEFAULT_POLICY.minimalPatch.default,
      onlyWhenExplicitlyRequestedOrProvenLocal:
        typeof dynamic["minimal_patch"] === "object" &&
        dynamic["minimal_patch"] !== null &&
        typeof (dynamic["minimal_patch"] as Record<string, unknown>)[
          "only_when_explicitly_requested_or_proven_local"
        ] === "boolean"
          ? (dynamic["minimal_patch"] as Record<string, boolean>)[
              "only_when_explicitly_requested_or_proven_local"
            ]
          : DEFAULT_POLICY.minimalPatch.onlyWhenExplicitlyRequestedOrProvenLocal,
    },
    dimensions: DEFAULT_POLICY.dimensions,
    scopeLevels: DEFAULT_POLICY.scopeLevels,
    reevaluateOn: DEFAULT_POLICY.reevaluateOn,
    wipSafety: DEFAULT_POLICY.wipSafety,
    completion: DEFAULT_POLICY.completion,
  }
}

export * as Policy from "./policy"
