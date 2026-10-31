import type { Dict, TagType } from '../dict'
import { lookup } from '../dict'
import type { Settings } from '../settings'
import { h, type Child } from './render'
import { jaFor, sidebarTag, sidebarType, spaced, tagName, untranslated } from './list'
import { STRINGS, type Lang, type Strings } from '../i18n'
import { extractJsonObjects } from './pagedata'
import { buildPlayer, formatBytes, formatFps, readSetup } from './player'
import showCss from './show.css?inline'
import playerCss from './player.css?inline'
import { proposeUrl, untranslatedMark } from './propose'

const WIKI_BASE = 'https://w.atwiki.jp/sakuga/?page='
const PROPOSE_MAX_TAGS = 20
const LEAD_LIMIT = 3
/** Present on nearly every post; never worth a lead slot or a translation request. */
const NOISE = new Set(['animated'])
const TAG_TYPES: readonly TagType[] = ['artist', 'copyright', 'general', 'character', 'meta', 'circle', 'faults']

/** Aside group order and headings (types not listed fall into 技法 chips' neighbour groups below). */
const GROUPS: ReadonlyArray<{ type: TagType; label: keyof Strings; chips: boolean }> = [
  { type: 'copyright', label: 'groupCopyright', chips: false },
  { type: 'artist', label: 'groupArtist', chips: false },
  { type: 'character', label: 'groupCharacter', chips: false },
  { type: 'general', label: 'groupTech', chips: true },
  { type: 'meta', label: 'groupMeta', chips: true },
]

const RATINGS: Record<string, string> = { s: 'Safe', q: 'Questionable', e: 'Explicit' }
const STATUSES: Record<string, keyof Strings> = { active: 'statusActive', pending: 'statusPending', flagged: 'statusFlagged', deleted: 'statusDeleted' }

/** Joiners that differ by language: title parts, artists in a title, techniques in the lead, lead segments. */
const SEP: Record<Lang, { cp: string; artists: string; techs: string; lead: string }> = {
  ja: { cp: '　', artists: '、', techs: '・', lead: '　' },
  en: { cp: ' / ', artists: ', ', techs: ', ', lead: ' · ' },
}

const RELATED_HEADINGS = new Set(['related posts', '関連する投稿'])
const PREV_TEXTS = new Set(['previous', 'prev', '前', '前の投稿'])
const NEXT_TEXTS = new Set(['next', '次', '次の投稿'])
const NOTE_TEXTS = new Set(['add note', 'add translation', 'ノートを追加', '注釈を追加'])

/** The fields of `Post.register_resp({posts:[...]})` this page uses; every value is checked before use. */
interface ShowPost {
  id: number | null
  tags: string[]
  types: Record<string, TagType>
  source: string
  width: number | null
  height: number | null
  fileSize: number | null
  fileUrl: string | null
  createdAt: number | null
  author: string | null
  creatorId: number | null
  status: string | null
  rating: string | null
  parentId: number | null
  hasChildren: boolean
}

interface Tag {
  tag: string
  type: TagType
  count: string | null
}

const own = <T>(o: Record<string, T>, k: string): T | undefined => (Object.hasOwn(o, k) ? o[k] : undefined)
const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null)
const str = (x: unknown): string | null => (typeof x === 'string' ? x : null)
const norm = (t: string | null | undefined) => (t ?? '').trim().toLowerCase()
const pad2 = (n: number) => String(n).padStart(2, '0')

function injectStyle(doc: Document, id: string, css: string): void {
  if (doc.getElementById(id)) return
  const el = doc.createElement('style')
  el.id = id
  el.textContent = css
  ;(doc.head ?? doc.documentElement).appendChild(el)
}

/** Reads the first post of `Post.register_resp(...)` from the page's inline scripts. */
function readPost(doc: Document): ShowPost | null {
  for (const s of Array.from(doc.querySelectorAll('script:not([src])'))) {
    const text = s.textContent ?? ''
    if (!text.includes('Post.register_resp')) continue
    for (const raw of extractJsonObjects(text, 'Post.register_resp')) {
      let data: unknown
      try {
        data = JSON.parse(raw)
      } catch {
        continue
      }
      const d = data as { posts?: unknown; tags?: unknown }
      const p = Array.isArray(d.posts) ? (d.posts[0] as Record<string, unknown> | undefined) : undefined
      if (!p || typeof p !== 'object') continue
      const types: Record<string, TagType> = {}
      if (d.tags && typeof d.tags === 'object') {
        for (const [k, v] of Object.entries(d.tags as Record<string, unknown>)) {
          if (typeof v === 'string' && (TAG_TYPES as readonly string[]).includes(v)) types[k] = v as TagType
        }
      }
      return {
        id: num(p.id),
        tags: (str(p.tags) ?? '').split(/\s+/).filter(Boolean),
        types,
        source: (str(p.source) ?? '').trim(),
        width: num(p.width),
        height: num(p.height),
        fileSize: num(p.file_size),
        fileUrl: str(p.file_url),
        createdAt: num(p.created_at),
        author: str(p.author),
        creatorId: num(p.creator_id),
        status: str(p.status),
        rating: str(p.rating),
        parentId: num(p.parent_id),
        hasChildren: p.has_children === true,
      }
    }
  }
  return null
}

/** Tags in sidebar order with the sidebar's own counts; post-JSON tags the sidebar lacks come after. */
function collectTags(doc: Document, post: ShowPost | null): Tag[] {
  const out: Tag[] = []
  const seen = new Set<string>()
  for (const li of Array.from(doc.querySelectorAll('#tag-sidebar li'))) {
    const type = sidebarType(li)
    const found = type && sidebarTag(li)
    if (!type || !found || seen.has(found.tag)) continue
    seen.add(found.tag)
    out.push({ tag: found.tag, type: (post && own(post.types, found.tag)) ?? type, count: li.querySelector('.post-count')?.textContent?.trim() || null })
  }
  for (const tag of post?.tags ?? []) {
    const type = post && own(post.types, tag)
    if (seen.has(tag) || !type) continue
    seen.add(tag)
    out.push({ tag, type, count: null })
  }
  return out
}

/** Post id from the post JSON, else from page markup (never from location). */
function postId(doc: Document, post: ShowPost | null): string | null {
  if (post?.id != null) return String(post.id)
  const score = doc.querySelector('[id^="post-score-"]')?.id.slice('post-score-'.length)
  if (score && /^\d+$/.test(score)) return score
  const v = doc.querySelector<HTMLInputElement>('input[name="comment[post_id]"]')?.value
  return v && /^\d+$/.test(v) ? v : null
}

function namePart(doc: Document, dict: Dict, s: Settings, t: Tag, lang: Lang): Child[] {
  const { ja, display } = tagName(dict, t.tag, t.type, s, lang)
  if (lang === 'en') return [display]
  if (ja) return [ja]
  return s.translateTags ? untranslated(doc, t.tag) : [t.tag]
}

function title(doc: Document, dict: Dict, s: Settings, tags: Tag[], lang: Lang): HTMLElement {
  const h1 = h(doc, 'h1')
  const sep = SEP[lang]
  const cps = tags.filter((t) => t.type === 'copyright')
  const cp = cps.find((t) => !t.tag.endsWith('_series')) ?? cps[0]
  if (cp) h1.append(...(namePart(doc, dict, s, cp, lang) as Array<Node | string>))
  const artists = tags.filter((t) => t.type === 'artist')
  if (cp && artists.length) h1.append(sep.cp)
  artists.forEach((t, i) => {
    if (i > 0) h1.append(sep.artists)
    h1.append(...(namePart(doc, dict, s, t, lang) as Array<Node | string>))
  })
  return h1
}

/** `{source}　{up to three general tags}`; translated tags first, site order otherwise. */
function lead(dict: Dict, s: Settings, tags: Tag[], source: string, lang: Lang): string {
  const general = tags.filter((t) => t.type === 'general' && !NOISE.has(t.tag))
  const named = general.map((t) => ({ t, ja: tagName(dict, t.tag, 'general', s, lang).ja }))
  const ordered = [...named.filter((n) => n.ja), ...named.filter((n) => !n.ja)]
  const techs = ordered
    .slice(0, LEAD_LIMIT)
    .map((n) => n.ja ?? spaced(n.t.tag))
    .join(SEP[lang].techs)
  return [source, techs].filter(Boolean).join(SEP[lang].lead)
}

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

/** Previous/Next from the site's related-posts block (either locale), then 一覧へ戻る. */
function bandNav(doc: Document, lang: Lang): HTMLElement {
  const t = STRINGS[lang]
  const ul = relatedList(doc)
  const anchors = ul ? Array.from(ul.querySelectorAll(':scope > li > a[href^="/post/show/"]')) : []
  const links: HTMLElement[] = []
  for (const [texts, label] of [
    [PREV_TEXTS, t.prevPost],
    [NEXT_TEXTS, t.nextPost],
  ] as const) {
    const a = anchors.find((x) => texts.has(norm(x.textContent)))
    if (a) links.push(h(doc, 'a', { class: 'bsb-show-step', href: a.getAttribute('href') ?? undefined }, label))
  }
  links.push(h(doc, 'a', { class: 'bsb-show-step bsb-show-back', href: '/post' }, t.backToList))
  return h(doc, 'nav', { class: 'bsb-show-nav', 'aria-label': t.navLabel }, ...links)
}

/**
 * Title block at the top of the right column (breadcrumb, h1, lead, prev/next/back). It used to be a
 * full-width band above the video, which pushed the player below the fold.
 */
function head(doc: Document, dict: Dict, s: Settings, tags: Tag[], id: string | null, post: ShowPost | null, lang: Lang): HTMLElement {
  const leadText = lead(dict, s, tags, post?.source ?? '', lang)
  const t = STRINGS[lang]
  const crumb = h(
    doc,
    'span',
    { class: 'bsb-crumb' },
    h(doc, 'a', { href: '/post' }, t.postsDeco || t.posts),
    id && (lang === 'ja' ? `　/　#${id}` : ` / #${id}`),
  )
  return h(
    doc,
    'section',
    { class: 'bsb-show-head' },
    h(doc, 'div', { class: 'bsb-show-titles' }, crumb, title(doc, dict, s, tags, lang), leadText && h(doc, 'p', { class: 'bsb-lead' }, leadText)),
    bandNav(doc, lang),
  )
}

const POOL_NOTICE = /^pool\d+$/

/**
 * The site's pool notices ("This post is #31 in the X pool. « Previous | Next »") sit above the video.
 * They become compact rows in the right column; the originals stay in the DOM (hidden) for site scripts.
 */
function pools(doc: Document, view: HTMLElement, lang: Lang): HTMLElement | null {
  const t = STRINGS[lang]
  const notices = Array.from(view.querySelectorAll<HTMLElement>(':scope > .status-notice')).filter((n) => POOL_NOTICE.test(n.id))
  const rows: HTMLElement[] = []
  for (const n of notices) {
    const poolId = n.id.slice('pool'.length)
    const name = n.querySelector<HTMLAnchorElement>(`a[href="/pool/show/${poolId}"]`)
    if (!name) continue
    const steps = Array.from(n.querySelectorAll<HTMLAnchorElement>('a[href^="/post/show/"]'))
    const prev = steps.find((a) => /«|prev|前/i.test(a.textContent ?? ''))
    const next = steps.find((a) => a !== prev && /»|next|次/i.test(a.textContent ?? ''))
    const seq = norm(n.querySelector(`#pool-seq-${poolId}`)?.textContent)
    const step = (a: HTMLAnchorElement | undefined, label: string) =>
      a ? h(doc, 'a', { class: 'bsb-pool-step', href: a.getAttribute('href') ?? undefined }, label) : h(doc, 'span', { class: 'bsb-pool-step bsb-off' }, label)
    rows.push(
      h(
        doc,
        'div',
        { class: 'bsb-pool' },
        h(doc, 'a', { class: 'bsb-pool-name', href: `/pool/show/${poolId}` }, (name.textContent ?? '').trim()),
        seq && h(doc, 'span', { class: 'bsb-pool-seq bsb-en' }, seq),
        h(doc, 'span', { class: 'bsb-pool-steps' }, step(prev, t.poolPrev), step(next, t.poolNext)),
      ),
    )
    n.classList.add('bsb-hide')
  }
  return rows.length ? h(doc, 'section', { class: 'bsb-show-pools', 'aria-label': t.pool }, h(doc, 'div', { class: 'bsb-pool-head' }, t.pool), ...rows) : null
}

const FIT_AIR = 16

/**
 * CSS sizes the video from the viewport height minus --bsb-show-chrome. The fixed default assumes a
 * one-line control row; narrow (e.g. 4:3) videos wrap it, so measure the real space above the video
 * and below it (controls) and feed that back. Two passes: the row height depends on the width.
 */
function fitPlayer(doc: Document, view: HTMLElement, block: HTMLElement, screen: HTMLElement): void {
  const win = doc.defaultView
  if (!win) return
  const fit = () => {
    for (let i = 0; i < 2; i++) {
      const s = screen.getBoundingClientRect()
      const b = block.getBoundingClientRect()
      if (!win.innerHeight || !s.height) return
      const chrome = s.top + win.scrollY + (b.bottom - s.bottom) + FIT_AIR
      view.style.setProperty('--bsb-show-chrome', `${Math.ceil(chrome)}px`)
    }
  }
  let queued = false
  const schedule = () => {
    if (queued) return
    queued = true
    win.requestAnimationFrame?.(() => {
      queued = false
      fit()
    })
  }
  fit()
  win.addEventListener('resize', schedule)
  void doc.fonts?.ready.then(fit)
}

/** A site link from the sidebar options, matched by one of the given predicates. */
function optionLink(doc: Document, pick: (a: HTMLAnchorElement) => boolean): HTMLAnchorElement | null {
  return Array.from(doc.querySelectorAll<HTMLAnchorElement>('#post-view .sidebar a')).find(pick) ?? null
}

/** A grey button that replays a click on the (hidden) site control, so the site's handlers run. */
function forward(doc: Document, cls: string, label: string, target: HTMLElement | null): HTMLElement | null {
  if (!target) return null
  const b = h(doc, 'button', { type: 'button', class: `bsb-act ${cls}` }, label)
  b.addEventListener('click', () => target.click())
  return b
}

const isShown = (el: HTMLElement | null) => !!el && el.style.display !== 'none'

/** お気に入り pill: forwards to the site's add (or, once favourited, remove) link and follows its state. */
function favButton(doc: Document, lang: Lang): HTMLElement | null {
  const t = STRINGS[lang]
  const add = doc.getElementById('add-to-favs')
  const remove = doc.getElementById('remove-from-favs')
  const addA = add?.querySelector<HTMLAnchorElement>('a') ?? null
  const remA = remove?.querySelector<HTMLAnchorElement>('a') ?? null
  if (!addA) return null
  const b = h(doc, 'button', { type: 'button', class: 'bsb-act bsb-fav bsb-pill' }, t.addFav)
  const favd = () => !!remA && isShown(remove) && !isShown(add)
  const sync = () => {
    b.textContent = favd() ? t.removeFav : t.addFav
  }
  b.addEventListener('click', () => (favd() ? remA! : addA).click())
  const View = doc.defaultView?.MutationObserver
  if (View) {
    const mo = new View(sync)
    for (const el of [add, remove]) if (el) mo.observe(el, { attributes: true, attributeFilter: ['style', 'class'] })
  }
  sync()
  return b
}

function scoreRow(doc: Document, post: ShowPost | null, video: HTMLVideoElement | null, fps: number | null, lang: Lang): HTMLElement {
  const t = STRINGS[lang]
  const row = h(doc, 'div', { class: 'bsb-score-row' })
  const scoreSpan = doc.querySelector<HTMLElement>('#stats [id^="post-score-"]')
  if (scoreSpan) row.append(h(doc, 'span', { class: 'bsb-score bsb-en' }, scoreSpan, ' ', h(doc, 'span', { class: 'bsb-score-unit' }, 'pt')))
  const stars = doc.querySelector<HTMLElement>('#stats .stars')
  if (stars) row.append(h(doc, 'span', { class: 'bsb-vote bsb-en' }, stars))

  const edit = optionLink(doc, (a) => a.classList.contains('js-posts-show-edit-tab'))
  const note = optionLink(doc, (a) => NOTE_TEXTS.has(norm(a.textContent)) || /Note\.create|notesManager\.create/.test(a.getAttribute('onclick') ?? ''))
  const hist = optionLink(doc, (a) => (a.getAttribute('href') ?? '').startsWith('/history?search=post'))
  row.append(
    ...([
      favButton(doc, lang),
      forward(doc, '', t.editTags, edit),
      forward(doc, '', t.addNote, note),
      hist && h(doc, 'a', { class: 'bsb-act', href: hist.getAttribute('href') ?? undefined }, t.history),
    ].filter(Boolean) as HTMLElement[]),
  )

  const w = post?.width ?? (Number(video?.getAttribute('width')) || null)
  const ht = post?.height ?? (Number(video?.getAttribute('height')) || null)
  const meta = h(doc, 'span', { class: 'bsb-show-meta bsb-en' })
  const parts = (): string[] => {
    const out: string[] = []
    if (w && ht) out.push(`${w} x ${ht}`)
    if (fps) out.push(`${formatFps(fps)} fps`)
    const d = video?.duration
    if (typeof d === 'number' && Number.isFinite(d) && d > 0) out.push(`${d.toFixed(1)} s`)
    return out
  }
  const sync = () => {
    meta.textContent = parts().join(t.wideSep)
  }
  if (video) for (const ev of ['loadedmetadata', 'durationchange']) video.addEventListener(ev, sync)
  sync()
  row.append(meta)
  return row
}

function player(
  doc: Document,
  right: Element,
  post: ShowPost | null,
  lang: Lang,
): { block: HTMLElement; screen: HTMLElement; video: HTMLVideoElement | null; fps: number | null; ratio: number | null } | null {
  const video = right.querySelector('video')
  if (!video) return null
  // Before video.js runs the <video> itself carries .video-js; afterwards its wrapper div does.
  const target = (video.closest('.video-js') as HTMLElement | null) ?? video
  const conf = readSetup(right.querySelector('[data-setup]') ?? video)
  const screen = h(doc, 'div', { class: 'bsb-player-screen' })
  const w = post?.width ?? Number(video.getAttribute('width'))
  const ht = post?.height ?? Number(video.getAttribute('height'))
  if (w > 0 && ht > 0) screen.style.aspectRatio = `${w} / ${ht}`
  target.before(screen)
  screen.append(target)
  const row = buildPlayer(
    doc,
    {
      video,
      screen,
      rates: conf.rates,
      fps: conf.fps,
      fpsKnown: conf.fpsKnown,
      fileUrl: post?.fileUrl ?? undefined,
      fileSize: post?.fileSize ?? undefined,
    },
    lang,
  )
  return {
    block: h(doc, 'div', { class: 'bsb-player' }, screen, row),
    screen,
    video,
    fps: conf.fpsKnown ? conf.fps : null,
    ratio: w > 0 && ht > 0 ? w / ht : null,
  }
}

function comments(doc: Document, lang: Lang): void {
  const t = STRINGS[lang]
  const box = doc.getElementById('comments')
  if (!box) return
  const list = Array.from(box.querySelectorAll('.comment'))
  for (const c of list) c.classList.add('bsb-comment')
  const h2 = h(doc, 'h2', null, t.comments, list.length > 0 && ' ', list.length > 0 && h(doc, 'span', { class: 'bsb-comment-count bsb-en' }, String(list.length)))
  const sec = h(doc, 'section', { class: 'bsb-comments' }, h2)
  box.before(sec)
  sec.append(box)
  const form = box.querySelector('form[action*="/comment/create"]')
  if (!form) return
  form.classList.add('bsb-comment-form')
  const ta = form.querySelector('textarea')
  if (ta) {
    if (!ta.id) ta.id = 'bsb-comment-text'
    ta.before(h(doc, 'label', { class: 'bsb-comment-label', for: ta.id }, t.writeComment))
  }
  const submit = form.querySelector<HTMLInputElement>('input[type="submit"]')
  if (submit) {
    submit.value = t.submitComment
    if (submit.hasAttribute('data-disable-with')) submit.setAttribute('data-disable-with', t.submitComment)
  }
}

function tagEntry(doc: Document, dict: Dict, s: Settings, t: Tag, chip: boolean, lang: Lang): HTMLElement {
  const href = `/post?tags=${encodeURIComponent(t.tag)}`
  const en = lang === 'en'
  if (chip && NOISE.has(t.tag)) return h(doc, 'a', { class: 'bsb-chip bsb-chip-noise bsb-en', href, 'data-type': t.type }, en ? spaced(t.tag) : t.tag)
  const ja = tagName(dict, t.tag, t.type, s, lang).ja
  const name = h(
    doc,
    'span',
    { class: 'bsb-tag-name' },
    ...(en ? [spaced(t.tag)] : ja ? [ja] : s.translateTags ? [t.tag, untranslatedMark(doc, t.tag)] : [t.tag]),
  )
  const romaji = ja && s.showRomaji ? h(doc, 'span', { class: 'bsb-tag-romaji bsb-en' }, t.tag) : null
  if (chip) return h(doc, 'a', { class: 'bsb-chip', href, 'data-type': t.type }, name, romaji && ' ', romaji)
  const kana = ja && t.type === 'artist' ? lookup(dict, t.tag, 'artist').kana : undefined
  const left = h(doc, 'span', { class: 'bsb-tag-main' }, name, romaji && ' ', romaji, kana && ' ', kana && h(doc, 'span', { class: 'bsb-tag-kana' }, kana))
  const row = h(doc, 'a', { class: 'bsb-tag', href, 'data-type': t.type }, left, t.count && h(doc, 'span', { class: 'bsb-tag-count bsb-en' }, t.count))
  if (t.type !== 'artist' || !ja) return row
  // 作画@wiki pages are titled by the Japanese name; a missing page shows atwiki's own "not found + search" screen.
  const wiki = h(
    doc,
    'a',
    { class: 'bsb-wiki', href: wikiUrl(ja), target: '_blank', rel: 'noopener noreferrer', title: STRINGS[lang].wikiTitle(ja) },
    STRINGS[lang].wiki,
  )
  return h(doc, 'div', { class: 'bsb-tag-row' }, row, wiki)
}

export function wikiUrl(name: string): string {
  return `${WIKI_BASE}${encodeURIComponent(name)}`
}

function tagPanel(doc: Document, dict: Dict, s: Settings, tags: Tag[], lang: Lang): HTMLElement | null {
  const groups: HTMLElement[] = []
  const placed = new Set<TagType>()
  const group = (type: string, label: string, chips: boolean, list: Tag[]) => {
    if (!list.length) return
    // Noise chips (animated) go last, the rest keep site order.
    const ordered = [...list.filter((t) => !NOISE.has(t.tag)), ...list.filter((t) => NOISE.has(t.tag))]
    const entries = ordered.map((t) => tagEntry(doc, dict, s, t, chips, lang))
    groups.push(
      h(
        doc,
        'div',
        { class: 'bsb-tag-group', 'data-type': type },
        h(doc, 'div', { class: 'bsb-tag-head' }, label),
        chips ? h(doc, 'div', { class: 'bsb-chips' }, ...entries) : h(doc, 'div', { class: 'bsb-tag-list' }, ...entries),
      ),
    )
  }
  for (const g of GROUPS) {
    placed.add(g.type)
    group(g.type, STRINGS[lang][g.label] as string, g.chips, tags.filter((t) => t.type === g.type))
  }
  // circle / faults etc.: chips under a generic heading rather than dropping them.
  group('other', STRINGS[lang].groupOther, true, tags.filter((t) => !placed.has(t.type)))
  return groups.length ? h(doc, 'div', { class: 'bsb-tag-panel' }, ...groups) : null
}

function dateText(epochSec: number, lang: Lang = 'ja'): string {
  const d = new Date(epochSec * 1000)
  if (lang === 'en') return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(d)
  return `${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

/** 親子 from the post JSON; the child count only when the status notice actually lists the children. */
function family(doc: Document, post: ShowPost, id: string | null, lang: Lang): Child[] {
  const t = STRINGS[lang]
  const out: Child[] = []
  if (post.parentId != null) out.push(h(doc, 'a', { href: `/post/show/${post.parentId}` }, t.factParent))
  if (post.hasChildren) {
    if (out.length) out.push(lang === 'ja' ? '　' : ', ')
    const notice = Array.from(doc.querySelectorAll('.status-notice')).find((n) =>
      Array.from(n.querySelectorAll('a')).some((a) => /parent(%3A|:)/i.test(a.getAttribute('href') ?? '') && (!id || (a.getAttribute('href') ?? '').endsWith(id))),
    )
    const n = notice ? notice.querySelectorAll('a[href^="/post/show/"]').length : 0
    const href = id ? `/post?tags=${encodeURIComponent(`parent:${id}`)}` : undefined
    out.push(h(doc, 'a', { href }, n > 0 ? t.factChild : t.factChildAny, n > 0 && h(doc, 'span', { class: 'bsb-en' }, String(n))))
  }
  return out
}

function facts(doc: Document, post: ShowPost | null, id: string | null, lang: Lang): HTMLElement | null {
  if (!post) return null
  const t = STRINGS[lang]
  const rows: Array<[string, Child]> = []
  if (post.author) {
    const href = post.creatorId != null ? `/user/show/${post.creatorId}` : undefined
    rows.push([t.factUploader, href ? h(doc, 'a', { href }, post.author) : h(doc, 'span', null, post.author)])
  }
  if (post.createdAt != null) rows.push([t.factPosted, h(doc, 'span', { class: 'bsb-en' }, dateText(post.createdAt, lang))])
  if (post.source) {
    const isUrl = /^https?:\/\//i.test(post.source)
    rows.push([
      t.factSource,
      isUrl ? h(doc, 'a', { href: post.source, target: '_blank', rel: 'noopener noreferrer' }, post.source) : h(doc, 'span', null, post.source),
    ])
  }
  const rating = post.rating && own(RATINGS, post.rating)
  if (rating) rows.push([t.factRating, h(doc, 'span', null, rating)])
  if (post.width && post.height) {
    const size = `${post.width} x ${post.height}` + (post.fileSize ? `${t.wideSep}${formatBytes(post.fileSize)}` : '')
    rows.push([t.factSize, h(doc, 'span', { class: 'bsb-en' }, size)])
  }
  const statusKey = post.status && own(STATUSES, post.status)
  if (statusKey) rows.push([t.factStatus, h(doc, 'span', null, t[statusKey] as string)])
  const fam = family(doc, post, id, lang)
  if (fam.length) rows.push([t.factFamily, h(doc, 'span', null, ...fam)])
  if (!rows.length) return null
  const grid = h(doc, 'div', { class: 'bsb-show-facts' })
  for (const [label, value] of rows) grid.append(h(doc, 'span', { class: 'bsb-fact-label' }, label), value as Node)
  return grid
}

function proposeNote(doc: Document, dict: Dict, s: Settings, tags: Tag[], lang: Lang): HTMLElement | null {
  if (!s.translateTags || lang === 'en') return null
  const missing = tags
    .filter((t) => !NOISE.has(t.tag) && !jaFor(dict, t.tag, t.type, true))
    .map((t) => t.tag)
    .filter((t, i, a) => a.indexOf(t) === i)
    .slice(0, PROPOSE_MAX_TAGS)
  if (!missing.length) return null
  const href = proposeUrl(missing, doc.location?.href)
  return h(
    doc,
    'p',
    { class: 'bsb-show-note' },
    STRINGS[lang].proposeNoteLead,
    h(doc, 'a', { class: 'bsb-propose', href, target: '_blank', rel: 'noopener' }, STRINGS[lang].propose),
  )
}

/** True on a show page (also when already rendered: idempotent no-op); false otherwise. */
export function renderShow(doc: Document, dict: Dict, settings: Settings, lang: Lang = 'ja'): boolean {
  const view = doc.getElementById('post-view')
  const body = doc.body
  if (!view || !body) return false
  if (body.hasAttribute('data-bsb-show')) return true
  body.setAttribute('data-bsb-show', '')
  injectStyle(doc, 'bsb-show', showCss)
  injectStyle(doc, 'bsb-player', playerCss)

  const post = readPost(doc)
  const tags = collectTags(doc, post)
  const id = postId(doc, post)

  view.classList.add('bsb-show-view')
  const main = h(doc, 'main', { class: 'bsb-show-main' })
  const side = h(doc, 'aside', { class: 'bsb-show-side' })
  view.append(h(doc, 'div', { class: 'bsb-show-body' }, main, side))

  const right = doc.getElementById('right-col')
  const p = right ? player(doc, right, post, lang) : null
  if (p) main.append(p.block)
  // The video's aspect ratio lets CSS cap its width so the whole player fits the viewport height.
  if (p?.ratio) view.style.setProperty('--bsb-ar-num', String(Math.round(p.ratio * 10000) / 10000))
  const poolBlock = pools(doc, view, lang)
  // Other site notices (parent/child, pending, …) move under the controls instead of above the video.
  for (const n of Array.from(view.querySelectorAll(':scope > .status-notice'))) if (!POOL_NOTICE.test(n.id)) main.append(n)
  main.append(scoreRow(doc, post, p?.video ?? null, p?.fps ?? null, lang))
  if (right) {
    main.append(right)
    // The site's "Edit | Respond" tab strip: our score row carries both actions now.
    const tabs = right.querySelector('h4 .js-posts-show-comments-tab')?.closest('h4')
    tabs?.classList.add('bsb-hide')
  }
  comments(doc, lang)

  side.append(
    ...([
      head(doc, dict, settings, tags, id, post, lang),
      poolBlock,
      tagPanel(doc, dict, settings, tags, lang),
      facts(doc, post, id, lang),
      proposeNote(doc, dict, settings, tags, lang),
    ].filter(Boolean) as HTMLElement[]),
  )
  // The site sidebar (search, tags, stats, options) stays in the DOM for its scripts; ours replaces it.
  for (const sb of Array.from(view.querySelectorAll(':scope > .sidebar'))) sb.classList.add('bsb-hide')
  if (p) fitPlayer(doc, view, p.block, p.screen)
  return true
}
