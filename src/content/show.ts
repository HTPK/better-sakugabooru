import type { Dict, TagType } from '../dict'
import type { Settings } from '../settings'
import { h, type Child } from './render'
import { jaFor, sidebarTag, sidebarType, translateSidebar, untranslated } from './list'
import showCss from './show.css?inline'

const PROPOSE_BASE = 'https://github.com/HTPK/sakugabooru-ja-dict/issues/new?template=translation.yml&title='
const LEAD_LIMIT = 3
/** Present on nearly every post; never worth a lead slot or a translation request. */
const NOISE = new Set(['animated'])

const HEADINGS: Partial<Record<TagType, string>> = {
  copyright: '作品',
  artist: '作画者',
  general: '技法',
  meta: 'メタ',
}

const STAT_LABELS: Record<string, string> = {
  Source: '出典',
  Id: 'ID',
  Posted: '投稿日',
  Size: 'サイズ',
  Framerate: 'フレームレート',
  Rating: 'レーティング',
  Score: 'スコア',
  'Favorited by': 'お気に入り',
  Status: '状態',
  Parent: '親',
  Children: '子',
}

interface SideTag {
  tag: string
  type: TagType
  li: Element
}

function injectShowStyle(doc: Document): void {
  if (doc.getElementById('bsb-show')) return
  const el = doc.createElement('style')
  el.id = 'bsb-show'
  el.textContent = showCss
  ;(doc.head ?? doc.documentElement).appendChild(el)
}

function sideTags(doc: Document): SideTag[] {
  const out: SideTag[] = []
  for (const li of Array.from(doc.querySelectorAll('#tag-sidebar li'))) {
    const type = sidebarType(li)
    const found = type && sidebarTag(li)
    if (type && found) out.push({ tag: found.tag, type, li })
  }
  return out
}

/** Post id from page markup (never from location): score span, then comment/edit forms. */
function postId(doc: Document): string | null {
  const score = doc.querySelector('#stats [id^="post-score-"]')?.id.slice('post-score-'.length)
  if (score && /^\d+$/.test(score)) return score
  const v = doc.querySelector<HTMLInputElement>('input[name="comment[post_id]"]')?.value
  if (v && /^\d+$/.test(v)) return v
  const m = /\/post\/update\/(\d+)/.exec(doc.getElementById('edit-form')?.getAttribute('action') ?? '')
  return m ? m[1] : null
}

function namePart(doc: Document, dict: Dict, s: Settings, t: SideTag): Child[] {
  const ja = jaFor(dict, t.tag, t.type, s.translateTags)
  if (ja) return [ja]
  return s.translateTags ? untranslated(doc, t.tag) : [t.tag]
}

function title(doc: Document, dict: Dict, s: Settings, tags: SideTag[]): HTMLElement {
  const h1 = h(doc, 'h1')
  const cps = tags.filter((t) => t.type === 'copyright')
  const cp = cps.find((t) => !t.tag.endsWith('_series')) ?? cps[0]
  if (cp) h1.append(...(namePart(doc, dict, s, cp) as Array<Node | string>))
  const artists = tags.filter((t) => t.type === 'artist')
  if (cp && artists.length) h1.append('　')
  artists.forEach((t, i) => {
    if (i > 0) h1.append('、')
    h1.append(...(namePart(doc, dict, s, t) as Array<Node | string>))
  })
  return h1
}

/** Up to three general tags, translated ones first, site order otherwise. */
function lead(dict: Dict, s: Settings, tags: SideTag[]): string {
  const general = tags.filter((t) => t.type === 'general' && !NOISE.has(t.tag))
  const named = general.map((t) => ({ t, ja: jaFor(dict, t.tag, 'general', s.translateTags) }))
  const ordered = [...named.filter((n) => n.ja), ...named.filter((n) => !n.ja)]
  return ordered
    .slice(0, LEAD_LIMIT)
    .map((n) => n.ja ?? n.t.tag)
    .join(' / ')
}

/** Previous/Next from the site's "Related Posts" block; nothing is invented when it is absent. */
function prevNext(doc: Document): HTMLElement | null {
  const head = Array.from(doc.querySelectorAll('#post-view h5')).find((e) => e.textContent?.trim() === 'Related Posts')
  const ul = head?.nextElementSibling
  if (!ul) return null
  const links: HTMLElement[] = []
  for (const [en, ja] of [
    ['Previous', '前の投稿'],
    ['Next', '次の投稿'],
  ]) {
    const a = Array.from(ul.querySelectorAll('a[href]')).find((x) => x.textContent?.trim() === en)
    if (a) links.push(h(doc, 'a', { class: 'bsb-show-step', href: a.getAttribute('href') ?? undefined }, ja))
  }
  return links.length ? h(doc, 'nav', { class: 'bsb-show-nav', 'aria-label': '前後の投稿' }, ...links) : null
}

function band(doc: Document, dict: Dict, s: Settings, tags: SideTag[], id: string | null): HTMLElement {
  const leadText = lead(dict, s, tags)
  return h(
    doc,
    'section',
    { class: 'bsb-band bsb-show-band' },
    h(doc, 'div', { class: 'bsb-show-titles' }, title(doc, dict, s, tags), leadText && h(doc, 'p', { class: 'bsb-lead' }, leadText)),
    id && h(doc, 'span', { class: 'bsb-en-title' }, `#${id}`),
    prevNext(doc),
  )
}

function layout(doc: Document, view: Element): void {
  const right = doc.getElementById('right-col')
  if (!right) return
  view.classList.add('bsb-show-grid')
  const main = h(doc, 'main', { class: 'bsb-show-main' })
  const side = view.querySelector(':scope > .sidebar')
  // Main goes before the sidebar so grid auto-placement keeps both on one row.
  if (side && side.parentElement === right.parentElement) side.before(main)
  else right.before(main)
  main.append(right)
  const video = right.querySelector('video')
  const w = Number(video?.getAttribute('width'))
  const ht = Number(video?.getAttribute('height'))
  if (w > 0 && ht > 0) main.style.setProperty('--bsb-ar', `${w}/${ht}`)
}

function sidebarHeads(doc: Document, tags: SideTag[]): void {
  const seen = new Set<TagType>()
  for (const t of tags) {
    if (seen.has(t.type)) continue
    seen.add(t.type)
    const label = HEADINGS[t.type]
    if (label) t.li.before(h(doc, 'li', { class: 'bsb-sb-head' }, label))
  }
}

function stats(doc: Document): void {
  const ul = doc.querySelector('#stats ul')
  if (!ul) return
  ul.classList.add('bsb-stats')
  for (const li of Array.from(ul.children)) {
    if (li.tagName !== 'LI') continue
    const first = Array.from(li.childNodes).find((n) => n.nodeType === 3 && n.textContent?.trim())
    const m = first && /^\s*([A-Za-z][A-Za-z ]*):\s*/.exec(first.textContent ?? '')
    const ja = m && STAT_LABELS[m[1]]
    if (!first || !m || !ja) continue
    first.textContent = (first.textContent ?? '').slice(m[0].length)
    // Reparent (never clone) the value nodes so ids and vote handlers survive.
    const value = h(doc, 'span', { class: 'bsb-stats-value' })
    value.append(...Array.from(li.childNodes))
    li.append(h(doc, 'span', { class: 'bsb-stats-label' }, ja), value)
  }
}

function propose(doc: Document, dict: Dict, s: Settings, tags: SideTag[]): void {
  if (!s.translateTags) return
  const missing = tags
    .filter((t) => !NOISE.has(t.tag) && !jaFor(dict, t.tag, t.type, true))
    .map((t) => t.tag)
    .filter((t, i, a) => a.indexOf(t) === i)
  const sidebar = doc.getElementById('tag-sidebar')
  if (!missing.length || !sidebar) return
  const href =
    PROPOSE_BASE +
    encodeURIComponent('翻訳提案: ' + missing.join(', ')) +
    '&labels=translation&body=' +
    encodeURIComponent(missing.join('\n'))
  sidebar.after(h(doc, 'a', { class: 'bsb-propose', href, target: '_blank', rel: 'noopener' }, '訳を提案する'))
}

export function renderShow(doc: Document, dict: Dict, settings: Settings): boolean {
  const view = doc.getElementById('post-view')
  const body = doc.body
  if (!view || !body || body.hasAttribute('data-bsb-show')) return false
  body.setAttribute('data-bsb-show', '')
  injectShowStyle(doc)

  const tags = sideTags(doc)
  const content = doc.getElementById('content')
  const b = band(doc, dict, settings, tags, postId(doc))
  if (content && view.parentElement === content) content.prepend(b)
  else view.before(b)

  layout(doc, view)
  stats(doc)
  propose(doc, dict, settings, tags)
  sidebarHeads(doc, tags)
  translateSidebar(doc, dict, settings)
  return true
}
