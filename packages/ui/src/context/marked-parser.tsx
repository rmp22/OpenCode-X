import katex from "katex"
import { Marked, type MarkedExtension, type Tokens } from "marked"
import markedShiki from "marked-shiki"

export function createMarkdownParser(highlight: (code: string, language: string) => string | Promise<string>) {
  return new Marked(
    {
      renderer: {
        link({ href, title, text }) {
          const titleAttr = title ? ` title="${title}"` : ""
          return `<a href="${href}"${titleAttr} class="external-link" target="_blank" rel="noopener noreferrer">${text}</a>`
        },
      },
    },
    katexExtension,
    markedShiki({ highlight }),
  )
}

const blockMathRegex = /^[ ]{0,3}(?:\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\])[ \t]*(?:\n|$)/
const inlineMathRegex =
  /^(?:\$\$((?:\\.|[\s\S])+?)\$\$|\\\[((?:\\.|[\s\S])+?)\\\]|\\\((\s*(?:\\.|[^\n\\])+?\s*)\\\)|\$((?!\s)(?:\\.|[^$\\\n])+(?<!\s))\$(?!\w))/

function isEscaped(src: string, idx: number) {
  let count = 0
  for (let i = idx - 1; i >= 0 && src[i] === "\\"; i--) {
    count++
  }
  return count % 2 === 1
}

const katexExtension: MarkedExtension = {
  extensions: [
    {
      name: "blockKatex",
      level: "block",
      start(src) {
        const match = src.match(/(?:^|\n)[ ]{0,3}(?:\$\$|\\\[)/)
        if (!match || match.index === undefined) return
        return match.index + (match[0].startsWith("\n") ? 1 : 0)
      },
      tokenizer(src) {
        const match = src.match(blockMathRegex)
        if (!match) return
        return {
          type: "blockKatex",
          raw: match[0],
          text: (match[1] ?? match[2]).trim(),
          displayMode: true,
        }
      },
      renderer: renderKatexToken,
    },
    {
      name: "inlineKatex",
      level: "inline",
      start(src) {
        let pos = 0
        while (pos < src.length) {
          const match = src.slice(pos).match(/\$|\\\(|\\\[/)
          if (!match || match.index === undefined) return
          const idx = pos + match.index
          if (!isEscaped(src, idx)) {
            const isSingleDollar = match[0] === "$" && src[idx + 1] !== "$"
            const isPrecededByWord = idx > 0 && /\w/.test(src[idx - 1])
            if (!isSingleDollar || !isPrecededByWord) {
              const possible = src.slice(idx)
              if (possible.match(inlineMathRegex)) return idx
            }
          }
          pos = idx + 1
        }
      },
      tokenizer(src) {
        const match = src.match(inlineMathRegex)
        if (!match) return
        return {
          type: "inlineKatex",
          raw: match[0],
          text: (match[1] ?? match[2] ?? match[3] ?? match[4]).trim(),
          displayMode: match[1] !== undefined || match[2] !== undefined,
        }
      },
      renderer: renderKatexToken,
    },
  ],
}

function renderKatexToken(token: Tokens.Generic) {
  const rendered = katex.renderToString(typeof token.text === "string" ? token.text : "", {
    displayMode: token.displayMode === true,
    throwOnError: false,
  })
  return token.type === "blockKatex" ? `${rendered}\n` : rendered
}
