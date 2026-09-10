import type { ApiDocEntry } from "./types"

export function formatApiDocumentation(entries: ApiDocEntry[]): string {
  let doc = "# API Reference\n\n"

  for (const entry of entries) {
    doc += `## \`${entry.symbolName}\`\n\n`
    doc += `**Kind**: ${entry.kind}\n\n`
    doc += "```ts\n" + entry.signature + "\n```\n\n"
    doc += `${entry.description}\n\n`

    if (entry.parameters && entry.parameters.length > 0) {
      doc += "### Parameters\n\n"
      for (const p of entry.parameters) {
        doc += `- \`${p.name}\` (\`${p.type}\`): ${p.description}\n`
      }
      doc += "\n"
    }

    if (entry.returnType) {
      doc += `**Returns**: \`${entry.returnType}\`\n\n`
    }
  }

  return doc
}
