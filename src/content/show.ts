import type { Dict, TagType } from '../dict'
import type { Settings } from '../settings'
import { h, type Child } from './render'
import { jaFor, sidebarTag, sidebarType, spaced, translateSidebar, untranslated } from './list'
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

/** Site stats labels in either locale (lowercased, colons stripped) mapped to ours. */
const STAT_LABELS: Record<string, string> = {
  source: '出典',
  ソース: '出典',
  id: 'ID',
  posted: '投稿日',
  投稿: '投稿日',
  size: 'サイズ',
  サイズ: 'サイズ',
  framerate: 'フレームレート',
  フレームレート: 'フレームレート',
  rating: 'レーティング',
  レーティング: 'レーティング',
  score: 'スコア',
  スコア: 'スコア',
  'favorited by': 'お気に入り',
  お気に入りにした人: 'お気に入り',
  status: '状態',
  状態: '状態',
  parent: '親',
  親: '親',
  children: '子',
  子: '子',
}

const RELATED_HEADINGS = new Set(['related posts', '関連する投稿'])
const PREV_TEXTS = new Set(['previous', 'prev', '前', '前の投稿'])
const NEXT_TEXTS = new Set(['next', '次', '次の投稿'])

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
    .map((n) => n.ja ?? spaced(n.t.tag))
    .join(' / ')
}

const norm = (t: string | null | undefined) => (t ?? '').trim().toLowerCase()

/** Sidebar lists whose direct items link to other posts; the one under a related-posts heading wins. */
function relatedList(doc: Document): Element | null {
  const lists = Array.from(doc.querySelectorAll('#post-view .sidebar ul')).filter(
    (ul) => ul.id !== 'tag-sidebar' && !ul.closest('#stats') && ul.querySelector(':scope > li > a[href^="/post/show/"]'),
  )
  const headed = lists.find((ul) => {
    const head = ul.previousElementSibling
    return head?.tagName === 'H5' && RELATED_HEADINGS.has(norm(head.textContent))
  })
  return headed ?? lists[0] ?? null
}

/** Previous/Next from the site's related-posts block (either locale); nothing is invented when it is absent. */
function prevNext(doc: Document): HTMLElement | null {
  const ul = relatedList(doc)
  if (!ul) return null
  const anchors = Array.from(ul.querySelectorAll(':scope > li > a[href^="/post/show/"]'))
  const links: HTMLElement[] = []
  for (const [texts, ja] of [
    [PREV_TEXTS, '前の投稿'],
    [NEXT_TEXTS, '次の投稿'],
  ] as const) {
    const a = anchors.find((x) => texts.has(norm(x.textContent)))
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

/** `Label:` / `ラベル::` / `ラベル：` at the start of a text; at least one colon required. */
const LABEL_RE = /^\s*([^:：]+?)\s*[:：]+\s*/
const statKey = (raw: string) => raw.replace(/\s+/g, ' ').trim().toLowerCase()
/** Own-property lookup so labels like "constructor" never hit Object.prototype. */
const statLabel = (key: string): string | null => (Object.hasOwn(STAT_LABELS, key) ? STAT_LABELS[key] : null)
const PROPOSE_MAX_TAGS = 20

/** Strips the site label (bare text, or a leading strong/b) from the li and returns ours. */
function takeLabel(li: Element): string | null {
  const first = Array.from(li.childNodes).find((n) => n.nodeType !== 3 || n.textContent?.trim())
  if (!first) return null
  if (first.nodeType === 3) {
    const m = LABEL_RE.exec(first.textContent ?? '')
    const ja = m && statLabel(statKey(m[1]))
    if (!m || !ja) return null
    first.textContent = (first.textContent ?? '').slice(m[0].length)
    return ja
  }
  const el = first as Element
  if ((el.tagName !== 'STRONG' && el.tagName !== 'B') || el.children.length) return null
  // <strong>Label</strong>: value  or  <strong>Label:</strong> value
  const ja = statLabel(statKey((el.textContent ?? '').replace(/[:：]+\s*$/, '')))
  if (!ja) return null
  const next = el.nextSibling
  el.remove()
  if (next && next.nodeType === 3) next.textContent = (next.textContent ?? '').replace(/^\s*[:：]*\s*/, '')
  return ja
}

function stats(doc: Document): void {
  const ul = doc.querySelector('#stats ul')
  if (!ul) return
  ul.classList.add('bsb-stats')
  for (const li of Array.from(ul.children)) {
    if (li.tagName !== 'LI') continue
    const ja = takeLabel(li)
    if (!ja) continue
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
    .slice(0, PROPOSE_MAX_TAGS)
  const sidebar = doc.getElementById('tag-sidebar')
  if (!missing.length || !sidebar) return
  // Issue forms ignore body=; fields are prefilled by their yml ids (tags, post).
  const href =
    PROPOSE_BASE +
    encodeURIComponent('翻訳提案: ' + missing.join(', ')) +
    '&labels=translation&tags=' +
    encodeURIComponent(missing.join('\n')) +
    '&post=' +
    encodeURIComponent(doc.location?.href ?? '')
  sidebar.after(h(doc, 'a', { class: 'bsb-propose', href, target: '_blank', rel: 'noopener' }, '訳を提案する'))
}

/** True on a show page (also when already rendered: idempotent no-op); false otherwise. */
export function renderShow(doc: Document, dict: Dict, settings: Settings): boolean {
  const view = doc.getElementById('post-view')
  const body = doc.body
  if (!view || !body) return false
  if (body.hasAttribute('data-bsb-show')) return true
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
  // translateSidebar groups the li nodes by type; headings then go before each group.
  translateSidebar(doc, dict, settings)
  sidebarHeads(doc, sideTags(doc))
  return true
}
