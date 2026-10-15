import { h } from './render'

export const UNTRANSLATED = '未訳'
const PROPOSE_BASE = 'https://github.com/HTPK/better-sakugabooru/issues/new?template=translation.yml&title='
const MARK = '.bsb-untranslated[data-tag]'

/** GitHub "訳を提案する" issue form, prefilled by its yml ids (tags, post). Issue forms ignore body=. */
export function proposeUrl(tags: string[], postUrl?: string): string {
  return (
    PROPOSE_BASE +
    encodeURIComponent('翻訳提案: ' + tags.join(', ')) +
    '&labels=translation&tags=' +
    encodeURIComponent(tags.join('\n')) +
    (postUrl ? '&post=' + encodeURIComponent(postUrl) : '')
  )
}

/** The red 未訳 mark. It usually sits inside a tag link, so it is a span; clicks are handled by attachProposeClick. */
export function untranslatedMark(doc: Document, tag: string): HTMLElement {
  return h(doc, 'span', { class: 'bsb-untranslated', 'data-tag': tag, title: `「${tag}」の訳を GitHub で提案する` }, UNTRANSLATED)
}

/** Post page URL to prefill the form's "post" field, or undefined elsewhere. */
function postUrlOf(doc: Document): string | undefined {
  const href = doc.location?.href
  if (!href) return undefined
  try {
    const u = new URL(href)
    return u.pathname.startsWith('/post/show/') ? u.origin + u.pathname : undefined
  } catch {
    return undefined
  }
}

/**
 * Clicking a 未訳 mark opens the proposal form for that one tag in a new tab instead of following
 * the tag link around it. Capture phase, so the site's and our own card handlers never see it.
 */
export function attachProposeClick(doc: Document, open: (url: string) => void): void {
  doc.addEventListener(
    'click',
    (e) => {
      if (e.button !== 0) return
      const t = e.target as Element | null
      const mark = t && typeof t.closest === 'function' ? t.closest<HTMLElement>(MARK) : null
      const tag = mark?.dataset.tag
      if (!tag) return
      e.preventDefault()
      e.stopPropagation()
      open(proposeUrl([tag], postUrlOf(doc)))
    },
    true,
  )
}
