export interface StreamChunk {
  id: string
  delta: string
  index: number
  done?: boolean
}

export interface SseMessage {
  event?: string
  data: string
  id?: string
  retry?: number
}

export class IncrementalChunkBuffer {
  private chunks: string[] = []
  private totalLength = 0

  append(chunk: string): string {
    this.chunks.push(chunk)
    this.totalLength += chunk.length
    return chunk
  }

  getSnapshot(): string {
    if (this.chunks.length === 0) return ""
    if (this.chunks.length === 1) return this.chunks[0]
    const joined = this.chunks.join("")
    this.chunks = [joined]
    return joined
  }

  get length(): number {
    return this.totalLength
  }

  get chunkCount(): number {
    return this.chunks.length
  }

  reset(): void {
    this.chunks = []
    this.totalLength = 0
  }
}

export function formatSseFrame(message: SseMessage): string {
  let frame = ""
  if (message.id !== undefined) {
    frame += `id: ${message.id}\n`
  }
  if (message.event !== undefined) {
    frame += `event: ${message.event}\n`
  }
  if (message.retry !== undefined) {
    frame += `retry: ${message.retry}\n`
  }
  const lines = message.data.split("\n")
  for (const line of lines) {
    frame += `data: ${line}\n`
  }
  frame += "\n"
  return frame
}

export function formatSsePing(): string {
  return ": ping\n\n"
}

export function formatSseTerminal(sentinel = "[DONE]"): string {
  return `event: done\ndata: ${sentinel}\n\n`
}

export interface StreamHotPathPipelineOptions<T> {
  highWaterMark?: number
  signal?: AbortSignal
  onDisconnect?: () => void
}

export class StreamHotPathPipeline<T> {
  private queue: T[] = []
  private waitingResolvers: Array<() => void> = []
  private closed = false
  private error: unknown = null
  private readonly highWaterMark: number
  private readonly signal?: AbortSignal
  private readonly onDisconnect?: () => void
  private abortListener?: () => void

  constructor(options?: StreamHotPathPipelineOptions<T>) {
    this.highWaterMark = options?.highWaterMark ?? 64
    this.signal = options?.signal
    this.onDisconnect = options?.onDisconnect

    if (this.signal) {
      if (this.signal.aborted) {
        this.closed = true
      } else {
        this.abortListener = () => {
          this.closed = true
          this.onDisconnect?.()
          this.wakeAll()
        }
        this.signal.addEventListener("abort", this.abortListener, { once: true })
      }
    }
  }

  async push(item: T): Promise<boolean> {
    if (this.closed || this.signal?.aborted) return false

    this.queue.push(item)
    this.wakeOne()

    if (this.queue.length >= this.highWaterMark) {
      await new Promise<void>((resolve) => {
        this.waitingResolvers.push(resolve)
      })
    }

    return !this.closed
  }

  end(): void {
    if (this.closed) return
    this.closed = true
    this.cleanup()
    this.wakeAll()
  }

  fail(err: unknown): void {
    if (this.closed) return
    this.error = err
    this.closed = true
    this.cleanup()
    this.wakeAll()
  }

  private cleanup(): void {
    if (this.abortListener && this.signal) {
      this.signal.removeEventListener("abort", this.abortListener)
    }
  }

  private wakeOne(): void {
    if (this.waitingResolvers.length > 0) {
      const resolve = this.waitingResolvers.shift()
      resolve?.()
    }
  }

  private wakeAll(): void {
    while (this.waitingResolvers.length > 0) {
      const resolve = this.waitingResolvers.shift()
      resolve?.()
    }
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<T, void, unknown> {
    try {
      while (true) {
        if (this.queue.length > 0) {
          const item = this.queue.shift()!
          this.wakeOne()
          yield item
          continue
        }

        if (this.closed) {
          if (this.error) throw this.error
          return
        }

        await new Promise<void>((resolve) => {
          this.waitingResolvers.push(resolve)
        })
      }
    } finally {
      this.closed = true
      this.cleanup()
      this.wakeAll()
    }
  }
}
