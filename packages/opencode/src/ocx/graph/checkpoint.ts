import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { Global } from "@opencode-ai/core/global"
import type { GraphCheckpoint } from "./types"

export interface CheckpointStorage {
  save(checkpoint: GraphCheckpoint): void
  load(checkpointId: string): GraphCheckpoint | undefined
  latestForSession(sessionID: string): GraphCheckpoint | undefined
  listForSession(sessionID: string): readonly GraphCheckpoint[]
}

export class FileCheckpointStorage implements CheckpointStorage {
  private readonly dir: string
  private readonly memory = new Map<string, GraphCheckpoint>()

  constructor(baseDir?: string) {
    this.dir = baseDir ?? join(Global.Path.data, "checkpoints")
    try {
      if (!existsSync(this.dir)) {
        mkdirSync(this.dir, { recursive: true })
      }
    } catch (_err) {
      void _err
    }
  }

  save(checkpoint: GraphCheckpoint): void {
    this.memory.set(checkpoint.checkpointId, checkpoint)
    try {
      if (!existsSync(this.dir)) {
        mkdirSync(this.dir, { recursive: true })
      }
      const filePath = join(this.dir, `${checkpoint.checkpointId}.json`)
      writeFileSync(filePath, JSON.stringify(checkpoint, null, 2), "utf8")
    } catch (_err) {
      void _err
    }
  }

  load(checkpointId: string): GraphCheckpoint | undefined {
    if (this.memory.has(checkpointId)) {
      return this.memory.get(checkpointId)
    }
    try {
      const filePath = join(this.dir, `${checkpointId}.json`)
      if (existsSync(filePath)) {
        const raw = readFileSync(filePath, "utf8")
        const parsed = JSON.parse(raw) as GraphCheckpoint
        this.memory.set(checkpointId, parsed)
        return parsed
      }
    } catch (_err) {
      void _err
    }
    return undefined
  }

  latestForSession(sessionID: string): GraphCheckpoint | undefined {
    const list = this.listForSession(sessionID)
    return list.length > 0 ? list[list.length - 1] : undefined
  }

  listForSession(sessionID: string): readonly GraphCheckpoint[] {
    const list: GraphCheckpoint[] = []
    for (const chk of this.memory.values()) {
      if (chk.sessionID === sessionID) {
        list.push(chk)
      }
    }
    return list.sort((a, b) => a.timestamp - b.timestamp)
  }
}

export const defaultCheckpointStorage = new FileCheckpointStorage()

export * as GraphCheckpointModule from "./checkpoint"
