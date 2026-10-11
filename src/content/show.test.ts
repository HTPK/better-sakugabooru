import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { JSDOM } from 'jsdom'
import { renderShow } from './show'
import { DEFAULTS, type Settings } from '../settings'
import type { Dict } from '../dict'

const fixture = (name: string) => readFileSync(resolve(__dirname, '../../test/fixtures', name), 'utf8')
const SHOW = fixture('post-show-318817-2026-10-12.html')
const LIST = fixture('post-list-2026-10-12.html')

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

const load = (html = SHOW) => new JSDOM(html, { url: 'https://www.sakugabooru.com/post/show/318817' }).window.document
const run = (patch: Partial<Settings> = {}, d: Dict = dict) => {
  const doc = load()
  const res = renderShow(doc, d, { ...DEFAULTS, ...patch })
  return { doc, res }
}

describe('renderShow', () => {
  it('returns false and leaves non-show pages alone', () => {
    const doc = load(LIST)
    expect(renderShow(doc, dict, DEFAULTS)).toBe(false)
    expect(doc.querySelector('.bsb-show-band')).toBeNull()
    expect(doc.body.hasAttribute('data-bsb-show')).toBe(false)
  })

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

  it('links prev/next from the site Related Posts block', () => {
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
    const doc = load()
    const score = doc.getElementById('post-score-318817')
    renderShow(doc, dict, DEFAULTS)
    expect(doc.getElementById('post-score-318817')).toBe(score)
    expect(score!.closest('#stats')).not.toBeNull()
    const ul = doc.querySelector('#stats ul.bsb-stats')!
    const labels = Array.from(ul.querySelectorAll('.bsb-stats-label')).map((s) => s.textContent)
    expect(labels).toEqual(expect.arrayContaining(['出典', 'ID', '投稿日', 'サイズ', 'フレームレート', 'レーティング', 'スコア', 'お気に入り']))
    expect(ul.textContent).not.toMatch(/\b(Source|Posted|Score|Rating):/)
    expect(ul.textContent).toContain('854x480')
  })

  it('adds Japanese type headings to the sidebar and translates tags', () => {
    const { doc } = run()
    const heads = Array.from(doc.querySelectorAll('#tag-sidebar li.bsb-sb-head')).map((l) => l.textContent)
    expect(heads).toEqual(['作画者', '作品', '技法'])
    expect(doc.querySelector('#tag-sidebar .tag-type-artist a[href*="tags="]')!.textContent).toBe('スタブ作画者')
  })

  it('offers a propose link listing the untranslated tags', () => {
    const { doc } = run()
    const a = doc.querySelector<HTMLAnchorElement>('a.bsb-propose')!
    expect(a.target).toBe('_blank')
    expect(a.rel).toBe('noopener')
    const href = a.getAttribute('href')!
    expect(href).toMatch(/^https:\/\/github\.com\/HTPK\/sakugabooru-ja-dict\/issues\/new\?template=translation\.yml&title=/)
    const u = new URL(href)
    expect(u.searchParams.get('title')).toBe('翻訳提案: fighting, wind')
    expect(u.searchParams.get('labels')).toBe('translation')
    expect(u.searchParams.get('body')).toBe('fighting\nwind')
  })

  it('omits the propose link when everything is translated', () => {
    const full: Dict = {
      ...dict,
      general: { ...dict.general, fighting: { ja: 'スタブ格闘' }, wind: { ja: 'スタブ風' } },
    }
    const { doc } = run({}, full)
    expect(doc.querySelector('a.bsb-propose')).toBeNull()
  })

  it('is idempotent', () => {
    const doc = load()
    expect(renderShow(doc, dict, DEFAULTS)).toBe(true)
    const html = doc.body.innerHTML
    expect(renderShow(doc, dict, DEFAULTS)).toBe(false)
    expect(doc.body.innerHTML).toBe(html)
    expect(doc.querySelectorAll('.bsb-show-band')).toHaveLength(1)
    expect(doc.querySelectorAll('style#bsb-show')).toHaveLength(1)
  })
})
