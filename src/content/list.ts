import { lookup, type Dict, type TagType } from '../dict'
import type { Settings } from '../settings'
import { isBlacklisted, parsePosts, readBlacklist, type Post } from './pagedata'
import { h } from './render'
import listCss from './list.css?inline'

const UNTRANSLATED = '未訳'
const ARTIST_UNKNOWN = 'artist_unknown'
const ARTIST_UNKNOWN_JA = '作画者不明'
const SITE_DEFAULT_PER_PAGE = 40
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
  const row = h(ctx.doc, 'div', { class: 'bsb-row bsb-work', title: ja ?? cp })
  if (ja) row.textContent = ja
  else if (ctx.settings.translateTags) row.append(...untranslated(ctx.doc, cp))
  else row.textContent = cp
  return row
}

function artistRow(ctx: Ctx, post: Post): HTMLElement | null {
  const { doc, dict, settings } = ctx
  const tags = tagsOf(post, ctx.types, 'artist')
  if (!tags.length) return null
  const row = h(doc, 'div', { class: 'bsb-row bsb-artists' })
  tags.forEach((tag, i) => {
    if (i > 0) row.append(' ')
    const ja = jaFor(dict, tag, 'artist', settings.translateTags)
    const href = `/post?tags=${encodeURIComponent(tag)}`
    if (ja) {
      row.append(h(doc, 'a', { href }, ja))
      if (settings.showRomaji) row.append(h(doc, 'span', { class: 'bsb-romaji' }, spaced(tag)))
    } else if (settings.translateTags) {
      row.append(h(doc, 'a', { href }, ...untranslated(doc, tag)))
    } else {
      row.append(h(doc, 'a', { href }, tag))
    }
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
    row.append(h(doc, 'span', { class: 'bsb-chip', title: tag }, jaFor(dict, tag, 'general', settings.translateTags) ?? tag))
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
  return h(doc, 'li', { class: 'bsb-card', 'data-post-id': String(post.id) }, thumb, cap)
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

export function renderList(doc: Document, dict: Dict, settings: Settings): { cards: number } {
  const list = doc.getElementById('post-list-posts')
  if (!list || list.hasAttribute('data-bsb-done')) return { cards: 0 }
  const { posts, tagTypes } = parsePosts(doc)
  if (!posts.length) return { cards: 0 }

  injectListStyle(doc)
  const ctx: Ctx = { doc, dict, settings, types: tagTypes }
  const blacklist = readBlacklist(doc)
  const visible = posts.filter(
    (p) => !isBlacklisted(p, blacklist) && !doc.getElementById(`p${p.id}`)?.classList.contains('blacklisted'),
  )
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
