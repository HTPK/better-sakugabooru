import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { JSDOM } from 'jsdom'
import { renderShow } from './show'
import { DEFAULTS, type Settings } from '../settings'
import type { Dict } from '../dict'

const fixture = (name: string) => readFileSync(resolve(__dirname, '../../test/fixtures', name), 'utf8')
const LIST = fixture('post-list-2026-10-12.html')
const PAGE_URL = 'https://www.sakugabooru.com/post/show/318817'
const CASES = [
  { name: 'English', html: fixture('post-show-318817-2026-10-12.html') },
  { name: 'Japanese', html: fixture('post-show-318817-ja-2026-10-12.html') },
]

/** The post JSON exactly as the page carries it, so expectations are derived, not typed in. */
function postJson(html: string) {
  const m = /Post\.register_resp\((\{.*\})\);/.exec(html)!
  return JSON.parse(m[1]).posts[0] as {
    score: number
    author: string
    width: number
    height: number
    file_size: number
    file_url: string
    created_at: number
    source: string
    creator_id: number
  }
}

// Placeholder Japanese so tests never assert real translations. `fighting` and `wind` stay untranslated.
const dict: Dict = {
  v: 1,
  updated: 'test',
  artists: { shuu_sugita: { ja: 'スタブ作画者', kana: 'すたぶ' } },
  copyrights: { my_hero_academia: { ja: 'スタブ作品' } },
  general: {
    effects: { ja: 'スタブ効果' },
    lightning: { ja: 'スタブ電撃' },
    smears: { ja: 'スタブスミア' },
    hair: { ja: 'スタブ髪' },
    black_and_white: { ja: 'スタブ白黒' },
    animated: { ja: 'スタブ動画' },
  },
}

const load = (html: string) => new JSDOM(html, { url: PAGE_URL }).window.document
const txt = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()

describe('renderShow on a non-show page', () => {
  it('returns false and leaves the page alone', () => {
    const doc = load(LIST)
    expect(renderShow(doc, dict, DEFAULTS)).toBe(false)
    expect(doc.querySelector('.bsb-show-band')).toBeNull()
    expect(doc.body.hasAttribute('data-bsb-show')).toBe(false)
  })
})

describe('renderShow propose link', () => {
  it('lists at most 20 untranslated tags', () => {
    const doc = load(CASES[0].html)
    const ul = doc.getElementById('tag-sidebar')!
    for (let i = 0; i < 30; i++) {
      ul.insertAdjacentHTML(
        'beforeend',
        `<li class="tag-type-general"><a href="/wiki/show?title=zz${i}">?</a> <a href="/post?tags=zz${i}">zz${i}</a> <span class="post-count">1</span></li>`,
      )
    }
    renderShow(doc, dict, DEFAULTS)
    const u = new URL(doc.querySelector<HTMLAnchorElement>('a.bsb-propose')!.href)
    const tags = u.searchParams.get('tags')!.split('\n')
    expect(tags).toHaveLength(20)
    expect(tags.slice(0, 2)).toEqual(['fighting', 'wind'])
    expect(u.searchParams.get('title')!.split(', ')).toHaveLength(20)
  })
})

describe.each(CASES)('renderShow ($name locale)', ({ html }) => {
  const post = postJson(html)
  const run = (patch: Partial<Settings> = {}, d: Dict = dict) => {
    const doc = load(html)
    const res = renderShow(doc, d, { ...DEFAULTS, ...patch })
    return { doc, res }
  }

  it('builds the band: breadcrumb, h1 and lead with the source', () => {
    const { doc, res } = run()
    expect(res).toBe(true)
    const band = doc.querySelector('#content > section.bsb-band.bsb-show-band')!
    expect(band).not.toBeNull()
    const crumb = band.querySelector('.bsb-crumb')!
    expect(crumb.textContent).toBe('POSTS　/　#318817')
    expect(crumb.querySelector('a')!.getAttribute('href')).toBe('/post')
    expect(band.querySelector('h1')!.textContent).toBe('スタブ作品　スタブ作画者')
    expect(band.querySelector('.bsb-lead')!.textContent).toBe(`${post.source.trim()}　スタブ白黒・スタブ効果・スタブ髪`)
  })

  it('marks untranslated title parts with 未訳', () => {
    const { doc } = run({}, { ...dict, artists: {} })
    const h1 = doc.querySelector('.bsb-show-band h1')!
    expect(h1.textContent).toContain('shuu_sugita')
    expect(h1.querySelector('.bsb-untranslated')!.textContent).toBe('未訳')
  })

  it('lead shows untranslated tags spaced, never animated', () => {
    const { doc } = run({}, { ...dict, general: {} })
    const lead = doc.querySelector('.bsb-show-band .bsb-lead')!.textContent!
    expect(lead).toBe(`${post.source.trim()}　black and white・effects・fighting`)
  })

  it('band buttons: prev/next from related posts, then back to the list', () => {
    const { doc } = run()
    const links = Array.from(doc.querySelectorAll<HTMLAnchorElement>('.bsb-show-band .bsb-show-nav a'))
    expect(links.map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['前の投稿', '/post/show/318816'],
      ['次の投稿', '/post/show/318818'],
      ['一覧へ戻る', '/post'],
    ])
    expect(doc.querySelector('.bsb-show-band .bsb-en-title')).toBeNull()
  })

  it('omits prev/next when the related block is absent', () => {
    const doc = load(html)
    for (const a of Array.from(doc.querySelectorAll('#post-view .sidebar a[href^="/post/show/"]'))) a.remove()
    renderShow(doc, dict, DEFAULTS)
    expect(Array.from(doc.querySelectorAll('.bsb-show-nav a')).map((a) => a.textContent)).toEqual(['一覧へ戻る'])
  })

  it('lays out main + aside and reparents the site nodes', () => {
    const doc = load(html)
    const video = doc.querySelector('video')
    const comments = doc.getElementById('comments')
    renderShow(doc, dict, DEFAULTS)
    const body = doc.querySelector('#post-view > div.bsb-show-body')!
    const main = body.querySelector(':scope > main.bsb-show-main')!
    expect(body.querySelector(':scope > aside.bsb-show-side')).not.toBeNull()
    expect(doc.querySelector('video')).toBe(video)
    expect(video!.closest('.bsb-player-screen')!.closest('main')).toBe(main)
    expect(doc.getElementById('comments')).toBe(comments)
    expect(comments!.closest('main')).toBe(main)
    const screen = doc.querySelector<HTMLElement>('.bsb-player-screen')!
    expect(screen.style.aspectRatio.replace(/\s/g, '')).toBe(`${post.width}/${post.height}`)
    for (const id of ['tag-sidebar', 'stats', 'comments', 'post-view', 'right-col', 'highres', 'add-to-favs', 'edit']) {
      expect(doc.getElementById(id), id).not.toBeNull()
    }
    expect(doc.querySelector('#post-view > .sidebar')!.classList.contains('bsb-hide')).toBe(true)
    expect(doc.getElementById('bsb-show')).not.toBeNull()
  })

  it('player row controls drive the site video', () => {
    const { doc } = run()
    const video = doc.querySelector('video')!
    let paused = true
    Object.defineProperty(video, 'paused', { configurable: true, get: () => paused })
    video.play = vi.fn(() => {
      paused = false
      return Promise.resolve()
    })
    video.pause = vi.fn(() => {
      paused = true
    })
    let t = 2
    Object.defineProperty(video, 'currentTime', { configurable: true, get: () => t, set: (x) => (t = x) })
    const row = doc.querySelector('.bsb-show-main .bsb-player-row')!
    row.querySelector<HTMLButtonElement>('.bsb-play')!.click()
    expect(video.play).toHaveBeenCalled()
    expect(Array.from(row.querySelectorAll('.bsb-speed button')).map((b) => b.textContent)).toEqual(['0.2x', '0.4x', '0.6x', '0.8x', '1x'])
    row.querySelector<HTMLButtonElement>('.bsb-speed button')!.click()
    expect(video.playbackRate).toBe(0.2)
    row.querySelectorAll<HTMLButtonElement>('.bsb-step')[1].click()
    expect(t).toBeCloseTo(2 + 1 / 23.976024, 6)
    expect(row.querySelector('.bsb-loop')!.getAttribute('aria-pressed')).toBe('true')
    row.querySelector<HTMLButtonElement>('.bsb-loop')!.click()
    expect(video.loop).toBe(false)
    row.querySelector<HTMLButtonElement>('.bsb-mute')!.click()
    expect(video.muted).toBe(true)
    const save = row.querySelector<HTMLAnchorElement>('a.bsb-save')!
    expect(save.getAttribute('href')).toBe(post.file_url)
    expect(txt(save)).toBe(`mp4 を保存 ${(post.file_size / 1024 / 1024).toFixed(1)} MB`)
  })

  it('score row: live site score span, vote widget, forwarded actions and specs', () => {
    const doc = load(html)
    const score = doc.getElementById('post-score-318817')
    const stars = doc.querySelector('#stats .stars')
    renderShow(doc, dict, DEFAULTS)
    const row = doc.querySelector('.bsb-show-main .bsb-score-row')!
    expect(doc.getElementById('post-score-318817')).toBe(score)
    expect(score!.closest('.bsb-score')!.closest('.bsb-score-row')).toBe(row)
    expect(score!.textContent).toBe(String(post.score))
    expect(stars!.closest('.bsb-score-row')).toBe(row)
    expect(Array.from(row.querySelectorAll('.bsb-act')).map((b) => txt(b))).toEqual(['お気に入りに追加', 'タグを編集', '履歴'])
    expect(row.querySelector('a.bsb-act')!.getAttribute('href')).toBe('/history?search=post%3A318817')

    const fav = vi.fn((e: Event) => e.preventDefault())
    doc.querySelector('#add-to-favs a')!.addEventListener('click', fav)
    row.querySelector<HTMLButtonElement>('.bsb-fav')!.click()
    expect(fav).toHaveBeenCalledTimes(1)
    const edit = vi.fn((e: Event) => e.preventDefault())
    doc.querySelector('#post-view .sidebar a.js-posts-show-edit-tab')!.addEventListener('click', edit)
    row.querySelectorAll<HTMLButtonElement>('button.bsb-act')[1].click()
    expect(edit).toHaveBeenCalledTimes(1)

    const meta = row.querySelector('.bsb-show-meta')!
    expect(meta.textContent).toBe(`${post.width} x ${post.height}　23.98 fps`)
    const video = doc.querySelector('video')!
    Object.defineProperty(video, 'duration', { configurable: true, get: () => 21.13 })
    video.dispatchEvent(new doc.defaultView!.Event('loadedmetadata'))
    expect(meta.textContent).toBe(`${post.width} x ${post.height}　23.98 fps　21.1 s`)
  })

  it('omits forwarded buttons whose site link is missing', () => {
    const doc = load(html)
    doc.getElementById('add-to-favs')!.remove()
    renderShow(doc, dict, DEFAULTS)
    expect(doc.querySelector('.bsb-fav')).toBeNull()
  })

  it('comments: heading counts the .comment nodes and the form is relabelled', () => {
    const doc = load(html)
    const n = doc.querySelectorAll('#comments .comment').length
    renderShow(doc, dict, DEFAULTS)
    const sec = doc.querySelector('.bsb-show-main section.bsb-comments')!
    expect(sec.querySelector('#comments')).not.toBeNull()
    expect(sec.querySelector('h2')!.firstChild!.textContent).toBe('コメント')
    expect(sec.querySelector('h2 .bsb-comment-count')!.textContent).toBe(String(n))
    expect(sec.querySelectorAll('.comment.bsb-comment')).toHaveLength(n)
    const label = sec.querySelector<HTMLLabelElement>('label.bsb-comment-label')!
    expect(label.textContent).toBe('コメントを書く')
    expect(doc.getElementById(label.htmlFor)!.tagName).toBe('TEXTAREA')
    const submit = sec.querySelector<HTMLInputElement>('form input[type="submit"]')!
    expect(submit.value).toBe('コメントを投稿')
  })

  it('comments: hides the count when there are none', () => {
    const doc = load(html)
    for (const c of Array.from(doc.querySelectorAll('#comments .comment'))) c.remove()
    renderShow(doc, dict, DEFAULTS)
    expect(doc.querySelector('.bsb-comments h2 .bsb-comment-count')).toBeNull()
  })

  it('aside: tag groups coloured by type with romaji, kana and site counts', () => {
    const { doc } = run()
    const side = doc.querySelector('aside.bsb-show-side .bsb-tag-panel')!
    const groups = Array.from(side.querySelectorAll<HTMLElement>('.bsb-tag-group'))
    expect(groups.map((g) => [g.dataset.type, txt(g.querySelector('.bsb-tag-head'))])).toEqual([
      ['copyright', '作品'],
      ['artist', '作画者'],
      ['general', '技法'],
    ])
    const artist = groups[1].querySelector<HTMLAnchorElement>('a.bsb-tag')!
    expect(artist.dataset.type).toBe('artist')
    expect(artist.getAttribute('href')).toBe('/post?tags=shuu_sugita')
    expect(txt(artist.querySelector('.bsb-tag-name'))).toBe('スタブ作画者')
    expect(artist.querySelector('.bsb-tag-romaji')!.textContent).toBe('shuu_sugita')
    expect(artist.querySelector('.bsb-tag-kana')!.textContent).toBe('すたぶ')
    const siteCount = doc.querySelector('#tag-sidebar .tag-type-artist .post-count')!.textContent
    expect(artist.querySelector('.bsb-tag-count')!.textContent).toBe(siteCount)
    const chips = Array.from(groups[2].querySelectorAll<HTMLAnchorElement>('a.bsb-chip'))
    expect(chips.at(-1)!.textContent).toBe('animated')
    expect(chips.at(-1)!.classList.contains('bsb-chip-noise')).toBe(true)
    const fighting = chips.find((c) => c.getAttribute('href') === '/post?tags=fighting')!
    expect(fighting.querySelector('.bsb-untranslated')!.textContent).toBe('未訳')
  })

  it('aside: stats grid from the post JSON', () => {
    const { doc } = run()
    const facts = doc.querySelector('aside .bsb-show-facts')!
    const rows = new Map<string, Element>()
    for (const l of Array.from(facts.querySelectorAll('.bsb-fact-label'))) rows.set(l.textContent!, l.nextElementSibling!)
    expect(Array.from(rows.keys())).toEqual(['投稿者', '投稿日', '出典', 'レーティング', 'サイズ', '状態', '親子'])
    expect(txt(rows.get('投稿者'))).toBe(post.author)
    expect(rows.get('投稿者')!.getAttribute('href')).toBe(`/user/show/${post.creator_id}`)
    const d = new Date(post.created_at * 1000)
    const p = (n: number) => String(n).padStart(2, '0')
    expect(rows.get('投稿日')!.textContent).toBe(
      `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`,
    )
    expect(rows.get('出典')!.textContent).toBe(post.source.trim())
    expect(rows.get('レーティング')!.textContent).toBe('Safe')
    expect(rows.get('サイズ')!.textContent).toBe(`${post.width} x ${post.height}　${(post.file_size / 1024 / 1024).toFixed(1)} MB`)
    expect(rows.get('状態')!.textContent).toBe('承認済み')
    // The status notice lists one child post id.
    expect(txt(rows.get('親子'))).toBe('子投稿 1')
    expect(doc.querySelector('#stats')!.closest('.bsb-hide')).not.toBeNull()
  })

  it('offers a propose link prefilling the issue form fields', () => {
    const { doc } = run()
    const note = doc.querySelector('aside .bsb-show-note')!
    expect(note.firstChild!.textContent).toBe('訳が違う、または足りないタグがあれば ')
    const a = note.querySelector<HTMLAnchorElement>('a.bsb-propose')!
    expect(a.target).toBe('_blank')
    expect(a.rel).toBe('noopener')
    const href = a.getAttribute('href')!
    expect(href).toMatch(/^https:\/\/github\.com\/HTPK\/sakugabooru-ja-dict\/issues\/new\?template=translation\.yml&title=/)
    const u = new URL(href)
    expect(u.searchParams.get('title')).toBe('翻訳提案: fighting, wind')
    expect(u.searchParams.get('labels')).toBe('translation')
    expect(u.searchParams.get('tags')).toBe('fighting\nwind')
    expect(u.searchParams.get('post')).toBe(PAGE_URL)
  })

  it('omits the propose note when everything is translated', () => {
    const full: Dict = {
      ...dict,
      general: { ...dict.general, fighting: { ja: 'スタブ格闘' }, wind: { ja: 'スタブ風' } },
    }
    const { doc } = run({}, full)
    expect(doc.querySelector('.bsb-show-note')).toBeNull()
  })

  it('is idempotent and still reports a show page', () => {
    const doc = load(html)
    expect(renderShow(doc, dict, DEFAULTS)).toBe(true)
    const body = doc.body.innerHTML
    expect(renderShow(doc, dict, DEFAULTS)).toBe(true)
    expect(doc.body.innerHTML).toBe(body)
    expect(doc.querySelectorAll('.bsb-show-band')).toHaveLength(1)
    expect(doc.querySelectorAll('style#bsb-show')).toHaveLength(1)
  })
})
