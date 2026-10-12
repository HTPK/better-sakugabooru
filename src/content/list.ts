import { lookup, type Dict, type TagType } from '../dict'
import type { Settings } from '../settings'
import { isBlacklisted, parsePosts, readBlacklist, type Post } from './pagedata'
import { h } from './render'
import { renderListBand, type BandActions } from './listband'
import listCss from './list.css?inline'

const UNTRANSLATED = '未訳'
const ARTIST_UNKNOWN = 'artist_unknown'
const ARTIST_UNKNOWN_JA = '作画者不明'
const SITE_DEFAULT_PER_PAGE = 40
const ARTIST_SEP = '　'
const PROPOSE_BASE = 'https://github.com/HTPK/better-sakugabooru/issues/new?template=translation.yml&title='
const PROPOSE_LIMIT = 20
/** Present on nearly every post; never worth a 技法 chip or a translation request. */
const NOISE = new Set(['animated'])
/** Placeholder tags that sort to the end of a side panel. */
const LAST = new Set(['artist_unknown'])
const COLS: Record<Settings['thumbSize'], string> = { small: '8', medium: '6', large: '4' }
const SIDEBAR_TYPES: readonly TagType[] = ['artist', 'copyright', 'general', 'character', 'meta', 'circle', 'faults']

export function injectListStyle(doc: Document): void {
  if (doc.getElementById('bsb-list')) return
  const el = doc.createElement('style')
  el.id = 'bsb-list'
  el.textContent = listCss
  ;(doc.head ?? doc.documentElement).appendChild(el)
}

export const spaced = (tag: string) => tag.replace(/_/g, ' ')

/** Japanese name or null. artist_unknown is stored as an override outside the artist map. */
export function jaFor(dict: Dict, tag: string, type: TagType, translate: boolean): string | null {
  if (!translate) return null
  const ja = lookup(dict, tag, type).ja
  if (ja) return ja
  if (tag === ARTIST_UNKNOWN) return lookup(dict, tag, 'general').ja ?? ARTIST_UNKNOWN_JA
  return null
}

function tagsOf(post: Post, types: Record<string, TagType>, type: TagType): string[] {
  return post.tags.filter((t) => types[t] === type)
}

function pickCopyright(post: Post, types: Record<string, TagType>): string | null {
  const cps = tagsOf(post, types, 'copyright')
  return cps.find((t) => !t.endsWith('_series')) ?? cps[0] ?? null
}

export function untranslated(doc: Document, tag: string): Node[] {
  return [h(doc, 'span', { class: 'bsb-raw' }, tag), h(doc, 'span', { class: 'bsb-untranslated' }, UNTRANSLATED)]
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function shortDate(epochSec: number): string {
  const d = new Date(epochSec * 1000)
  return `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}`
}

interface Ctx {
  doc: Document
  dict: Dict
  settings: Settings
  types: Record<string, TagType>
}

/** "作品 / 作画者" caption used for alt/title text. */
function captionText(ctx: Ctx, post: Post): string {
  const { dict, settings, types } = ctx
  const parts: string[] = []
  const cp = pickCopyright(post, types)
  if (cp) parts.push(jaFor(dict, cp, 'copyright', settings.translateTags) ?? cp)
  const artists = tagsOf(post, types, 'artist').map((t) => jaFor(dict, t, 'artist', settings.translateTags) ?? t)
  if (artists.length) parts.push(artists.join('、'))
  return parts.join(' / ')
}

function workRow(ctx: Ctx, post: Post): HTMLElement | null {
  const cp = pickCopyright(post, ctx.types)
  if (!cp) return null
  const ja = jaFor(ctx.dict, cp, 'copyright', ctx.settings.translateTags)
  const row = h(ctx.doc, 'div', { class: 'bsb-row bsb-work bsb-t-copyright', title: ja ?? cp })
  const link = h(ctx.doc, 'a', { class: 'bsb-t-copyright', href: `/post?tags=${encodeURIComponent(cp)}` })
  if (ja) link.textContent = ja
  else if (ctx.settings.translateTags) link.append(...untranslated(ctx.doc, cp))
  else link.textContent = cp
  row.append(link)
  return row
}

function artistRow(ctx: Ctx, post: Post): HTMLElement | null {
  const { doc, dict, settings } = ctx
  const tags = tagsOf(post, ctx.types, 'artist')
  if (!tags.length) return null
  const row = h(doc, 'div', { class: 'bsb-row bsb-artists' })
  // Mock: names only (raw tag as tooltip), separated by a full-width space.
  tags.forEach((tag, i) => {
    if (i > 0) row.append(ARTIST_SEP)
    const ja = jaFor(dict, tag, 'artist', settings.translateTags)
    const href = `/post?tags=${encodeURIComponent(tag)}`
    if (ja) row.append(h(doc, 'a', { href, class: 'bsb-t-artist', title: tag }, ja))
    else if (settings.translateTags) row.append(h(doc, 'a', { href, title: tag }, ...untranslated(doc, tag)))
    else row.append(h(doc, 'a', { href, class: 'bsb-t-artist' }, tag))
  })
  return row
}

function metaRow(ctx: Ctx, post: Post): HTMLElement {
  const { doc } = ctx
  return h(
    doc,
    'div',
    { class: 'bsb-row bsb-meta bsb-en' },
    h(doc, 'span', { class: 'bsb-score' }, `${post.score} pt`),
    h(doc, 'span', { class: 'bsb-date' }, shortDate(post.createdAt)),
  )
}

function techRow(ctx: Ctx, post: Post): HTMLElement | null {
  const { doc, dict, settings } = ctx
  const limit = settings.techLimit
  if (limit <= 0) return null
  const tags = tagsOf(post, ctx.types, 'general').filter((t) => t !== 'animated')
  if (!tags.length) return null
  const row = h(doc, 'div', { class: 'bsb-row bsb-tech' })
  for (const tag of tags.slice(0, limit)) {
    const href = `/post?tags=${encodeURIComponent(tag)}`
    row.append(h(doc, 'a', { class: 'bsb-chip bsb-t-general', href, title: tag }, jaFor(dict, tag, 'general', settings.translateTags) ?? tag))
  }
  const rest = tags.length - limit
  if (rest > 0) row.append(h(doc, 'span', { class: 'bsb-chip bsb-more' }, `+${rest}`))
  return row
}

function card(ctx: Ctx, post: Post): HTMLLIElement {
  const { doc, settings } = ctx
  const caption = captionText(ctx, post)
  const thumb = h(
    doc,
    'a',
    { class: 'bsb-thumb', href: `/post/show/${post.id}`, 'data-file-url': post.fileUrl || undefined },
    h(doc, 'img', { class: 'bsb-preview', src: post.previewUrl, alt: caption, loading: 'lazy' }),
  )
  const ar = post.width > 0 && post.height > 0 ? `${post.width}/${post.height}` : '16/9'
  thumb.style.setProperty('--bsb-ar', ar)
  const cap = h(
    doc,
    'div',
    { class: 'bsb-cap' },
    settings.showCopyright && workRow(ctx, post),
    settings.showArtist && artistRow(ctx, post),
    settings.showScoreDate && metaRow(ctx, post),
    settings.showTech && techRow(ctx, post),
  )
  return h(doc, 'li', { class: 'bsb-card', 'data-post-id': String(post.id), 'data-tags': post.tags.join(' ') }, thumb, cap)
}

export function sidebarType(li: Element): TagType | null {
  for (const c of Array.from(li.classList)) {
    if (!c.startsWith('tag-type-')) continue
    const t = c.slice('tag-type-'.length) as TagType
    return SIDEBAR_TYPES.includes(t) ? t : 'general'
  }
  return null
}

export function tagFromHref(href: string): string | null {
  const q = href.indexOf('?')
  if (q < 0) return null
  try {
    return new URLSearchParams(href.slice(q + 1)).get('tags')
  } catch {
    return null
  }
}

/** The tag link of a `#tag-sidebar li` (the one with `tags=`, not the wiki "?") and its tag. */
export function sidebarTag(li: Element): { link: HTMLAnchorElement; tag: string } | null {
  const link = Array.from(li.querySelectorAll('a')).find((a) => (a.getAttribute('href') ?? '').includes('tags='))
  const tag = link && tagFromHref(link.getAttribute('href') ?? '')
  return link && tag ? { link, tag } : null
}

/** Mock order: 作品 / 作画者 / 技法 (other types next) / メタ. */
const GROUP_ORDER: readonly TagType[] = ['copyright', 'artist', 'general', 'character', 'circle', 'faults', 'meta']

/** Reorders `#tag-sidebar` li nodes by type once (moved, never cloned, so handlers survive). */
function groupSidebar(doc: Document): void {
  const ul = doc.getElementById('tag-sidebar')
  if (!ul || ul.hasAttribute('data-bsb-grouped')) return
  ul.setAttribute('data-bsb-grouped', '')
  const typed = Array.from(ul.children)
    .map((li) => ({ li, type: li.tagName === 'LI' ? sidebarType(li) : null }))
    .filter((x): x is { li: Element; type: TagType } => x.type !== null)
  for (const type of GROUP_ORDER) {
    for (const x of typed) if (x.type === type) ul.appendChild(x.li)
  }
}

const SIDEBAR_HEADINGS: Record<string, string> = {
  Tags: 'タグ',
  'Hidden Posts': '非表示の投稿',
  Search: '検索',
  'Related Posts': '関連する投稿',
  Statistics: '情報',
  Options: '操作',
  History: '履歴',
}

/** Exact-match heading translation; mutates only the matching text node so inner spans/links survive. */
function translateHeadings(doc: Document): void {
  for (const hd of Array.from(doc.querySelectorAll('.sidebar h5, .sidebar h6'))) {
    const walker = doc.createTreeWalker(hd, 4)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const raw = n.textContent ?? ''
      const key = raw.trim()
      if (Object.hasOwn(SIDEBAR_HEADINGS, key)) n.textContent = raw.replace(key, SIDEBAR_HEADINGS[key])
    }
  }
}

/** Groups and translates `#tag-sidebar` tag links in place (shared by list and show pages). */
export function translateSidebar(doc: Document, dict: Dict, settings: Settings): void {
  translateHeadings(doc)
  groupSidebar(doc)
  if (!settings.translateTags) return
  for (const li of Array.from(doc.querySelectorAll('#tag-sidebar li'))) {
    if (li.hasAttribute('data-bsb-done')) continue
    const type = sidebarType(li)
    if (!type) continue
    const found = sidebarTag(li)
    if (!found) continue
    const { link, tag } = found
    const ja = jaFor(dict, tag, type, true)
    if (ja) {
      link.textContent = ja
      if (settings.showRomaji) link.after(h(doc, 'span', { class: 'bsb-romaji' }, spaced(tag)))
    } else {
      link.after(h(doc, 'span', { class: 'bsb-untranslated' }, UNTRANSLATED))
    }
    li.setAttribute('data-bsb-done', '')
  }
}

function rewritePaginator(doc: Document, perPage: number): void {
  if (perPage === SITE_DEFAULT_PER_PAGE) return
  const base = doc.baseURI && doc.baseURI !== 'about:blank' ? doc.baseURI : 'https://www.sakugabooru.com/'
  for (const a of Array.from(doc.querySelectorAll('#paginator a[href]'))) {
    const raw = a.getAttribute('href') ?? ''
    let u: URL
    try {
      u = new URL(raw, base)
    } catch {
      continue
    }
    u.searchParams.set('limit', String(perPage))
    const sameOrigin = u.origin === new URL(base).origin
    a.setAttribute('href', sameOrigin && !/^[a-z]+:/i.test(raw) ? u.pathname + u.search + u.hash : u.href)
  }
}

/**
 * A plain left click on a card is replayed on the original `#pNNN a.thumb`, so the site's
 * PostModeMenu (vote/favorite/edit modes) handles it; in view mode that link navigates as before.
 * Modified or non-primary clicks keep the browser default (new tab etc.).
 */
function forwardThumbClick(doc: Document, e: MouseEvent): void {
  if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.defaultPrevented) return
  const t = e.target as Element | null
  const thumb = t && typeof t.closest === 'function' ? t.closest('a.bsb-thumb') : null
  const id = thumb?.closest<HTMLElement>('.bsb-card')?.dataset.postId
  if (!id) return
  const orig = doc.getElementById(`p${id}`)?.querySelector<HTMLAnchorElement>('a.thumb')
  if (!orig) return
  e.preventDefault()
  orig.click()
}

/* ---- Our sidebar (list page): 作画者 / 作品 / 技法 panels built from the site's tag list ---- */

interface SideRow {
  tag: string
  count: number
  href: string
}
interface PanelSpec {
  type: 'artist' | 'copyright' | 'general'
  title: string
  max: number
  more: (n: number) => string
}
const FOLD_LABEL = '閉じる'
const HL = 'bsb-hl'

function tagOfTarget(target: EventTarget | null): string | null {
  // Duck-typed rather than `instanceof Element`: nodes may come from another window (tests, iframes).
  const el = target as Partial<Element> | null
  if (!el || typeof el.closest !== 'function') return null
  return el.closest<HTMLElement>('a[data-tag]')?.dataset.tag ?? null
}

/** Marks the grid cards carrying `tag` (null clears). Cards list their tags in `data-tags`. */
export function highlightCards(doc: Document, tag: string | null): void {
  for (const card of Array.from(doc.querySelectorAll<HTMLElement>('.bsb-card[data-tags]'))) {
    const on = tag !== null && (card.dataset.tags ?? '').split(' ').includes(tag)
    card.classList.toggle(HL, on)
  }
}

const PANELS: readonly PanelSpec[] = [
  { type: 'artist', title: '作画者', max: 12, more: (n) => `ほか ${n} 名` },
  { type: 'copyright', title: '作品', max: Infinity, more: (n) => `ほか ${n} 件` },
  { type: 'general', title: '技法', max: 20, more: (n) => `ほか ${n} 件` },
]

function siteRows(doc: Document, type: TagType): SideRow[] {
  const out: SideRow[] = []
  for (const li of Array.from(doc.querySelectorAll('#tag-sidebar li'))) {
    if (sidebarType(li) !== type) continue
    const found = sidebarTag(li)
    const count = Number((li.querySelector('.post-count')?.textContent ?? '').trim())
    if (!found || !Number.isFinite(count)) continue
    out.push({ tag: found.tag, count, href: found.link.getAttribute('href') ?? '' })
  }
  return out
}

/**
 * How many of the posts shown on this page carry each tag of `type`, most frequent first, ties in
 * order of first appearance. `artist_unknown` goes last: it is a placeholder, not a person.
 */
function pageRows(posts: Post[], types: Record<string, TagType>, type: TagType): SideRow[] {
  const counts = new Map<string, number>()
  for (const p of posts) {
    for (const t of p.tags) if (types[t] === type && !NOISE.has(t)) counts.set(t, (counts.get(t) ?? 0) + 1)
  }
  const rows = Array.from(counts, ([tag, count]) => ({ tag, count, href: `/post?tags=${encodeURIComponent(tag)}` }))
  const last = rows.filter((r) => LAST.has(r.tag))
  return rows
    .filter((r) => !LAST.has(r.tag))
    .sort((a, b) => b.count - a.count)
    .concat(last)
}

function sideItem(ctx: Ctx, type: PanelSpec['type'], row: SideRow, chip: boolean): HTMLAnchorElement {
  const { doc, dict, settings } = ctx
  const ja = jaFor(dict, row.tag, type, settings.translateTags)
  const raw = !ja && settings.translateTags
  const cls = [chip ? 'bsb-side-chip' : 'bsb-side-row', raw ? 'bsb-side-raw' : `bsb-t-${type}`].join(' ')
  return h(
    doc,
    'a',
    { class: cls, href: row.href, title: row.tag, 'data-tag': row.tag },
    h(
      doc,
      'span',
      { class: 'bsb-side-name' },
      raw ? h(doc, 'span', { class: 'bsb-side-text' }, row.tag) : (ja ?? row.tag),
      raw && h(doc, 'span', { class: 'bsb-untranslated' }, UNTRANSLATED),
    ),
    chip ? ' ' : null,
    h(doc, 'span', { class: 'bsb-side-count bsb-en' }, String(row.count)),
  )
}

function proposeHref(missing: string[]): string {
  return (
    PROPOSE_BASE +
    encodeURIComponent('翻訳提案: ' + missing.join(', ')) +
    '&labels=translation&tags=' +
    encodeURIComponent(missing.join('\n'))
  )
}

function buildSide(ctx: Ctx, posts: Post[]): HTMLElement {
  const { doc, dict, settings } = ctx
  const aside = h(doc, 'aside', { class: 'bsb-side', 'aria-label': 'タグ' })
  const missing = new Set<string>()
  const noteMissing = (tag: string, type: TagType) => {
    if (settings.translateTags && !NOISE.has(tag) && !jaFor(dict, tag, type, true)) missing.add(tag)
  }
  for (const spec of PANELS) {
    // The panels describe the posts on screen. The site's own list (its top-25 popular tags,
    // unrelated to this page) is only a fallback when the page JSON gave us nothing.
    const fromPage = pageRows(posts, ctx.types, spec.type)
    const rows = fromPage.length ? fromPage : siteRows(doc, spec.type)
    if (!rows.length) continue
    for (const r of rows) noteMissing(r.tag, spec.type)
    const chip = spec.type === 'general'
    const items = rows.map((r) => sideItem(ctx, spec.type, r, chip))
    const folded = items.slice(spec.max)
    for (const el of folded) el.hidden = true
    const list = h(doc, 'div', { class: chip ? 'bsb-side-chips' : 'bsb-side-rows' }, ...items)
    if (folded.length) {
      const more = h(doc, 'button', { type: 'button', class: 'bsb-side-more', 'aria-expanded': 'false' }, spec.more(folded.length))
      more.addEventListener('click', () => {
        const open = more.getAttribute('aria-expanded') !== 'true'
        for (const el of folded) el.hidden = !open
        more.setAttribute('aria-expanded', String(open))
        more.textContent = open ? FOLD_LABEL : spec.more(folded.length)
      })
      list.append(more)
    }
    aside.append(
      h(
        doc,
        'section',
        {
          class: `bsb-side-panel bsb-t-${spec.type}`,
          'data-type': spec.type,
          'data-source': fromPage.length ? 'page' : 'sidebar',
        },
        h(doc, 'div', { class: 'bsb-side-h' }, spec.title),
        list,
      ),
    )
  }
  // Hovering a name lights up the cards that carry that tag (the site did the same on its sidebar).
  aside.addEventListener('mouseover', (e) => highlightCards(doc, tagOfTarget(e.target)))
  aside.addEventListener('mouseout', () => highlightCards(doc, null))
  // Every caption on this page also counts: a card can show a tag the site's list left out.
  for (const p of posts) {
    for (const t of p.tags) {
      const type = ctx.types[t]
      if (type === 'artist' || type === 'copyright' || type === 'general') noteMissing(t, type)
    }
  }
  if (missing.size) {
    const asked = Array.from(missing).slice(0, PROPOSE_LIMIT)
    aside.append(
      h(
        doc,
        'p',
        { class: 'bsb-side-note' },
        `赤い「${UNTRANSLATED}」は辞書にまだ無い語です。`,
        h(doc, 'a', { class: 'bsb-propose', href: proposeHref(asked), target: '_blank', rel: 'noopener' }, '訳を提案する'),
      ),
    )
  }
  return aside
}

/**
 * Hides the site's sidebar (search box, Hidden Posts, tag list: kept in the DOM for site scripts)
 * and puts our panels in its place, left of the grid.
 */
function renderSide(ctx: Ctx, posts: Post[], list: Element): void {
  const { doc } = ctx
  if (doc.querySelector('aside.bsb-side')) return
  const tagList = doc.getElementById('tag-sidebar')
  tagList?.parentElement?.classList.add('bsb-hide')
  doc.getElementById('blacklisted-sidebar')?.classList.add('bsb-hide')
  const siteSide = (tagList ?? list).closest('#post-list')?.querySelector(':scope > .sidebar')
  siteSide?.classList.add('bsb-hide')
  const content = list.closest('.content') ?? list
  content.parentElement?.insertBefore(buildSide(ctx, posts), content)
}

const PAGER_LABELS: ReadonlyArray<[string, RegExp, string]> = [
  ['.previous_page', /previous|前へ/i, '前へ'],
  ['.next_page', /next|次へ/i, '次へ'],
]

/** "← Previous" / "← 前へ" → 前へ, "Next →" / "次へ →" → 次へ (text nodes only; links keep their hrefs). */
function translatePaginator(doc: Document): void {
  for (const [sel, re, label] of PAGER_LABELS) {
    for (const el of Array.from(doc.querySelectorAll(`#paginator ${sel}`))) {
      const walker = doc.createTreeWalker(el, 4)
      const nodes: Node[] = []
      for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n)
      for (const n of nodes) {
        const t = n.textContent ?? ''
        if (re.test(t)) n.textContent = label
        else if (/^[\s←→«»‹›]*$/.test(t)) n.textContent = ''
      }
    }
  }
}

export function renderList(
  doc: Document,
  dict: Dict,
  settings: Settings,
  actions: BandActions = {},
): { cards: number } {
  const list = doc.getElementById('post-list-posts')
  if (!list || list.hasAttribute('data-bsb-done')) return { cards: 0 }
  const { posts, tagTypes } = parsePosts(doc)

  doc.documentElement.classList.add('bsb-list')
  injectListStyle(doc)
  const ctx: Ctx = { doc, dict, settings, types: tagTypes }
  renderListBand(doc, dict, settings, actions, tagTypes)
  translatePaginator(doc)
  const blacklist = readBlacklist(doc)
  const visible = posts.filter(
    (p) => !isBlacklisted(p, blacklist) && !doc.getElementById(`p${p.id}`)?.classList.contains('blacklisted'),
  )
  renderSide(ctx, visible, list)
  if (!posts.length) return { cards: 0 }

  const grid = h(doc, 'ul', { class: 'bsb-grid', 'data-cols': COLS[settings.thumbSize] })
  for (const post of visible) grid.append(card(ctx, post))
  grid.addEventListener('click', (e) => forwardThumbClick(doc, e))

  list.classList.add('bsb-hide')
  list.setAttribute('data-bsb-done', '')
  list.after(grid)

  // Keep the hidden original sane if the site reveals it.
  const byId = new Map(posts.map((p) => [p.id, p]))
  for (const img of Array.from(list.querySelectorAll<HTMLImageElement>('img.preview'))) {
    const id = Number(img.closest('li')?.id.replace(/^p/, ''))
    const post = byId.get(id)
    if (!post) continue
    const text = captionText(ctx, post)
    img.title = text
    img.alt = text
  }

  translateSidebar(doc, dict, settings)
  rewritePaginator(doc, settings.perPage)
  return { cards: visible.length }
}
