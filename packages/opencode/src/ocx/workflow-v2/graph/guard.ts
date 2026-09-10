import { createHash } from "node:crypto"

export interface LoopGuardConfig {
  readonly maxCycles?: number
  readonly maxIdenticalErrors?: number
  readonly diffHistoryWindow?: number
}

export interface LoopIterationRecord {
  readonly iteration: number
  readonly errorHash?: string
  readonly diffHash?: string
  readonly timestamp: number
}

export interface LoopGuardEvaluation {
  readonly permitted: boolean
  readonly reason?: string
  readonly tripped: boolean
}

export class LoopGuard {
  readonly config: Required<LoopGuardConfig>
  private iteration = 0
  private consecutiveIdenticalErrors = 0
  private lastErrorHash?: string
  private readonly historicalErrorHashes: string[] = []
  private readonly historicalDiffHashes: string[] = []

  constructor(config: LoopGuardConfig = {}) {
    this.config = {
      maxCycles: config.maxCycles ?? 3,
      maxIdenticalErrors: config.maxIdenticalErrors ?? 1,
      diffHistoryWindow: config.diffHistoryWindow ?? 4,
    }
  }

  get currentIteration(): number {
    return this.iteration
  }

  recordIteration(errorHash?: string, diffHash?: string): LoopGuardEvaluation {
    this.iteration += 1

    if (this.iteration > this.config.maxCycles) {
      return {
        permitted: false,
        tripped: true,
        reason: `Cycle quota exceeded (${this.iteration}/${this.config.maxCycles})`,
      }
    }

    if (errorHash) {
      if (this.lastErrorHash && this.lastErrorHash === errorHash) {
        this.consecutiveIdenticalErrors += 1
        if (this.consecutiveIdenticalErrors >= this.config.maxIdenticalErrors) {
          return {
            permitted: false,
            tripped: true,
            reason: `Zero-progress thrashing detected: error signature unchanged across consecutive cycles (${errorHash.slice(0, 8)})`,
          }
        }
      } else {
        this.consecutiveIdenticalErrors = 0
      }
      this.lastErrorHash = errorHash
      this.historicalErrorHashes.push(errorHash)
    }

    if (diffHash) {
      const window = this.historicalDiffHashes.slice(-this.config.diffHistoryWindow)
      if (window.includes(diffHash)) {
        return {
          permitted: false,
          tripped: true,
          reason: `Oscillation detected: git diff reverted to previous state (${diffHash.slice(0, 8)})`,
        }
      }
      this.historicalDiffHashes.push(diffHash)
    }

    return {
      permitted: true,
      tripped: false,
    }
  }

  reset() {
    this.iteration = 0
    this.consecutiveIdenticalErrors = 0
    this.lastErrorHash = undefined
    this.historicalErrorHashes.length = 0
    this.historicalDiffHashes.length = 0
  }

  restore(iteration: number, lastErrorHash?: string) {
    this.iteration = Math.max(0, iteration)
    this.lastErrorHash = lastErrorHash
  }

  static computeErrorHash(filePath: string, line: number, message: string): string {
    const normalizedPath = filePath.replace(/\\/g, "/").trim().toLowerCase()
    const normalizedMessage = message.replace(/\s+/g, " ").trim().toLowerCase()
    return createHash("sha256")
      .update(`${normalizedPath}:${line}:${normalizedMessage}`)
      .digest("hex")
  }

  static computeDiffHash(diffOutput: string): string {
    const normalized = diffOutput.replace(/\r\n/g, "\n").trim()
    return createHash("sha256").update(normalized).digest("hex")
  }
}

export * as Guard from "./guard"
