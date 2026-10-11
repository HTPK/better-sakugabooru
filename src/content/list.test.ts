import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { JSDOM } from 'jsdom'
import { renderList, injectListStyle } from './list'
import { DEFAULTS, type Settings } from '../settings'
import type { Dict } from '../dict'

const FIXTURE = resolve(__dirname, '../../test/fixtures/post-list-2026-10-12.html')
const HTML = readFileSync(FIXTURE, 'utf8')

// Stub entries use placeholder Japanese so tests never assert real translations.
const dict: Dict = {
  v: 1,
  updated: 'test',
  artists: { kabukyuu: { ja: 'スタブ作画者' }, shuuichiro_manabe: { ja: 'スタブ真鍋' } },
  copyrights: { dragon_ball_super: { ja: 'スタブ作品' } },
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

  it('links artists and appends romaji when showRomaji is on', () => {
    const { doc } = run()
    const a = cards(doc)[0].querySelector<HTMLAnchorElement>('.bsb-artists a')!
    expect(a.getAttribute('href')).toBe('/post?tags=shuuichiro_manabe')
    expect(a.textContent).toContain('スタブ真鍋')
    expect(a.parentElement!.querySelector('.bsb-romaji')!.textContent).toBe('shuuichiro manabe')
    const off = run({ showRomaji: false }).doc
    expect(cards(off)[0].querySelector('.bsb-artists .bsb-romaji')).toBeNull()
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

  it('injects the list style once', () => {
    const doc = load()
    injectListStyle(doc)
    injectListStyle(doc)
    expect(doc.querySelectorAll('#bsb-list')).toHaveLength(1)
    expect(doc.getElementById('bsb-list')!.textContent).toContain('.bsb-grid')
  })
})
