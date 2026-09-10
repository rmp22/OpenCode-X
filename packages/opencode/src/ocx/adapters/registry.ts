import type { DomainAdapter, DomainDetectionContext, DomainKind } from "./types"
import { webAdapter } from "./web"
import { systemsAdapter } from "./systems"
import { backendAdapter } from "./backend"
import { mobileAdapter } from "./mobile"

export class AdapterRegistry {
  private readonly adapters = new Map<DomainKind, DomainAdapter>()

  constructor() {
    this.register(webAdapter)
    this.register(systemsAdapter)
    this.register(backendAdapter)
    this.register(mobileAdapter)
  }

  register(adapter: DomainAdapter): void {
    this.adapters.set(adapter.kind, adapter)
  }

  get(kind: DomainKind): DomainAdapter | undefined {
    return this.adapters.get(kind)
  }

  detectActive(context: DomainDetectionContext): readonly DomainAdapter[] {
    const active: DomainAdapter[] = []
    for (const adapter of this.adapters.values()) {
      if (adapter.detect(context)) {
        active.push(adapter)
      }
    }
    return active
  }
}

export const sharedAdapterRegistry = new AdapterRegistry()

export * as AdapterRegistryModule from "./registry"
