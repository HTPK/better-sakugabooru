import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { JSDOM } from 'jsdom'
import { renderList, injectListStyle } from './list'
import { DEFAULTS, type Settings } from '../settings'
import { parsePosts } from './pagedata'
import type { Dict } from '../dict'

const FIXTURE = resolve(__dirname, '../../test/fixtures/post-list-2026-10-12.html')
const HTML = readFileSync(FIXTURE, 'utf8')

// Stub entries use placeholder Japanese so tests never assert real translations.
const dict: Dict = {
  v: 1,
  updated: 'test',
  artists: { kabukyuu: { ja: 'スタブ作画者' }, shuuichiro_manabe: { ja: 'スタブ真鍋' } },
  copyrights: { dragon_ball_super: { ja: 'スタブ作品' }, my_hero_academia: { ja: 'スタブ作品B' } },
  general: { effects: { ja: 'スタブ効果' }, artist_unknown: { ja: '作画者不明' } },
}

const load = () => new JSDOM(HTML, { url: 'https://www.sakugabooru.com/post' }).window.document
const run = (patch: Partial<Settings> = {}) => {
  const doc = load()
  const res = renderList(doc, dict, { ...DEFAULTS, ...patch })
  return { doc, res }
}
const cards = (doc: Document) => Array.from(doc.querySelectorAll<HTMLElement>('.bsb-grid > li.bsb-card'))
const expectedCount = () => (HTML.match(/Post\.register\(\{/g) ?? []).length

describe('renderList', () => {
  it('renders one card per registered post and hides the original list', () => {
    const { doc, res } = run()
    const n = expectedCount()
    expect(n).toBeGreaterThan(0)
    expect(cards(doc)).toHaveLength(n)
    expect(res.cards).toBe(n)
    const orig = doc.getElementById('post-list-posts')!
    expect(orig.classList.contains('bsb-hide')).toBe(true)
    expect(orig.nextElementSibling?.classList.contains('bsb-grid')).toBe(true)
  })

  it('builds thumb link, preview image, file url and aspect ratio', () => {
    const { doc } = run()
    const card = cards(doc)[0]
    expect(card.dataset.postId).toBe('318841')
    const a = card.querySelector<HTMLAnchorElement>('a.bsb-thumb')!
    expect(a.getAttribute('href')).toBe('/post/show/318841')
    expect(a.dataset.fileUrl).toMatch(/\.mp4$/)
    expect(a.style.getPropertyValue('--bsb-ar')).toMatch(/^\d+\/\d+$/)
    const img = a.querySelector<HTMLImageElement>('img.bsb-preview')!
    expect(img.getAttribute('src')).toMatch(/\/preview\//)
    expect(img.alt).toContain('スタブ作品')
  })

  it('shows the most specific non-series copyright in Japanese', () => {
    const { doc } = run()
    expect(cards(doc)[0].querySelector('.bsb-work')!.textContent).toBe('スタブ作品')
  })

  it('marks untranslated tags with 未訳 and shows the raw tag', () => {
    const { doc } = run()
    // second post's artist shun_sawai is not in the stub dict
    const artists = cards(doc)[1].querySelector('.bsb-artists')!
    expect(artists.querySelector('.bsb-raw')!.textContent).toBe('shun_sawai')
    expect(artists.querySelector('.bsb-untranslated')!.textContent).toBe('未訳')
  })

  it('links artists like the mock: name only, raw tag as tooltip, full-width space between', () => {
    const { doc } = run()
    const a = cards(doc)[0].querySelector<HTMLAnchorElement>('.bsb-artists a')!
    expect(a.getAttribute('href')).toBe('/post?tags=shuuichiro_manabe')
    expect(a.textContent).toBe('スタブ真鍋')
    expect(a.title).toBe('shuuichiro_manabe')
    expect(cards(doc)[0].querySelector('.bsb-artists .bsb-romaji')).toBeNull()
    const multi = cards(doc).find((c) => c.querySelectorAll('.bsb-artists a').length > 1)
    if (multi) expect(multi.querySelector('.bsb-artists')!.textContent).toContain('　')
  })

  it('tags caption rows with their tag-type colour classes', () => {
    const { doc } = run()
    const c = cards(doc)[0]
    expect(c.querySelector('.bsb-work')!.classList.contains('bsb-t-copyright')).toBe(true)
    expect(c.querySelector('.bsb-artists a')!.classList.contains('bsb-t-artist')).toBe(true)
    const chip = c.querySelector('.bsb-tech .bsb-chip:not(.bsb-more)')!
    expect(chip.classList.contains('bsb-t-general')).toBe(true)
  })

  it('technique chips are links to that tag search', () => {
    const { doc } = run()
    const chips = Array.from(doc.querySelectorAll<HTMLElement>('.bsb-tech .bsb-chip:not(.bsb-more)'))
    expect(chips.length).toBeGreaterThan(0)
    for (const c of chips) {
      expect(c.tagName).toBe('A')
      expect(c.getAttribute('href')).toBe(`/post?tags=${encodeURIComponent(c.getAttribute('title')!)}`)
    }
  })

  it('shows score and zero-padded local date', () => {
    const { doc } = run()
    const meta = cards(doc)[0].querySelector('.bsb-meta')!
    const spans = meta.querySelectorAll('span')
    expect(spans[0].textContent).toBe('9 pt')
    expect(spans[1].textContent).toMatch(/^\d{2}\/\d{2}$/)
  })

  it('follows thumbSize for data-cols', () => {
    expect(run().doc.querySelector('.bsb-grid')!.getAttribute('data-cols')).toBe('6')
    expect(run({ thumbSize: 'small' }).doc.querySelector('.bsb-grid')!.getAttribute('data-cols')).toBe('8')
    expect(run({ thumbSize: 'large' }).doc.querySelector('.bsb-grid')!.getAttribute('data-cols')).toBe('4')
  })

  it('gates caption rows by settings', () => {
    const { doc } = run({ showTech: false, showCopyright: false, showArtist: false, showScoreDate: false })
    const c = cards(doc)[0]
    expect(c.querySelector('.bsb-tech')).toBeNull()
    expect(c.querySelector('.bsb-work')).toBeNull()
    expect(c.querySelector('.bsb-artists')).toBeNull()
    expect(c.querySelector('.bsb-meta')).toBeNull()
    expect(run({ techLimit: 0 }).doc.querySelector('.bsb-tech')).toBeNull()
  })

  it('limits technique chips and shows the remainder', () => {
    // first post general tags (excluding animated): beams effects fighting
    const { doc } = run({ techLimit: 1 })
    const chips = cards(doc)[0].querySelectorAll('.bsb-tech .bsb-chip')
    expect(chips).toHaveLength(2)
    expect(chips[0].textContent).toBe('beams')
    expect(chips[1].classList.contains('bsb-more')).toBe(true)
    expect(chips[1].textContent).toBe('+2')
    const all = run({ techLimit: 5 }).doc
    expect(cards(all)[0].querySelector('.bsb-tech .bsb-more')).toBeNull()
    expect(cards(all)[0].querySelectorAll('.bsb-tech .bsb-chip')[1].textContent).toBe('スタブ効果')
  })

  it('rewrites paginator links only when perPage is not 40', () => {
    const at40 = run().doc
    const hrefs40 = Array.from(at40.querySelectorAll('#paginator a[href]')).map((a) => a.getAttribute('href'))
    expect(hrefs40.every((h) => !h!.includes('limit='))).toBe(true)
    const at60 = run({ perPage: 60 }).doc
    const links = Array.from(at60.querySelectorAll('#paginator a[href]'))
    expect(links.length).toBeGreaterThan(0)
    for (const a of links) {
      const u = new URL(a.getAttribute('href')!, 'https://www.sakugabooru.com/')
      expect(u.searchParams.get('limit')).toBe('60')
      expect(u.searchParams.get('page')).not.toBeNull()
    }
  })

  it('is idempotent', () => {
    const { doc } = run()
    const again = renderList(doc, dict, DEFAULTS)
    expect(again.cards).toBe(0)
    expect(cards(doc)).toHaveLength(expectedCount())
    expect(doc.querySelectorAll('.bsb-grid')).toHaveLength(1)
  })

  it('translates the sidebar', () => {
    const { doc } = run()
    const lis = Array.from(doc.querySelectorAll<HTMLLIElement>('#tag-sidebar li'))
    const kab = lis.find((li) => li.querySelector('a[href="/post?tags=kabukyuu"]'))!
    const link = kab.querySelector('a[href="/post?tags=kabukyuu"]')!
    expect(link.textContent).toBe('スタブ作画者')
    expect(link.nextElementSibling!.classList.contains('bsb-romaji')).toBe(true)
    expect(link.nextElementSibling!.textContent).toBe('kabukyuu')
    expect(kab.hasAttribute('data-bsb-done')).toBe(true)
    expect(kab.querySelector('.post-count')).not.toBeNull()
    const unk = lis.find((li) => li.querySelector('a[href="/post?tags=artist_unknown"]'))!
    expect(unk.querySelector('a[href="/post?tags=artist_unknown"]')!.textContent).toBe('作画者不明')
    const kay = lis.find((li) => li.querySelector('a[href="/post?tags=kay_yu"]'))!
    expect(kay.querySelector('a[href="/post?tags=kay_yu"]')!.textContent).toBe('kay yu')
    expect(kay.querySelector('.bsb-untranslated')!.textContent).toBe('未訳')
  })

  it('groups the sidebar by type (copyright, artist, general, meta) moving the same nodes', () => {
    const doc = load()
    const before = Array.from(doc.querySelectorAll('#tag-sidebar li'))
    renderList(doc, dict, DEFAULTS)
    const after = Array.from(doc.querySelectorAll('#tag-sidebar li'))
    expect(new Set(after)).toEqual(new Set(before))
    const rank: Record<string, number> = { copyright: 0, artist: 1, general: 2, meta: 9 }
    const ranks = after.map((li) => rank[li.className.replace(/^.*tag-type-(\w+).*$/, '$1')] ?? 5)
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b))
    expect(ranks[0]).toBe(0)
  })

  it('sets Japanese title/alt on original thumbs', () => {
    const { doc } = run()
    const img = doc.querySelector<HTMLImageElement>('#post-list-posts img.preview')!
    expect(img.title).toBe(img.alt)
    expect(img.alt.startsWith('スタブ作品 / スタブ真鍋')).toBe(true)
  })

  it('does nothing without posts', () => {
    const doc = new JSDOM('<ul id="post-list-posts"></ul>').window.document
    expect(renderList(doc, dict, DEFAULTS).cards).toBe(0)
    expect(doc.querySelector('.bsb-grid')).toBeNull()
  })

  it('skips posts matching the site blacklist', () => {
    const first = /Post\.register\((\{"id":318841[^\n]*?\})\)/.exec(HTML)
    const tags = (JSON.parse(first![1]) as { tags: string }).tags
    const html = HTML.replace(
      /(<script id="user-blacklisted-tags" type="application\/json">)\s*\[\]/,
      `$1${JSON.stringify([tags])}`,
    )
    expect(html).not.toBe(HTML)
    const doc = new JSDOM(html, { url: 'https://www.sakugabooru.com/post' }).window.document
    const res = renderList(doc, dict, DEFAULTS)
    expect(res.cards).toBe(expectedCount() - 1)
    expect(cards(doc)).toHaveLength(expectedCount() - 1)
    expect(doc.querySelector('.bsb-card[data-post-id="318841"]')).toBeNull()
  })

  it('skips posts the site already marked as blacklisted', () => {
    const doc = load()
    doc.getElementById('p318841')!.classList.add('blacklisted')
    renderList(doc, dict, DEFAULTS)
    expect(cards(doc)).toHaveLength(expectedCount() - 1)
    expect(doc.querySelector('.bsb-card[data-post-id="318841"]')).toBeNull()
  })

  it('forwards a plain left click on a card to the original thumb anchor', () => {
    const { doc } = run()
    const orig = doc.querySelector<HTMLAnchorElement>('#p318841 a.thumb')!
    const seen: MouseEvent[] = []
    orig.addEventListener('click', (e) => {
      seen.push(e)
      e.preventDefault()
    })
    const thumb = cards(doc)[0].querySelector<HTMLAnchorElement>('a.bsb-thumb')!
    const ev = new doc.defaultView!.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
    thumb.querySelector('img')!.dispatchEvent(ev)
    expect(seen).toHaveLength(1)
    expect(ev.defaultPrevented).toBe(true)
  })

  it('leaves modified and non-primary clicks alone', () => {
    const { doc } = run()
    const orig = doc.querySelector<HTMLAnchorElement>('#p318841 a.thumb')!
    let forwarded = 0
    orig.addEventListener('click', (e) => {
      forwarded++
      e.preventDefault()
    })
    const thumb = cards(doc)[0].querySelector<HTMLAnchorElement>('a.bsb-thumb')!
    const W = doc.defaultView!
    // Stop jsdom from attempting navigation; runs after the grid listener (document is outermost).
    doc.addEventListener('click', (e) => e.preventDefault())
    const events = [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }].map(
      (init) => new W.MouseEvent('click', { bubbles: true, cancelable: true, ...init }),
    )
    const preventedBeforeDoc: boolean[] = []
    thumb.parentElement!.parentElement!.addEventListener('click', (e) => preventedBeforeDoc.push(e.defaultPrevented))
    for (const ev of events) thumb.dispatchEvent(ev)
    expect(forwarded).toBe(0)
    expect(preventedBeforeDoc).toEqual([false, false, false, false, false])
  })

  it('injects the list style once', () => {
    const doc = load()
    injectListStyle(doc)
    injectListStyle(doc)
    expect(doc.querySelectorAll('#bsb-list')).toHaveLength(1)
    expect(doc.getElementById('bsb-list')!.textContent).toContain('.bsb-grid')
  })

  it('passes band actions through to the per-page buttons', async () => {
    const doc = load()
    const saveSettings = vi.fn(async () => {})
    const navigate = vi.fn()
    renderList(doc, dict, DEFAULTS, { saveSettings, navigate })
    doc.querySelector<HTMLButtonElement>('.bsb-perpage button')!.click()
    await vi.waitFor(() => expect(navigate).toHaveBeenCalled())
    expect(saveSettings).toHaveBeenCalledWith({ perPage: 24 })
  })
})

/** What a page-derived panel must show: per-tag post counts on this page, desc, ties by first appearance, artist_unknown last. */
function pageExpected(html: string, type: 'artist' | 'copyright') {
  const { posts, tagTypes } = parsePosts(new JSDOM(html).window.document)
  const counts = new Map<string, number>()
  for (const p of posts) for (const t of p.tags) if (tagTypes[t] === type) counts.set(t, (counts.get(t) ?? 0) + 1)
  const rows = Array.from(counts, ([tag, count]) => ({ tag, count: String(count) }))
  const main = rows.filter((r) => r.tag !== 'artist_unknown').sort((a, b) => Number(b.count) - Number(a.count))
  return main.concat(rows.filter((r) => r.tag === 'artist_unknown'))
}

/** Rows of the site's `#tag-sidebar` read straight from the untouched fixture. */
function fixtureRows(html: string, type: string) {
  const doc = new JSDOM(html).window.document
  return Array.from(doc.querySelectorAll(`#tag-sidebar li.tag-type-${type}`)).map((li) => {
    const a = Array.from(li.querySelectorAll('a')).find((x) => (x.getAttribute('href') ?? '').includes('tags='))!
    return {
      tag: new URLSearchParams(a.getAttribute('href')!.split('?')[1]).get('tags')!,
      count: li.querySelector('.post-count')!.textContent!.trim(),
    }
  })
}

for (const file of ['post-list-2026-10-12.html', 'post-list-ja-2026-10-12.html']) {
  describe(`list page layout (${file})`, () => {
    const src = readFileSync(resolve(__dirname, '../../test/fixtures', file), 'utf8')
    const go = (patch: Partial<Settings> = {}) => {
      const doc = new JSDOM(src, { url: 'https://www.sakugabooru.com/post' }).window.document
      renderList(doc, dict, { ...DEFAULTS, ...patch })
      return doc
    }
    const panel = (doc: Document, type: string) => doc.querySelector<HTMLElement>(`.bsb-side-panel[data-type="${type}"]`)!
    const rows = (p: HTMLElement) =>
      Array.from(p.querySelectorAll<HTMLAnchorElement>('a.bsb-side-row')).map((a) => ({
        tag: a.dataset.tag!,
        count: a.querySelector('.bsb-side-count')!.textContent!,
      }))

    it('marks html.bsb-list and adds the title band', () => {
      const doc = go()
      expect(doc.documentElement.classList.contains('bsb-list')).toBe(true)
      expect(doc.querySelectorAll('.bsb-listband')).toHaveLength(1)
    })

    it('hides (keeps) the site sidebar, tag list and Hidden Posts block', () => {
      const doc = go()
      for (const id of ['tag-sidebar', 'blacklisted-sidebar', 'tags']) {
        const el = doc.getElementById(id)!
        expect(el).not.toBeNull()
        expect(el.closest('.bsb-hide')).not.toBeNull()
      }
    })

    it('builds 作画者 / 作品 / 技法 panels left of the grid', () => {
      const doc = go()
      const aside = doc.querySelector('aside.bsb-side')!
      expect(aside.nextElementSibling!.classList.contains('content')).toBe(true)
      const heads = Array.from(aside.querySelectorAll('.bsb-side-panel')).map((p) => [
        p.getAttribute('data-type'),
        p.querySelector('.bsb-side-h')!.textContent,
      ])
      expect(heads).toEqual([
        ['artist', '作画者'],
        ['copyright', '作品'],
        ['general', '技法'],
      ])
    })

    it('artist and copyright rows are counted over the posts on this page, most frequent first', () => {
      const doc = go()
      // The site's own list is its top-25 popular tags, not this page: it must NOT be the source.
      expect(fixtureRows(src, 'artist').some((r) => Number(r.count) > 40)).toBe(true)
      for (const type of ['artist', 'copyright'] as const) {
        const p = panel(doc, type)
        expect(p.dataset.source).toBe('page')
        const got = rows(p)
        expect(got).toEqual(pageExpected(src, type))
        expect(got.length).toBeGreaterThan(3)
      }
      // Every artist shown on a card is in the panel (folded rows included).
      const { tagTypes } = parsePosts(new JSDOM(src).window.document)
      const onCards = new Set(
        Array.from(doc.querySelectorAll<HTMLElement>('.bsb-card[data-tags]'))
          .flatMap((c) => c.dataset.tags!.split(' '))
          .filter((t) => tagTypes[t] === 'artist'),
      )
      const inPanel = new Set(rows(panel(doc, 'artist')).map((r) => r.tag))
      for (const t of onCards) expect(inPanel.has(t), t).toBe(true)
      // artist_unknown is a placeholder: present, but last.
      const artistTags = rows(panel(doc, 'artist')).map((r) => r.tag)
      if (artistTags.includes('artist_unknown')) expect(artistTags.at(-1)).toBe('artist_unknown')
      // kabukyuu sits only in the site's popular list, not on this page's cards: it must be gone.
      expect(panel(doc, 'artist').querySelector('a[data-tag="kabukyuu"]')).toBeNull()
      const man = panel(doc, 'artist').querySelector<HTMLElement>('a[data-tag="shuuichiro_manabe"]')!
      expect(man).not.toBeNull()
      expect(man.querySelector('.bsb-side-name')!.textContent).toBe('スタブ真鍋')
      expect(man.getAttribute('href')).toBe('/post?tags=shuuichiro_manabe')
      expect(man.classList.contains('bsb-t-artist')).toBe(true)
      const dbs = panel(doc, 'copyright').querySelector('a[data-tag="my_hero_academia"]')!
      expect(dbs.classList.contains('bsb-t-copyright')).toBe(true)
      expect(panel(doc, 'artist').querySelector('.bsb-side-h')).not.toBeNull()
      expect(panel(doc, 'artist').classList.contains('bsb-t-artist')).toBe(true)
    })

    it('untranslated rows show the raw tag with 未訳 and feed the proposal link', () => {
      const doc = go()
      const raw = panel(doc, 'artist').querySelector<HTMLElement>('a.bsb-side-raw')!
      expect(raw).not.toBeNull()
      expect(raw.querySelector('.bsb-untranslated')!.textContent).toBe('未訳')
      expect(raw.classList.contains('bsb-t-artist')).toBe(false)
      const note = doc.querySelector('.bsb-side-note')!
      expect(note.textContent).toContain('赤い「未訳」は辞書にまだ無い語です。')
      const link = note.querySelector<HTMLAnchorElement>('a')!
      expect(link.textContent).toBe('訳を提案する')
      const u = new URL(link.href)
      expect(u.origin + u.pathname).toBe('https://github.com/HTPK/better-sakugabooru/issues/new')
      expect(u.searchParams.get('template')).toBe('translation.yml')
      expect(u.searchParams.get('labels')).toBe('translation')
      const asked = u.searchParams.get('tags')!.split('\n')
      expect(asked).toContain(raw.dataset.tag)
      expect(asked.length).toBeLessThanOrEqual(20)
      expect(asked).not.toContain('kabukyuu')
    })

    it('folds artists beyond 12 behind ほか N 名, and the button reveals them', () => {
      const doc = go()
      const p = panel(doc, 'artist')
      const all = Array.from(p.querySelectorAll<HTMLElement>('a.bsb-side-row'))
      const more = p.querySelector<HTMLButtonElement>('button.bsb-side-more')
      if (all.length <= 12) {
        expect(more).toBeNull()
        return
      }
      expect(all.filter((a) => !a.hidden)).toHaveLength(12)
      expect(more!.textContent).toBe(`ほか ${all.length - 12} 名`)
      more!.click()
      expect(all.filter((a) => a.hidden)).toHaveLength(0)
      expect(more!.textContent).toBe('閉じる')
      more!.click()
      expect(all.filter((a) => !a.hidden)).toHaveLength(12)
    })

    it('hovering a panel name highlights the cards carrying that tag', () => {
      const doc = go()
      const row = panel(doc, 'copyright').querySelector<HTMLElement>('a.bsb-side-row')!
      const tag = row.dataset.tag!
      row.dispatchEvent(new doc.defaultView!.MouseEvent('mouseover', { bubbles: true }))
      const lit = Array.from(doc.querySelectorAll<HTMLElement>('.bsb-card.bsb-hl'))
      const { posts } = parsePosts(new JSDOM(src).window.document)
      expect(lit.length).toBe(posts.filter((x) => x.tags.includes(tag)).length)
      for (const c of lit) expect(c.dataset.tags!.split(' ')).toContain(tag)
      row.dispatchEvent(new doc.defaultView!.MouseEvent('mouseout', { bubbles: true }))
      expect(doc.querySelectorAll('.bsb-card.bsb-hl')).toHaveLength(0)
    })

    it('技法 chips are counted over this page’s posts, with real counts', () => {
      const doc = go()
      const p = panel(doc, 'general')
      expect(p.dataset.source).toBe('page')
      const chips = Array.from(p.querySelectorAll<HTMLAnchorElement>('a.bsb-side-chip'))
      expect(chips.length).toBeGreaterThan(0)
      const { posts } = parsePosts(new JSDOM(src).window.document)
      for (const c of chips) {
        const n = posts.filter((x) => x.tags.includes(c.dataset.tag!)).length
        expect(c.querySelector('.bsb-side-count')!.textContent).toBe(String(n))
        expect(c.classList.contains('bsb-t-general') || c.classList.contains('bsb-side-raw')).toBe(true)
      }
      const counts = chips.map((c) => Number(c.querySelector('.bsb-side-count')!.textContent))
      expect(counts).toEqual([...counts].sort((a, b) => b - a))
      expect(chips.some((c) => c.dataset.tag === 'animated')).toBe(false)
      const fx = chips.find((c) => c.dataset.tag === 'effects')
      if (fx) expect(fx.querySelector('.bsb-side-name')!.textContent).toBe('スタブ効果')
    })

    it('translates the paginator arrows to 前へ / 次へ', () => {
      const doc = go()
      expect(doc.querySelector('#paginator .previous_page')!.textContent).toBe('前へ')
      expect(doc.querySelector('#paginator .next_page')!.textContent).toBe('次へ')
    })

    it('is idempotent', () => {
      const doc = go()
      renderList(doc, dict, DEFAULTS)
      expect(doc.querySelectorAll('aside.bsb-side')).toHaveLength(1)
      expect(doc.querySelectorAll('.bsb-listband')).toHaveLength(1)
    })
  })
}

describe('sidebar panels from synthetic sidebars', () => {
  const li = (type: string, tag: string, n: number) =>
    `<li class="tag-type-${type}"><a href="/wiki/show?title=${tag}">?</a> <a href="/post?tags=${tag}">${tag}</a> <span class="post-count">${n}</span></li>`
  const page = (items: string) =>
    `<div id="content"><div id="post-list"><div class="sidebar"><div><h5>Tags</h5><ul id="tag-sidebar">${items}</ul></div></div>` +
    `<div class="content"><div><ul id="post-list-posts"></ul></div><div id="paginator"></div></div></div></div>` +
    `<script>Post.register({"id":1,"tags":"a_tag","score":1,"created_at":1,"preview_url":"p","file_url":"f","width":1,"height":1})</script>`

  it('falls back to the site’s artist rows when the page JSON has none, folding past 12', () => {
    const items = Array.from({ length: 15 }, (_, i) => li('artist', `artist_${i}`, 20 - i)).join('')
    const doc = new JSDOM(page(items), { url: 'https://www.sakugabooru.com/post' }).window.document
    renderList(doc, dict, DEFAULTS)
    const p = doc.querySelector<HTMLElement>('.bsb-side-panel[data-type="artist"]')!
    expect(p.dataset.source).toBe('sidebar')
    const all = Array.from(p.querySelectorAll<HTMLElement>('a.bsb-side-row'))
    expect(all).toHaveLength(15)
    expect(all.filter((a) => !a.hidden)).toHaveLength(12)
    expect(p.querySelector('.bsb-side-more')!.textContent).toBe('ほか 3 名')
  })

  it('falls back to the site’s general rows for 技法 chips when the page JSON has none', () => {
    const doc = new JSDOM(page(li('general', 'effects', 7) + li('general', 'smears', 3)), {
      url: 'https://www.sakugabooru.com/post',
    }).window.document
    renderList(doc, dict, DEFAULTS)
    const p = doc.querySelector<HTMLElement>('.bsb-side-panel[data-type="general"]')!
    expect(p.dataset.source).toBe('sidebar')
    const chips = Array.from(p.querySelectorAll<HTMLElement>('a.bsb-side-chip'))
    expect(chips.map((c) => [c.dataset.tag, c.querySelector('.bsb-side-count')!.textContent])).toEqual([
      ['effects', '7'],
      ['smears', '3'],
    ])
  })
})
