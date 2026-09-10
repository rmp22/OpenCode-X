import path from "node:path"
import { createHash } from "node:crypto"

export type AssetEntry = {
  readonly url: string
  readonly dest: string
  readonly alt: string
  readonly minWidth?: number
  readonly maxKB?: number
}

export type ManifestRecord = {
  readonly dest: string
  readonly url: string
  readonly bytes: number
  readonly sha256: string
  readonly alt: string
}

export type FetchResult = ManifestRecord & {
  readonly skipped: boolean
}

const IMAGE_EXT = /\.(?:avif|gif|jpe?g|png|svg|webp)$/i
const ALLOW_HOST = /(?:images\.unsplash\.com|images\.pexels\.com|cdn\.pixabay\.com|picsum\.photos)$/i

export function validateManifest(entries: readonly AssetEntry[]): string[] {
  const errors: string[] = []
  const dests = new Set<string>()
  for (const [index, entry] of entries.entries()) {
    if (!/^https?:\/\//i.test(entry.url)) errors.push(`entry ${index}: url must be http(s): ${entry.url}`)
    else {
      const host = /^https?:\/\/([^/:?#]+)/i.exec(entry.url)?.[1]?.toLowerCase() ?? ""
      if (!ALLOW_HOST.test(host)) errors.push(`entry ${index}: host is not an approved stock-photo host: ${host}`)
    }
    if (!IMAGE_EXT.test(entry.dest)) errors.push(`entry ${index}: dest must end in an image extension: ${entry.dest}`)
    if (entry.dest.includes("..") || path.isAbsolute(entry.dest)) errors.push(`entry ${index}: dest must be a project-relative path: ${entry.dest}`)
    if (!entry.alt.trim() || entry.alt.trim().length < 12)
      errors.push(`entry ${index}: alt must describe the image in at least 12 characters`)
    if (dests.has(entry.dest)) errors.push(`entry ${index}: duplicate dest ${entry.dest}`)
    dests.add(entry.dest)
  }
  return errors
}

export function magicValid(data: Uint8Array, dest: string): boolean {
  if (data.length < 12) return false
  if (/\.jpe?g$/i.test(dest)) return data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff
  if (/\.png$/i.test(dest))
    return (
      data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47 && data[4] === 0x0d && data[5] === 0x0a && data[6] === 0x1a && data[7] === 0x0a
    )
  if (/\.gif$/i.test(dest)) return data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x38
  if (/\.webp$/i.test(dest))
    return data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46 && data[8] === 0x57 && data[9] === 0x45 && data[10] === 0x42 && data[11] === 0x50
  return true
}

export function sha256(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex")
}

export async function fetchAssets(
  entries: readonly AssetEntry[],
  cwd: string,
  options: { readonly concurrency?: number; readonly timeoutMs?: number } = {},
): Promise<FetchResult[]> {
  const errors = validateManifest(entries)
  if (errors.length > 0) throw new Error(`Invalid asset manifest:\n${errors.join("\n")}`)
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 4, 8))
  const timeoutMs = options.timeoutMs ?? 30_000
  const results: FetchResult[] = new Array(entries.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(concurrency, entries.length) }, async () => {
    while (cursor < entries.length) {
      const index = cursor++
      const entry = entries[index]!
      results[index] = await fetchOne(entry, cwd, timeoutMs)
    }
  })
  await Promise.all(workers)
  const manifest: ManifestRecord[] = results.map((result) => ({
    dest: result.dest,
    url: result.url,
    bytes: result.bytes,
    sha256: result.sha256,
    alt: result.alt,
  }))
  await Bun.write(path.join(cwd, "assets", "manifest.json"), `${JSON.stringify(manifest, undefined, 2)}\n`)
  return results
}

async function fetchOne(entry: AssetEntry, cwd: string, timeoutMs: number): Promise<FetchResult> {
  const target = path.join(cwd, entry.dest)
  const existing = Bun.file(target)
  if (await existing.exists()) {
    const data = new Uint8Array(await existing.arrayBuffer())
    if (magicValid(data, entry.dest)) {
      const maxBytes = (entry.maxKB ?? 1024) * 1024
      if (data.length <= maxBytes)
        return { dest: entry.dest, url: entry.url, bytes: data.length, sha256: sha256(data), alt: entry.alt, skipped: true }
    }
  }
  const response = await fetch(entry.url, { signal: AbortSignal.timeout(timeoutMs) })
  if (!response.ok) throw new Error(`Download failed for ${entry.url}: HTTP ${response.status}`)
  const data = new Uint8Array(await response.arrayBuffer())
  if (!magicValid(data, entry.dest)) throw new Error(`Downloaded bytes for ${entry.dest} fail the image magic check`)
  const maxBytes = (entry.maxKB ?? 1024) * 1024
  if (data.length > maxBytes) throw new Error(`${entry.dest} is ${data.length} bytes, over the ${maxBytes} byte budget`)
  await Bun.write(target, data)
  return { dest: entry.dest, url: entry.url, bytes: data.length, sha256: sha256(data), alt: entry.alt, skipped: false }
}

export * as AssetPipeline from "./asset-pipeline"
