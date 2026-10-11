import { describe, it, expect } from 'vitest'
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

// Placeholder Japanese so tests never assert real translations. `fighting` and `wind` stay untranslated.
const dict: Dict = {
  v: 1,
  updated: 'test',
  artists: { shuu_sugita: { ja: 'スタブ作画者' } },
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

describe('renderShow on a non-show page', () => {
  it('returns false and leaves the page alone', () => {
    const doc = load(LIST)
    expect(renderShow(doc, dict, DEFAULTS)).toBe(false)
    expect(doc.querySelector('.bsb-show-band')).toBeNull()
    expect(doc.body.hasAttribute('data-bsb-show')).toBe(false)
  })
})

describe('renderShow stats labels', () => {
  it('handles labels wrapped in strong/b and full-width colons', () => {
    const doc = load(CASES[0].html)
    const ul = doc.querySelector('#stats ul')!
    ul.innerHTML =
      '<li><strong>Size</strong>: 1x1</li><li><b>お気に入りにした人::</b> <span id="fav-x">a</span></li><li>レーティング：Safe</li><li>Unknown: x</li>'
    renderShow(doc, dict, DEFAULTS)
    const rows = Array.from(ul.children).map((li) => [
      li.querySelector('.bsb-stats-label')?.textContent ?? null,
      li.querySelector('.bsb-stats-value')?.textContent?.trim() ?? li.textContent,
    ])
    expect(rows).toEqual([
      ['サイズ', '1x1'],
      ['お気に入り', 'a'],
      ['レーティング', 'Safe'],
      [null, 'Unknown: x'],
    ])
    expect(doc.getElementById('fav-x')).not.toBeNull()
  })
})

describe.each(CASES)('renderShow ($name locale)', ({ html }) => {
  const run = (patch: Partial<Settings> = {}, d: Dict = dict) => {
    const doc = load(html)
    const res = renderShow(doc, d, { ...DEFAULTS, ...patch })
    return { doc, res }
  }

  it('builds the title band with copyright and artist in Japanese', () => {
    const { doc, res } = run()
    expect(res).toBe(true)
    const band = doc.querySelector('#content > section.bsb-band.bsb-show-band')!
    expect(band).not.toBeNull()
    expect(band.querySelector('h1')!.textContent).toBe('スタブ作品　スタブ作画者')
    expect(band.querySelector('.bsb-en-title')!.textContent).toBe('#318817')
  })

  it('marks untranslated title parts with 未訳', () => {
    const { doc } = run({}, { ...dict, artists: {} })
    const h1 = doc.querySelector('.bsb-show-band h1')!
    expect(h1.textContent).toContain('shuu_sugita')
    expect(h1.querySelector('.bsb-untranslated')!.textContent).toBe('未訳')
  })

  it('lead lists at most three general tags without animated', () => {
    const { doc } = run()
    const lead = doc.querySelector('.bsb-show-band .bsb-lead')!.textContent!
    const items = lead.split(' / ')
    expect(items.length).toBeGreaterThan(0)
    expect(items.length).toBeLessThanOrEqual(3)
    expect(lead).not.toContain('スタブ動画')
    expect(lead).not.toContain('animated')
  })

  it('shows untranslated lead tags with spaces instead of underscores', () => {
    const { doc } = run({}, { ...dict, general: {} })
    const lead = doc.querySelector('.bsb-show-band .bsb-lead')!.textContent!
    expect(lead).toBe('black and white / effects / fighting')
  })

  it('links prev/next from the site related-posts block', () => {
    const { doc } = run()
    const links = Array.from(doc.querySelectorAll<HTMLAnchorElement>('.bsb-show-band .bsb-show-nav a'))
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/post/show/318816', '/post/show/318818'])
    expect(links.map((a) => a.textContent)).toEqual(['前の投稿', '次の投稿'])
  })

  it('wraps the player column in main.bsb-show-main and keeps site ids', () => {
    const { doc } = run()
    const main = doc.querySelector<HTMLElement>('#post-view > main.bsb-show-main')!
    expect(main).not.toBeNull()
    expect(main.querySelector('#right-col video.video-js')).not.toBeNull()
    expect(main.querySelector('#comments')).not.toBeNull()
    expect(main.nextElementSibling?.classList.contains('sidebar')).toBe(true)
    expect(main.style.getPropertyValue('--bsb-ar')).toBe('854/480')
    for (const id of ['tag-sidebar', 'stats', 'comments', 'post-view', 'right-col']) {
      expect(doc.getElementById(id), id).not.toBeNull()
    }
    expect(doc.getElementById('bsb-show')).not.toBeNull()
  })

  it('translates stats labels in place and keeps the score span', () => {
    const doc = load(html)
    const score = doc.getElementById('post-score-318817')
    renderShow(doc, dict, DEFAULTS)
    expect(doc.getElementById('post-score-318817')).toBe(score)
    expect(score!.closest('#stats')).not.toBeNull()
    const ul = doc.querySelector('#stats ul.bsb-stats')!
    const labels = Array.from(ul.querySelectorAll('.bsb-stats-label')).map((s) => s.textContent)
    expect(labels).toEqual(['出典', 'ID', '投稿日', 'サイズ', 'フレームレート', 'レーティング', 'スコア', 'お気に入り'])
    const values = Array.from(ul.querySelectorAll('.bsb-stats-value')).map((s) => s.textContent!.trim())
    expect(values[1]).toBe('318817')
    expect(values[3]).toBe('854x480')
    for (const v of values) expect(v).not.toMatch(/^[:：]/)
    expect(ul.textContent).not.toMatch(/\b(Source|Posted|Score|Rating|Id|ID):|投稿::|お気に入りにした人/)
    expect(doc.getElementById('favorited-by')!.closest('.bsb-stats-value')).not.toBeNull()
  })

  it('groups the sidebar as 作品 / 作画者 / 技法, moving the same li nodes', () => {
    const doc = load(html)
    const before = Array.from(doc.querySelectorAll('#tag-sidebar li'))
    renderShow(doc, dict, DEFAULTS)
    const heads = Array.from(doc.querySelectorAll('#tag-sidebar li.bsb-sb-head')).map((l) => l.textContent)
    expect(heads).toEqual(['作品', '作画者', '技法'])
    const after = Array.from(doc.querySelectorAll('#tag-sidebar li:not(.bsb-sb-head)'))
    expect(new Set(after)).toEqual(new Set(before))
    const types = after.map((li) => li.className.replace(/^.*tag-type-(\w+).*$/, '$1'))
    expect(types).toEqual(['copyright', 'copyright', 'artist', ...Array(8).fill('general')])
    expect(doc.querySelector('#tag-sidebar .tag-type-artist a[href*="tags="]')!.textContent).toBe('スタブ作画者')
  })

  it('offers a propose link prefilling the issue form fields', () => {
    const { doc } = run()
    const a = doc.querySelector<HTMLAnchorElement>('a.bsb-propose')!
    expect(a.target).toBe('_blank')
    expect(a.rel).toBe('noopener')
    const href = a.getAttribute('href')!
    expect(href).toMatch(/^https:\/\/github\.com\/HTPK\/sakugabooru-ja-dict\/issues\/new\?template=translation\.yml&title=/)
    const u = new URL(href)
    expect(u.searchParams.get('title')).toBe('翻訳提案: fighting, wind')
    expect(u.searchParams.get('labels')).toBe('translation')
    expect(u.searchParams.get('tags')).toBe('fighting\nwind')
    expect(u.searchParams.get('post')).toBe(PAGE_URL)
    expect(u.searchParams.has('body')).toBe(false)
  })

  it('omits the propose link when everything is translated', () => {
    const full: Dict = {
      ...dict,
      general: { ...dict.general, fighting: { ja: 'スタブ格闘' }, wind: { ja: 'スタブ風' } },
    }
    const { doc } = run({}, full)
    expect(doc.querySelector('a.bsb-propose')).toBeNull()
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
