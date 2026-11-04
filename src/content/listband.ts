import type { Dict, TagType } from '../dict'
import type { Settings } from '../settings'
import { STRINGS, type Lang } from '../i18n'
import { jaFor, spaced } from './list'
import { h } from './render'
import { wikiUrl } from './wiki'
import bandCss from './listband.css?inline'

const STYLE_ID = 'bsb-listband'
const SITE_DEFAULT_PER_PAGE = 40
const PER_PAGE: readonly Settings['perPage'][] = [24, 40, 60, 100]
type Order = 'new' | 'score' | 'random'
const ORDERS: ReadonlyArray<{ order: Order; label: 'sortNew' | 'sortScore' | 'sortRandom'; lead: 'sortLeadNew' | 'sortLeadScore' | 'sortLeadRandom' }> = [
  { order: 'new', label: 'sortNew', lead: 'sortLeadNew' },
  { order: 'score', label: 'sortScore', lead: 'sortLeadScore' },
  { order: 'random', label: 'sortRandom', lead: 'sortLeadRandom' },
]
const LOOKUP_ORDER: readonly TagType[] = ['copyright', 'artist', 'general']

export interface BandActions {
  saveSettings?: (patch: Partial<Settings>) => Promise<void>
  navigate?: (url: string) => void
}

/** Band styles (listband.css); pool pages share them. */
export function injectBandStyle(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return
  const el = doc.createElement('style')
  el.id = STYLE_ID
  el.textContent = bandCss
  ;(doc.head ?? doc.documentElement).appendChild(el)
}

function pageUrl(doc: Document): URL {
  const href = doc.location?.href
  return new URL(href && href !== 'about:blank' ? href : 'https://www.sakugabooru.com/post')
}

export function queryTokens(u: URL): string[] {
  return (u.searchParams.get('tags') ?? '').split(/\s+/).filter(Boolean)
}

const isOrder = (t: string) => /^order:/i.test(t)

function currentOrder(tokens: string[]): Order | null {
  const o = tokens.filter(isOrder).pop()?.toLowerCase()
  if (!o || o === 'order:id_desc') return 'new'
  if (o === 'order:score') return 'score'
  if (o === 'order:random') return 'random'
  return null
}

const relative = (u: URL) => u.pathname + u.search + u.hash

/** Current URL with its `order:` tokens replaced (新着 = none) and paging reset. */
export function sortUrl(href: string, order: Order): string {
  const u = new URL(href)
  const tokens = queryTokens(u).filter((t) => !isOrder(t))
  if (order !== 'new') tokens.push(`order:${order}`)
  if (tokens.length) u.searchParams.set('tags', tokens.join(' '))
  else u.searchParams.delete('tags')
  u.searchParams.delete('page')
  return relative(u)
}

/** Current URL with `limit=n` and paging reset. */
export function limitUrl(href: string, n: number): string {
  const u = new URL(href)
  u.searchParams.set('limit', String(n))
  u.searchParams.delete('page')
  return relative(u)
}

/** What the site actually served: the URL's limit, else its default. */
function servedPerPage(u: URL): number {
  const n = Number(u.searchParams.get('limit'))
  return Number.isInteger(n) && n > 0 ? n : SITE_DEFAULT_PER_PAGE
}

const POOL_TOKEN = /^pool:(.+)$/i

/** A query token as the band shows it: the label, the dictionary name behind it (if any) and its type. */
export interface QueryName {
  tag: string
  label: string
  ja: string | null
  type: TagType | null
}

export function queryName(dict: Dict, tag: string, types: Record<string, TagType>, translate: boolean, lang: Lang): QueryName {
  const pool = POOL_TOKEN.exec(tag)
  if (pool) {
    const v = pool[1]
    return { tag, label: /^\d+$/.test(v) ? STRINGS[lang].poolRef(v) : STRINGS[lang].poolNamed(spaced(v)), ja: null, type: null }
  }
  const known = Object.hasOwn(types, tag) ? types[tag] : null
  if (lang !== 'en') {
    for (const type of known ? [known] : LOOKUP_ORDER) {
      const ja = jaFor(dict, tag, type, translate)
      if (ja) return { tag, label: ja, ja, type }
    }
  }
  return { tag, label: spaced(tag), ja: null, type: known }
}

function chip(doc: Document, name: QueryName, romaji: boolean, lang: Lang): HTMLElement {
  const s = STRINGS[lang]
  const x = h(doc, 'button', { type: 'button', class: 'bsb-qchip-x', 'aria-label': s.removeChip(name.label) }, '×')
  // Filtering by an animator: a direct door to their 作画@wiki page, as on the post page's tag panel.
  const wiki =
    name.type === 'artist' && name.ja
      ? h(
          doc,
          'a',
          { class: 'bsb-wiki bsb-qchip-wiki', href: wikiUrl(name.ja), target: '_blank', rel: 'noopener noreferrer', title: s.wikiTitle(name.ja) },
          s.wiki,
        )
      : null
  return h(
    doc,
    'span',
    { class: 'bsb-qchip', 'data-tag': name.tag },
    h(doc, 'span', { class: 'bsb-qchip-ja' }, name.label),
    name.ja && romaji ? h(doc, 'span', { class: 'bsb-qchip-en', lang: 'en' }, name.tag) : null,
    wiki,
    x,
  )
}

function searchForm(doc: Document, chips: HTMLElement[], keep: string[], lang: Lang): HTMLFormElement {
  const s = STRINGS[lang]
  const input = h(doc, 'input', {
    type: 'text',
    id: 'bsb-q',
    name: 'tags',
    class: 'bsb-qinput',
    autocomplete: 'off',
    placeholder: s.searchPlaceholder,
  })
  const hidden = h(doc, 'input', { type: 'hidden', class: 'bsb-qhidden' })
  const box = h(doc, 'div', { class: 'bsb-qbox' }, ...chips, input)
  const form = h(
    doc,
    'form',
    { class: 'bsb-qform', method: 'get', action: '/post', role: 'search' },
    h(doc, 'label', { class: 'bsb-sr', for: 'bsb-q' }, s.search),
    box,
    hidden,
    h(doc, 'button', { type: 'submit', class: 'bsb-qsubmit bsb-pill' }, s.search),
  )
  box.addEventListener('click', (e) => {
    const x = (e.target as Element | null)?.closest('.bsb-qchip-x')
    if (x) {
      x.closest('.bsb-qchip')?.remove()
      input.focus()
    } else if (e.target === box) input.focus()
  })
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Backspace' || input.value !== '' || e.isComposing) return
    const last = box.querySelectorAll('.bsb-qchip')
    last[last.length - 1]?.remove()
  })
  // The site expects one space-separated `tags` value: chips, kept metatags, then whatever was typed.
  form.addEventListener('submit', () => {
    const tags = Array.from(box.querySelectorAll<HTMLElement>('.bsb-qchip'))
      .map((c) => c.dataset.tag ?? '')
      .concat(keep, input.value.split(/\s+/))
      .filter(Boolean)
    hidden.value = tags.join(' ')
    hidden.setAttribute('name', 'tags')
    input.removeAttribute('name')
    setTimeout(() => {
      input.setAttribute('name', 'tags')
      hidden.removeAttribute('name')
    }, 0)
  })
  return form
}

function segment(doc: Document, cls: string, label: string, items: HTMLElement[]): HTMLElement[] {
  return [h(doc, 'span', { class: 'bsb-opt-label' }, label), h(doc, 'span', { class: `bsb-seg ${cls}` }, ...items)]
}

/** Title band of the list page: POSTS / 投稿一覧 / lead, search with chips, sort and per-page switches. */
export function renderListBand(
  doc: Document,
  dict: Dict,
  settings: Settings,
  actions: BandActions = {},
  types: Record<string, TagType> = {},
  lang: Lang = 'ja',
): HTMLElement | null {
  const s = STRINGS[lang]
  if (doc.querySelector('.bsb-listband')) return null
  const list = doc.getElementById('post-list-posts')
  const host = doc.getElementById('content') ?? list?.parentElement
  if (!host) return null
  injectBandStyle(doc)

  const url = pageUrl(doc)
  const tokens = queryTokens(url)
  const order = currentOrder(tokens)
  const tags = tokens.filter((t) => !isOrder(t))
  const keep = tokens.filter(isOrder)
  const names = tags.map((t) => queryName(dict, t, types, settings.translateTags, lang))
  const perPage = servedPerPage(url)
  const orderLead = s[ORDERS.find((o) => o.order === order)?.lead ?? 'sortLeadNew']
  const lead = s.bandSummary(names.map((n) => n.label).join(s.nameSep), orderLead, perPage)

  const sortLinks = ORDERS.map((o) =>
    h(
      doc,
      'a',
      {
        href: sortUrl(url.href, o.order),
        class: o.order === order ? 'bsb-on' : undefined,
        'aria-current': o.order === order ? 'true' : undefined,
      },
      s[o.label],
    ),
  )
  const navigate = actions.navigate ?? ((u: string) => doc.defaultView?.location.assign(u))
  const perButtons = PER_PAGE.map((n) => {
    const b = h(
      doc,
      'button',
      { type: 'button', class: n === perPage ? 'bsb-on' : undefined, 'aria-pressed': String(n === perPage) },
      String(n),
    )
    b.addEventListener('click', () => {
      const saved = actions.saveSettings ? actions.saveSettings({ perPage: n }).catch(() => {}) : Promise.resolve()
      void saved.then(() => navigate(limitUrl(url.href, n)))
    })
    return b
  })

  const band = h(
    doc,
    'div',
    { class: 'bsb-band bsb-listband' },
    h(
      doc,
      'div',
      { class: 'bsb-listband-title' },
      s.postsDeco ? h(doc, 'span', { class: 'bsb-en-title', lang: 'en' }, s.postsDeco) : null,
      h(doc, 'h1', null, s.posts),
      h(doc, 'span', { class: 'bsb-lead' }, lead),
      // Search sits at the right end of the title row, close to the header nav and the cursor's usual path.
      searchForm(
        doc,
        names.map((n) => chip(doc, n, settings.showRomaji, lang)),
        keep,
        lang,
      ),
    ),
    h(
      doc,
      'div',
      { class: 'bsb-listband-tools' },
      h(
        doc,
        'div',
        { class: 'bsb-listopts' },
        ...segment(doc, 'bsb-sort', s.sort, sortLinks),
        ...segment(doc, 'bsb-perpage bsb-en', s.perPage, perButtons),
      ),
    ),
  )
  host.prepend(band)

  // The site's own sidebar search box duplicates ours on this page: hide it (kept for site scripts).
  const siteSearch = doc.querySelector('#post-list .sidebar input[name="tags"]')?.closest('.sidebar > div')
  siteSearch?.classList.add('bsb-hide')
  return band
}
