import type { Dict, TagType } from '../dict'
import type { Settings } from '../settings'
import { STRINGS, type Lang } from '../i18n'
import { parsePosts, type Post } from './pagedata'
import { h } from './render'
import { renderPostGrid, translatePaginator } from './list'
import { injectBandStyle } from './listband'
import poolCss from './pool.css?inline'

const STYLE_ID = 'bsb-pool'
/** "Pool: name" / "プール: name" (the site's heading in either locale). */
const TITLE_PREFIX = /^\s*(?:pool|プール)\s*[:：]\s*/i
/** The thumbnail caption the site writes: "Rating: Safe Score: 1077 Tags: a b c User: name". */
const THUMB_TITLE = /Rating:\s*(\S+)\s+Score:\s*(-?\d+)\s+Tags:\s*(.*?)\s*User:\s*(\S*)\s*$/s
const POOL_PATH = /^\/pool\/show\/(\d+)\b/
const BLOCK = new Set(['DIV', 'P', 'BR', 'LI', 'UL', 'OL', 'TR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE'])

function injectStyle(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return
  const el = doc.createElement('style')
  el.id = STYLE_ID
  el.textContent = poolCss
  ;(doc.head ?? doc.documentElement).appendChild(el)
}

export interface ThumbMeta {
  rating: string
  score: number
  tags: string[]
  author: string
}

export function parseThumbTitle(text: string): ThumbMeta | null {
  const m = THUMB_TITLE.exec(text)
  if (!m) return null
  return {
    rating: m[1].charAt(0).toLowerCase(),
    score: Number(m[2]),
    tags: m[3].split(/\s+/).filter(Boolean),
    author: m[4],
  }
}

/**
 * Fallback for a pool page served without `Post.register_resp`: the thumbnails' caption text
 * ("Rating: … Score: … Tags: … User: …") still carries tags and score. Width/height are the
 * thumbnail's, which keeps the aspect ratio; there is no file url, so no hover play.
 */
export function parsePoolThumbs(list: Element): Post[] {
  const posts: Post[] = []
  for (const li of Array.from(list.querySelectorAll<HTMLElement>('li[id^="p"]'))) {
    const id = Number(li.id.slice(1))
    const img = li.querySelector<HTMLImageElement>('img.preview')
    if (!Number.isInteger(id) || id <= 0 || !img) continue
    const meta = parseThumbTitle(img.getAttribute('title') ?? img.getAttribute('alt') ?? '')
    posts.push({
      id,
      tags: meta?.tags ?? [],
      score: meta?.score ?? 0,
      createdAt: 0,
      author: meta?.author ?? '',
      source: '',
      previewUrl: img.getAttribute('src') ?? '',
      fileUrl: '',
      width: Number(img.getAttribute('width')) || 0,
      height: Number(img.getAttribute('height')) || 0,
      fileSize: 0,
      rating: meta?.rating ?? '',
      parentId: null,
      hasChildren: false,
    })
  }
  return posts
}

/** Tag types from the dictionary's maps (the fallback when the page states none). */
export function dictTagTypes(dict: Dict, posts: Post[]): Record<string, TagType> {
  const types: Record<string, TagType> = Object.create(null)
  const maps: ReadonlyArray<[Record<string, unknown>, TagType]> = [
    [dict.artists, 'artist'],
    [dict.copyrights, 'copyright'],
    [dict.general, 'general'],
  ]
  for (const post of posts) {
    for (const tag of post.tags) {
      if (tag in types) continue
      const hit = maps.find(([m]) => Object.hasOwn(m, tag))
      if (hit) types[tag] = hit[1]
    }
  }
  return types
}

/** Pool id from the page URL, else from the site's "Index View" link (`/post?tags=pool:N`). */
export function poolIdOf(doc: Document): string | null {
  const m = POOL_PATH.exec(doc.location?.pathname ?? '')
  if (m) return m[1]
  for (const a of Array.from(doc.querySelectorAll<HTMLAnchorElement>('a[href*="tags=pool"]'))) {
    const q = (a.getAttribute('href') ?? '').split('?')[1] ?? ''
    const t = /^pool:(\d+)$/.exec(new URLSearchParams(q).get('tags') ?? '')
    if (t) return t[1]
  }
  return null
}

/** Visible text of the description with line breaks kept (`<br>` and block elements → newline). */
export function blockText(el: Element): string {
  const parts: string[] = []
  const walk = (n: Node) => {
    if (n.nodeType === 3) {
      parts.push(n.textContent ?? '')
      return
    }
    if (n.nodeType !== 1) return
    const e = n as Element
    const block = BLOCK.has(e.tagName)
    if (block) parts.push('\n')
    for (const c of Array.from(e.childNodes)) walk(c)
    if (block) parts.push('\n')
  }
  for (const c of Array.from(el.childNodes)) walk(c)
  return parts
    .join('')
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
}

function host(doc: Document, root: HTMLElement): HTMLElement {
  return doc.getElementById('content') ?? root.parentElement ?? root
}

/** /pool/show/N: pool name and description as the title band, then the same cards and sidebar as /post. */
export function renderPoolShow(doc: Document, dict: Dict, settings: Settings, lang: Lang = 'ja'): boolean {
  const root = doc.getElementById('pool-show')
  const list = doc.getElementById('post-list-posts')
  if (!root || !list || root.hasAttribute('data-bsb-done')) return false
  root.setAttribute('data-bsb-done', '')
  injectStyle(doc)
  injectBandStyle(doc)
  doc.documentElement.classList.add('bsb-pool')
  const s = STRINGS[lang]

  const heading = root.querySelector<HTMLElement>(':scope > h4')
  const name = (heading?.textContent ?? '').replace(TITLE_PREFIX, '').trim()
  // The description is the block between the heading and the list's wrapper (absent when empty).
  const descEl = Array.from(root.querySelectorAll<HTMLElement>(':scope > div')).find((d) => !d.contains(list)) ?? null
  const desc = descEl ? blockText(descEl) : ''
  // The page's inline JSON (`Post.register_resp`) has posts, file urls and the site's tag types;
  // the thumbnail captions are the fallback for a page served without it.
  let { posts, tagTypes } = parsePosts(doc)
  if (!posts.length) {
    posts = parsePoolThumbs(list)
    tagTypes = dictTagTypes(dict, posts)
  }
  const id = poolIdOf(doc)
  // With a pager the page holds only part of the pool, so no total is claimed.
  const paged = !!doc.querySelector('#paginator a[href]')

  const band = h(
    doc,
    'div',
    { class: 'bsb-band bsb-listband bsb-poolband' },
    h(
      doc,
      'div',
      { class: 'bsb-listband-title' },
      s.poolDeco ? h(doc, 'span', { class: 'bsb-en-title', lang: 'en' }, s.poolDeco) : null,
      h(doc, 'h1', null, name || s.pool),
      h(
        doc,
        'span',
        { class: 'bsb-pool-facts' },
        paged ? null : h(doc, 'span', { class: 'bsb-pool-count' }, s.poolCount(posts.length)),
        id ? h(doc, 'a', { class: 'bsb-pool-index', href: `/post?tags=${encodeURIComponent(`pool:${id}`)}` }, s.poolIndexView) : null,
        h(doc, 'a', { class: 'bsb-pool-all', href: '/pool' }, s.poolAll),
      ),
      desc ? h(doc, 'p', { class: 'bsb-lead' }, desc) : null,
    ),
  )
  host(doc, root).prepend(band)
  heading?.classList.add('bsb-hide')
  descEl?.classList.add('bsb-hide')

  // Layout as on /post: `aside | cards`. The list's wrapper becomes the cards column.
  const column = list.parentElement && list.parentElement !== root ? list.parentElement : list
  column.classList.add('bsb-pool-content')
  const body = h(doc, 'div', { class: 'bsb-pool-body' })
  column.before(body)
  body.append(column)
  renderPostGrid(doc, dict, settings, lang, posts, tagTypes, list, { sideBefore: column })
  return true
}

/** /pool: title band with the site's own search form moved into it; the table keeps the site's markup. */
export function renderPoolIndex(doc: Document, lang: Lang = 'ja'): boolean {
  const root = doc.getElementById('pool-index')
  if (!root || root.hasAttribute('data-bsb-done')) return false
  root.setAttribute('data-bsb-done', '')
  injectStyle(doc)
  injectBandStyle(doc)
  doc.documentElement.classList.add('bsb-pool', 'bsb-list')
  const s = STRINGS[lang]

  const form = root.querySelector<HTMLFormElement>('form[action="/pool"]')
  const formHome = form?.parentElement ?? null
  if (form) {
    form.classList.add('bsb-qform', 'bsb-poolsearch')
    const input = form.querySelector<HTMLInputElement>('input[name="query"]')
    if (input) {
      input.classList.add('bsb-qinput')
      input.placeholder = s.poolSearchPlaceholder
      input.setAttribute('aria-label', s.poolSearchPlaceholder)
    }
    const submit = form.querySelector<HTMLInputElement>('input[type="submit"]')
    if (submit) {
      submit.classList.add('bsb-qsubmit', 'bsb-pill')
      submit.value = s.search
      submit.setAttribute('data-disable-with', s.search)
    }
  }
  const band = h(
    doc,
    'div',
    { class: 'bsb-band bsb-listband bsb-poolband bsb-poolindex' },
    h(
      doc,
      'div',
      { class: 'bsb-listband-title' },
      s.poolsDeco ? h(doc, 'span', { class: 'bsb-en-title', lang: 'en' }, s.poolsDeco) : null,
      h(doc, 'h1', null, s.pools),
      form,
    ),
  )
  host(doc, root).prepend(band)
  // The form's old wrapper is an empty spacer now.
  if (formHome && formHome !== root && formHome.childElementCount === 0) formHome.classList.add('bsb-hide')
  root.querySelector('table')?.classList.add('bsb-pool-table')
  translatePaginator(doc, lang)
  return true
}

/** Pool pages (`/pool`, `/pool/show/N`). True when the page was one and got rendered. */
export function renderPool(doc: Document, dict: Dict, settings: Settings, lang: Lang = 'ja'): boolean {
  if (doc.getElementById('pool-show')) return renderPoolShow(doc, dict, settings, lang)
  if (doc.getElementById('pool-index')) return renderPoolIndex(doc, lang)
  return false
}
