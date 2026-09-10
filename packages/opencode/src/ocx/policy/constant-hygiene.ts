export type SemanticLiteralClassification =
  | "REUSE_EXISTING"
  | "DEFINE_DOMAIN_CONSTANT"
  | "USE_CONFIG"
  | "ALLOW_INLINE"

export type SemanticLiteralFinding = {
  readonly literal: string | number
  readonly classification: SemanticLiteralClassification
  readonly severity: "ERROR" | "ADVISORY" | "ALLOW"
  readonly suggestedSymbol?: string
  readonly ownerModule?: string
  readonly reason: string
}

export type DomainConstantRegistration = {
  readonly symbol: string
  readonly value: string | number
  readonly ownerModule: string
  readonly description: string
}

const CANONICAL_DOMAIN_CONSTANTS: DomainConstantRegistration[] = [
  {
    symbol: "DEFAULT_GRAPH_TOKEN_BUDGET",
    value: 100000,
    ownerModule: "@/ocx/graph",
    description: "Default token allowance allocated to graph execution engine",
  },
  {
    symbol: "DEFAULT_EVIDENCE_MAX_AGE_MS",
    value: 3600000,
    ownerModule: "@/ocx/evidence",
    description: "Default expiration window for verification evidence freshness",
  },
  {
    symbol: "MAX_RECOVERY_ATTEMPTS",
    value: 3,
    ownerModule: "@/ocx/loops",
    description: "Maximum consecutive loop recovery attempts before circuit break",
  },
  {
    symbol: "SUSPENSION_KIND_APPROVAL",
    value: "approval",
    ownerModule: "@/ocx/graph",
    description: "Suspension state requesting explicit user approval",
  },
  {
    symbol: "SUSPENSION_KIND_VERIFICATION_FAILURE",
    value: "verification_failure",
    ownerModule: "@/ocx/graph",
    description: "Suspension state triggered by unpassed required verification evidence",
  },
]

export function getRegisteredConstants(): readonly DomainConstantRegistration[] {
  return CANONICAL_DOMAIN_CONSTANTS
}

export function registerDomainConstant(constant: DomainConstantRegistration): void {
  const exists = CANONICAL_DOMAIN_CONSTANTS.some((c) => c.symbol === constant.symbol)
  if (!exists) {
    CANONICAL_DOMAIN_CONSTANTS.push(constant)
  }
}

export function evaluateSemanticLiteral(
  literal: string | number,
  context: {
    readonly isArithmetic?: boolean
    readonly isConfigurable?: boolean
    readonly isSyntaxValue?: boolean
    readonly propertyName?: string
  } = {},
): SemanticLiteralFinding {
  if (context.isSyntaxValue || context.isArithmetic) {
    const finding: SemanticLiteralFinding = {
      literal,
      classification: "ALLOW_INLINE",
      severity: "ALLOW",
      reason: "Obvious local arithmetic or syntax literal kept inline for clarity",
    }
    return finding
  }

  if (typeof literal === "number" && (literal === 0 || literal === 1 || literal === -1)) {
    const finding: SemanticLiteralFinding = {
      literal,
      classification: "ALLOW_INLINE",
      severity: "ALLOW",
      reason: "Trivial boundary or index literal is clearer inline",
    }
    return finding
  }

  const registered = CANONICAL_DOMAIN_CONSTANTS.find((c) => c.value === literal)
  if (registered) {
    const finding: SemanticLiteralFinding = {
      literal,
      classification: "REUSE_EXISTING",
      severity: "ERROR",
      suggestedSymbol: registered.symbol,
      ownerModule: registered.ownerModule,
      reason: "Hardcoded semantic value duplicates canonical symbol " + registered.symbol + " from " + registered.ownerModule,
    }
    return finding
  }

  if (context.isConfigurable) {
    const finding: SemanticLiteralFinding = {
      literal,
      classification: "USE_CONFIG",
      severity: "ADVISORY",
      reason: "Environment-specific or tunable setting should be loaded from configuration",
    }
    return finding
  }

  if (typeof literal === "number" && literal >= 1000) {
    const finding: SemanticLiteralFinding = {
      literal,
      classification: "DEFINE_DOMAIN_CONSTANT",
      severity: "ADVISORY",
      reason: "Magic numeric duration or threshold should be extracted to a named domain constant",
    }
    return finding
  }

  const finding: SemanticLiteralFinding = {
    literal,
    classification: "ALLOW_INLINE",
    severity: "ALLOW",
    reason: "Literal does not violate domain constant rules",
  }
  return finding
}

export * as ConstantHygieneModule from "./constant-hygiene"
