export type VisualAiSlopFinding = {
  readonly rule: string
  readonly severity: "warning" | "blocker"
  readonly evidence: string
  readonly fix: string
}

export type CssDeclaration = {
  readonly selector: string
  readonly properties: ReadonlyMap<string, string>
  readonly atRule?: string
}

export type CssRuleNode = {
  readonly type: "rule"
  readonly selector: string
  readonly properties: ReadonlyMap<string, string>
  readonly declarations: ReadonlyMap<string, string>
  readonly atRule?: string
}

export type CssAtRuleNode = {
  readonly type: "at-rule"
  readonly name: string
  readonly params: string
  readonly rules: readonly (CssRuleNode | CssAtRuleNode)[]
  readonly children: readonly (CssRuleNode | CssAtRuleNode)[]
}

export type CssAstNode = CssRuleNode | CssAtRuleNode

function stripComments(css: string): string {
  let result = ""
  let inString: string | null = null
  let i = 0
  while (i < css.length) {
    const char = css[i]
    if (inString) {
      result += char
      if (char === "\\" && i + 1 < css.length) {
        result += css[++i]
      } else if (char === inString) {
        inString = null
      }
      i++
      continue
    }
    if (char === '"' || char === "'") {
      inString = char
      result += char
      i++
      continue
    }
    if (char === "/" && css[i + 1] === "*") {
      i += 2
      while (i < css.length && !(css[i] === "*" && css[i + 1] === "/")) {
        i++
      }
      i += 2
      result += " "
      continue
    }
    result += char
    i++
  }
  return result
}

function splitDeclarations(body: string): string[] {
  const decls: string[] = []
  let current = ""
  let inString: string | null = null
  let parenDepth = 0
  for (let i = 0; i < body.length; i++) {
    const c = body[i]
    if (inString) {
      current += c
      if (c === "\\" && i + 1 < body.length) {
        current += body[++i]
      } else if (c === inString) {
        inString = null
      }
      continue
    }
    if (c === '"' || c === "'") {
      inString = c
      current += c
      continue
    }
    if (c === "(") {
      parenDepth++
      current += c
      continue
    }
    if (c === ")") {
      if (parenDepth > 0) parenDepth--
      current += c
      continue
    }
    if (c === ";" && parenDepth === 0) {
      if (current.trim()) decls.push(current.trim())
      current = ""
      continue
    }
    current += c
  }
  if (current.trim()) decls.push(current.trim())
  return decls
}

function parseDeclarationsBlock(body: string): ReadonlyMap<string, string> {
  const props = new Map<string, string>()
  for (const statement of splitDeclarations(body)) {
    const colon = statement.indexOf(":")
    if (colon === -1) continue
    const prop = statement.slice(0, colon).trim().toLowerCase()
    const val = statement.slice(colon + 1).trim()
    if (prop && val) props.set(prop, val)
  }
  return props
}

function parseNodes(css: string, currentAtRule?: string): CssAstNode[] {
  const nodes: CssAstNode[] = []
  let i = 0
  let inString: string | null = null
  let headerStart = 0

  while (i < css.length) {
    const c = css[i]
    if (inString) {
      if (c === "\\" && i + 1 < css.length) {
        i += 2
        continue
      }
      if (c === inString) {
        inString = null
      }
      i++
      continue
    }
    if (c === '"' || c === "'") {
      inString = c
      i++
      continue
    }
    if (c === "{") {
      const header = css.slice(headerStart, i).trim()
      let depth = 1
      let j = i + 1
      let blockInString: string | null = null
      while (j < css.length && depth > 0) {
        const bc = css[j]
        if (blockInString) {
          if (bc === "\\" && j + 1 < css.length) {
            j += 2
            continue
          }
          if (bc === blockInString) {
            blockInString = null
          }
          j++
          continue
        }
        if (bc === '"' || bc === "'") {
          blockInString = bc
          j++
          continue
        }
        if (bc === "{") {
          depth++
        } else if (bc === "}") {
          depth--
        }
        j++
      }
      const blockContent = css.slice(i + 1, j - 1).trim()
      i = j
      headerStart = i

      if (!header) continue

      if (header.startsWith("@")) {
        const spaceIdx = header.search(/\s/)
        const name = spaceIdx === -1 ? header : header.slice(0, spaceIdx).trim()
        const params = spaceIdx === -1 ? "" : header.slice(spaceIdx).trim()
        const childNodes = parseNodes(blockContent, header)
        const atRuleNode: CssAtRuleNode = {
          type: "at-rule",
          name,
          params,
          rules: childNodes,
          children: childNodes,
        }
        nodes.push(atRuleNode)
      } else {
        const hasNestedBlocks = blockContent.includes("{")
        if (!hasNestedBlocks) {
          const props = parseDeclarationsBlock(blockContent)
          nodes.push({
            type: "rule",
            selector: header,
            properties: props,
            declarations: props,
            ...(currentAtRule ? { atRule: currentAtRule } : {}),
          })
        } else {
          const childNodes = parseNodes(blockContent, currentAtRule)
          const declText = blockContent.replace(/\{[^{}]*\}/g, "")
          const props = parseDeclarationsBlock(declText)
          if (props.size > 0) {
            nodes.push({
              type: "rule",
              selector: header,
              properties: props,
              declarations: props,
              ...(currentAtRule ? { atRule: currentAtRule } : {}),
            })
          }
          nodes.push(...childNodes)
        }
      }
      continue
    }
    if (c === ";" && !inString) {
      headerStart = i + 1
    }
    i++
  }
  return nodes
}

function extractCssText(content: string): string {
  if (/<style\b[^>]*>/i.test(content)) {
    const parts: string[] = []
    const styleTagRegex = /<style\b[^>]*>([\s\S]*?)<\/style>/gi
    for (const match of content.matchAll(styleTagRegex)) {
      parts.push(match[1])
    }
    const inlineStyleRegex = /style\s*=\s*["']([^"']+)["']/gi
    for (const match of content.matchAll(inlineStyleRegex)) {
      parts.push(`[inline-style] { ${match[1]} }`)
    }
    return parts.join("\n")
  }
  if (/style\s*=\s*["']/i.test(content) && !/\{[\s\S]*\}/.test(content)) {
    const parts: string[] = []
    const inlineStyleRegex = /style\s*=\s*["']([^"']+)["']/gi
    for (const match of content.matchAll(inlineStyleRegex)) {
      parts.push(`[inline-style] { ${match[1]} }`)
    }
    return parts.join("\n")
  }
  return content
}

export function parseCssAst(content: string): readonly CssAstNode[] {
  const css = extractCssText(content)
  return parseNodes(stripComments(css))
}

export function collectDeclarations(nodes: readonly CssAstNode[], atRuleContext = ""): CssDeclaration[] {
  const result: CssDeclaration[] = []
  for (const node of nodes) {
    if (node.type === "rule") {
      result.push({
        selector: node.selector,
        properties: node.properties,
        ...(atRuleContext || node.atRule ? { atRule: atRuleContext || node.atRule } : {}),
      })
    } else if (node.type === "at-rule") {
      const currentAt = atRuleContext ? `${atRuleContext} -> ${node.name} ${node.params}`.trim() : `${node.name} ${node.params}`.trim()
      result.push(...collectDeclarations(node.rules, currentAt))
    }
  }
  return result
}

export function scanVisualAiSlop(content: string, filePath: string): readonly VisualAiSlopFinding[] {
  const findings: VisualAiSlopFinding[] = []
  const largeRadius = count(content, /\brounded-(?:xl|2xl|3xl|full)\b/g) + count(content, /border-radius\s*:\s*(?:1[6-9]|[2-9]\d)px/gi)
  const largeShadow = count(content, /\bshadow-(?:lg|xl|2xl)\b/g)
  const gradients = count(content, /(?:linear|radial|conic)-gradient\s*\(/gi) + count(content, /\bbg-gradient-to-/g)
  const backdropBlur = count(content, /backdrop-(?:filter:)?\s*blur|backdrop-filter\s*:\s*blur|\bbackdrop-blur-/gi)

  const ast = parseCssAst(content)
  const cssDeclarations = collectDeclarations(ast)
  let structuralGlassFound = false
  let structuralGradientTextFound = false
  let structuralTiltFound = false
  let structuralThreeCardGridFound = false
  let structuralHeadingUnderlineFound = false
  let structuralExtremeLetterSpacingFound = false

  for (const decl of cssDeclarations) {
    const bg = decl.properties.get("background") ?? decl.properties.get("background-color") ?? ""
    const blur = decl.properties.get("backdrop-filter") ?? decl.properties.get("-webkit-backdrop-filter") ?? ""
    if (blur.includes("blur") && /(?:rgba\(\s*(?:[0-2]?\d|30)\s*,\s*(?:[0-2]?\d|30)\s*,\s*(?:[0-2]?\d|30)|#0[0-9a-f]{5}|#1[0-9a-f]{5}|var\(--bg)/i.test(bg)) {
      structuralGlassFound = true
    }

    const clip = decl.properties.get("background-clip") ?? decl.properties.get("-webkit-background-clip") ?? ""
    const fill = decl.properties.get("-webkit-text-fill-color") ?? ""
    if (clip.includes("text") && (bg.includes("gradient") || fill === "transparent")) {
      structuralGradientTextFound = true
    }

    const transform = decl.properties.get("transform") ?? ""
    if (transform.includes("perspective") && /rotate[XY]/i.test(transform)) {
      structuralTiltFound = true
    }

    const gridCols = decl.properties.get("grid-template-columns") ?? ""
    if (/repeat\(\s*(?:3|auto-fit)\s*,\s*minmax\([^)]+\)\)/i.test(gridCols) || /repeat\(\s*3\s*,\s*[^)]+\)/i.test(gridCols)) {
      structuralThreeCardGridFound = true
    }

    if (/(?:h[1-6]|heading)\b[^\{]*::?after\b/i.test(decl.selector) || /(?:h[1-6]|heading)\s+em::?after\b/i.test(decl.selector)) {
      const contentProp = decl.properties.get("content") ?? ""
      const position = decl.properties.get("position") ?? ""
      if (contentProp && (position === "absolute" || decl.properties.has("border-bottom") || decl.properties.has("border-top") || decl.properties.has("background") || decl.properties.has("background-color"))) {
        structuralHeadingUnderlineFound = true
      }
    }

    const letterSpacing = decl.properties.get("letter-spacing") ?? ""
    if (/-\s*(?:[4-9]|\d{2,})px/i.test(letterSpacing) || /-\s*(?:0\.[2-9]|[1-9])(?:em|rem)/i.test(letterSpacing)) {
      structuralExtremeLetterSpacingFound = true
    }
  }

  if (structuralGlassFound || (backdropBlur > 0 && /(?:background|bg)\s*:\s*(?:rgba\(\s*(?:[0-2]?\d|30)\s*,\s*(?:[0-2]?\d|30)\s*,\s*(?:[0-2]?\d|30)|#0[0-9a-f]{5}|#1[0-9a-f]{5}|var\(--bg)/i.test(content))) {
    findings.push({
      rule: "V-dark-glassmorphism",
      severity: "blocker",
      evidence: `dark glassmorphism (backdrop-filter: blur with dark background) in ${filePath}`,
      fix: "replace dark glassmorphism card/surface with solid contrast-tuned background token without backdrop-filter blur",
    })
  } else if (backdropBlur >= 3) {
    findings.push({
      rule: "V-glass-density",
      severity: "warning",
      evidence: `${backdropBlur} backdrop-blur surfaces in ${filePath}`,
      fix: "review whether translucency is required for layering; avoid making every container glass",
    })
  }

  if (structuralGradientTextFound || (/(?:-webkit-)?background-clip\s*:\s*text\b/i.test(content) && /(?:linear|radial)-gradient/i.test(content))) {
    findings.push({
      rule: "V-gradient-heading-text",
      severity: "blocker",
      evidence: `gradient-clipped text headings in ${filePath}`,
      fix: "use solid, high-contrast typography instead of gradient text clipping",
    })
  }

  if (structuralTiltFound || /transform\s*:\s*perspective\([^)]+\)\s*rotate[XY]\([^)]+\)/i.test(content)) {
    findings.push({
      rule: "V-perspective-tilt",
      severity: "blocker",
      evidence: `3D perspective rotation / hover tilt on hero card in ${filePath}`,
      fix: "remove artificial perspective tilt; use authentic layout, generous whitespace, and subtle standard transitions",
    })
  }

  if (
    (structuralThreeCardGridFound || /grid-template-columns\s*:\s*repeat\(\s*(?:3|auto-fit)\s*,\s*minmax\([^)]+\)\)/i.test(content)) &&
    (count(content, /class="[^"]*\bcard\b[^"]*"/gi) === 3 || count(content, /<article\b[^>]*\bclass="[^"]*\bcard\b/gi) === 3)
  ) {
    findings.push({
      rule: "V-uniform-three-card-grid",
      severity: "blocker",
      evidence: `centered uniform 3-card grid layout cliché in ${filePath}`,
      fix: "design content-driven layout with clear visual hierarchy instead of uniform 3-card trope",
    })
  }

  if (/mask-composite\s*:\s*(?:exclude|xor)/i.test(content) || /-(?:webkit-)?mask[^{;]*gradient/i.test(content)) {
    findings.push({
      rule: "V-gradient-border-mask",
      severity: "blocker",
      evidence: `decorative gradient border via CSS mask in ${filePath}`,
      fix: "use purposeful single-token border rather than decorative gradient border mask",
    })
  }

  if (/feTurbulence|fractalNoise/i.test(content)) {
    findings.push({
      rule: "V-synthetic-svg-noise",
      severity: "blocker",
      evidence: `synthetic SVG fractal noise overlay in ${filePath}`,
      fix: "remove synthetic SVG noise filter; use authentic background materials and photography",
    })
  }

  if (/@keyframes\s+shimmer\b/i.test(content) || /animation:[^;]*shimmer\b/i.test(content)) {
    findings.push({
      rule: "V-text-shimmer",
      severity: "blocker",
      evidence: `animated text shimmer in ${filePath}`,
      fix: "remove animated shimmer effect from headings and surfaces",
    })
  }

  if (largeRadius >= 8) findings.push({
    rule: "V-large-radius-density",
    severity: "warning",
    evidence: `${largeRadius} large-radius surfaces in ${filePath}`,
    fix: "review whether shape is expressing hierarchy or being applied uniformly; preserve deliberate rounded product language",
  })
  if (largeShadow >= 8) findings.push({
    rule: "V-large-shadow-density",
    severity: "warning",
    evidence: `${largeShadow} large-shadow utilities in ${filePath}`,
    fix: "review elevation hierarchy; use strong elevation only where depth communicates interaction or layering",
  })
  if (gradients >= 5) findings.push({
    rule: "V-gradient-density",
    severity: "warning",
    evidence: `${gradients} gradient surfaces in ${filePath}`,
    fix: "review whether gradients serve the visual concept or are decorative repetition",
  })

  if (structuralHeadingUnderlineFound || /(?:h[1-6]|heading)\s+em::?after\s*\{[^}]*content\s*:\s*["'][^"']*["']/i.test(content)) {
    findings.push({
      rule: "V-heading-accent-underline",
      severity: "blocker",
      evidence: `decorative ::after pseudo-element underline on heading formula in ${filePath}`,
      fix: "use purposeful typographic weight, spacing, or structural layout rather than synthetic ::after underline accents",
    })
  }

  if (structuralExtremeLetterSpacingFound || /letter-spacing\s*:\s*-\s*(?:[4-9]|\d{2,})px/i.test(content)) {
    findings.push({
      rule: "V-extreme-negative-letter-spacing",
      severity: "blocker",
      evidence: `extreme negative letter-spacing (< -3px) in ${filePath}`,
      fix: "maintain optical readability with natural or proportional letter-spacing",
    })
  }
  return findings
}

function count(content: string, pattern: RegExp): number {
  return content.match(pattern)?.length ?? 0
}

export * as VisualAiSlop from "./visual-ai"
