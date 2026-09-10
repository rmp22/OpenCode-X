import { expect, test } from "bun:test"
import { createMarkdownParser } from "./marked-parser"

const parser = createMarkdownParser((code, language) => `<pre data-language="${language}">${code}</pre>`)

test("renders links with application attributes", async () => {
  expect(await parser.parse("[OpenCode](https://opencode.ai)")).toBe(
    '<p><a href="https://opencode.ai" class="external-link" target="_blank" rel="noopener noreferrer">OpenCode</a></p>\n',
  )
})

test("renders inline and block math", async () => {
  expect(await parser.parse("\\(x^2\\)")).toContain('<span class="katex">')
  expect(await parser.parse("$x^2$")).toContain('<span class="katex">')
  expect(await parser.parse("$$\nx^2\n$$\n")).toContain('<span class="katex-display">')
  expect(await parser.parse("\\[x^2\\]")).toContain('<span class="katex-display">')
})

test("renders single dollar math with text and underscores without italic mangling", async () => {
  const result = await parser.parse(
    "- Prime cluster ($\\text{weight} = 1.0$): gets 100% of maximum frequency ($R_{\\text{effective}} = 1.0$).",
  )
  expect(result).toContain('<span class="katex">')
  expect(result).toContain("weight")
  expect(result).not.toContain("<em>")
})

test("renders multiline and single-line display math blocks without newline padding", async () => {
  const singleLine = await parser.parse("$$R_{\\text{effective}, i} = R_{\\text{base}} \\times 1.0$$")
  expect(singleLine).toContain('<span class="katex-display">')
  expect(singleLine).not.toContain("<em>")

  const multiline = await parser.parse(
    "$$\\text{capacityWeight}_i = \\begin{cases} 1.0 & \\text{if } C_{\\max} = C_{\\min} \\\\ \\frac{C_i - C_{\\min}}{C_{\\max} - C_{\\min}} & \\text{otherwise} \\end{cases}$$",
  )
  expect(multiline).toContain('<span class="katex-display">')
  expect(multiline).not.toContain("<em>")
})

test("preserves currency values without treating them as math", async () => {
  expect(await parser.parse("Costs $100 and yields $50 back.")).not.toContain("katex")
  expect(await parser.parse("Price range: $100-$200.")).not.toContain("katex")
  expect(await parser.parse("Escape \\$100 value.")).toContain("$100")
  expect(await parser.parse("Escape \\$100 value.")).not.toContain("katex")
})

test("uses the configured code highlighter", async () => {
  expect(await parser.parse("```ts\nconst value = 1\n```\n")).toBe('<pre data-language="ts">const value = 1</pre>\n')
})
