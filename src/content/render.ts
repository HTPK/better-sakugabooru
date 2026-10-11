export type Child = Node | string | null | undefined | false

/**
 * Minimal element builder. Strings become text nodes (never parsed as HTML),
 * so page data can be passed as children safely.
 */
export function h<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  attrs?: Record<string, string | undefined> | null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = doc.createElement(tag)
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined) continue
      if (k === 'class') el.className = v
      else el.setAttribute(k, v)
    }
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue
    el.append(typeof c === 'string' ? doc.createTextNode(c) : c)
  }
  return el
}
