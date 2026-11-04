import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { JSDOM, VirtualConsole } from 'jsdom'
import { blockText, dictTagTypes, parsePoolThumbs, parseThumbTitle, poolIdOf, renderPool, renderPoolIndex, renderPoolShow } from './pool'
import { DEFAULTS, type Settings } from '../settings'
import type { Dict } from '../dict'

const fixture = (name: string) => readFileSync(resolve(__dirname, '../../test/fixtures', name), 'utf8')
const SHOW = { en: 'pool-show-133-2026-11-04.html', ja: 'pool-show-133-ja-2026-11-04.html' } as const
const INDEX = { en: 'pool-list-2026-11-04.html', ja: 'pool-list-ja-2026-11-04.html' } as const
const JP = /[぀-ヿ一-鿿]/

// Placeholder Japanese so tests never assert real translations.
const dict: Dict = {
  v: 1,
  updated: 'test',
  artists: { tadayoshi_yamamuro: { ja: 'スタブ山室' } },
  copyrights: { dragon_ball_z: { ja: 'スタブ作品' } },
  general: { effects: { ja: 'スタブ効果' } },
}

const load = (file: string, url: string) => new JSDOM(fixture(file), { url, virtualConsole: new VirtualConsole() }).window.document
const settings = (patch: Partial<Settings> = {}): Settings => ({ ...DEFAULTS, ...patch })

describe('parseThumbTitle / parsePoolThumbs (fallback when the page has no JSON)', () => {
  it('reads rating, score, tags and user from the site caption', () => {
    const m = parseThumbTitle('Rating: Safe Score: 1077 Tags: animated beams dragon_ball_z tadayoshi_yamamuro User: Ajay')!
    expect(m).toEqual({ rating: 's', score: 1077, tags: ['animated', 'beams', 'dragon_ball_z', 'tadayoshi_yamamuro'], author: 'Ajay' })
    expect(parseThumbTitle('Rating: Questionable Score: -3 Tags: x User: ')!.rating).toBe('q')
    expect(parseThumbTitle('something else')).toBeNull()
  })

  it('builds posts from the thumbnails, typed from the dictionary maps', () => {
    const doc = load(SHOW.en, 'https://www.sakugabooru.com/pool/show/133')
    const posts = parsePoolThumbs(doc.getElementById('post-list-posts')!)
    expect(posts.length).toBeGreaterThan(10)
    const first = posts.find((p) => p.id === 25197)!
    expect(first.tags).toContain('tadayoshi_yamamuro')
    expect(first.score).toBeGreaterThan(0)
    expect(first.rating).toBe('s')
    expect(first.previewUrl).toMatch(/^https:\/\/www\.sakugabooru\.com\/data\/preview\//)
    expect(first.width).toBe(300)
    expect(first.height).toBe(225)
    expect(first.fileUrl).toBe('')
    const types = dictTagTypes(dict, [{ ...first, tags: ['tadayoshi_yamamuro', 'dragon_ball_z', 'effects', 'nobody_known', '__proto__'] }])
    expect(types).toEqual({ tadayoshi_yamamuro: 'artist', dragon_ball_z: 'copyright', effects: 'general' })
  })

  it('poolIdOf reads the URL, else the Index View link', () => {
    expect(poolIdOf(load(SHOW.en, 'https://www.sakugabooru.com/pool/show/133'))).toBe('133')
    expect(poolIdOf(load(SHOW.en, 'https://www.sakugabooru.com/pool/show/133/'))).toBe('133')
    expect(poolIdOf(load(SHOW.en, 'https://www.sakugabooru.com/'))).toBe('133')
    expect(poolIdOf(load(INDEX.en, 'https://www.sakugabooru.com/pool'))).toBeNull()
  })

  it('blockText keeps <br> and block boundaries as line breaks and collapses the rest', () => {
    const doc = new JSDOM('<div id="d">line one<br>line  two<p>para <a href="x">link</a></p>  tail </div>').window.document
    expect(blockText(doc.getElementById('d')!)).toBe('line one\nline two\npara link\ntail')
  })
})

for (const lang of ['en', 'ja'] as const) {
  describe(`pool show page (${SHOW[lang]})`, () => {
    const url = 'https://www.sakugabooru.com/pool/show/133'
    const html = fixture(SHOW[lang])
    const liCount = (html.match(/<li [^>]*id="p\d+"/g) ?? []).length
    const run = (patch: Partial<Settings> = {}) => {
      const doc = load(SHOW[lang], url)
      expect(renderPoolShow(doc, dict, settings(patch), lang)).toBe(true)
      return doc
    }

    it('puts the pool name (prefix stripped), count, description and links in the band at the top of #content', () => {
      const doc = run()
      const band = doc.querySelector<HTMLElement>('.bsb-poolband')!
      expect(doc.getElementById('content')!.firstElementChild).toBe(band)
      expect(band.querySelector('h1')!.textContent).toBe('Dragon ball Z: Boo Arc Sakuga')
      expect(band.querySelector('.bsb-lead')!.textContent).toMatch(/^-Any sakuga from this era/)
      expect(band.querySelector('.bsb-pool-count')!.textContent).toBe(lang === 'ja' ? `${liCount} 件` : `${liCount} posts`)
      expect(band.querySelector('a.bsb-pool-index')!.getAttribute('href')).toBe('/post?tags=pool%3A133')
      expect(band.querySelector('a.bsb-pool-all')!.getAttribute('href')).toBe('/pool')
      if (lang === 'ja') {
        expect(band.querySelector('.bsb-en-title')!.textContent).toBe('POOL')
        expect(band.querySelector('a.bsb-pool-index')!.textContent).toBe('投稿一覧で開く (並び替え・絞り込み)')
      } else {
        expect(band.querySelector('.bsb-en-title')).toBeNull()
        expect(band.textContent).not.toMatch(JP)
      }
    })

    it('hides (keeps) the site heading and description, renders cards and our sidebar beside them', () => {
      const doc = run()
      const h4 = doc.querySelector('#pool-show > h4')!
      expect(h4.classList.contains('bsb-hide')).toBe(true)
      expect(h4.nextElementSibling!.classList.contains('bsb-hide')).toBe(true)
      const list = doc.getElementById('post-list-posts')!
      expect(list.classList.contains('bsb-hide')).toBe(true)
      expect(liCount).toBeGreaterThan(10)
      expect(doc.querySelectorAll('.bsb-grid > li.bsb-card')).toHaveLength(liCount)
      const body = doc.querySelector('.bsb-pool-body')!
      expect(Array.from(body.children).map((c) => c.className.split(' ')[0])).toEqual(['bsb-side', 'bsb-pool-content'])
      expect(body.querySelector('.bsb-pool-content .bsb-grid')).not.toBeNull()
      expect(doc.documentElement.classList.contains('bsb-list')).toBe(true)
      expect(doc.documentElement.classList.contains('bsb-pool')).toBe(true)
    })

    it('reads posts and tag types from the page JSON (Post.register_resp): file urls for hover play, site types for every tag', () => {
      const doc = run()
      const card = doc.querySelector<HTMLElement>('.bsb-card[data-post-id="25197"]')!
      expect(card.querySelector('a.bsb-thumb')!.getAttribute('data-file-url')).toMatch(/^https:\/\/www\.sakugabooru\.com\/data\/.*\.mp4$/)
      expect(card.querySelector('.bsb-artists a')!.textContent).toBe(lang === 'ja' ? 'スタブ山室' : 'tadayoshi yamamuro')
      expect(card.querySelector('.bsb-work a')!.textContent).toBe(lang === 'ja' ? 'スタブ作品' : 'dragon ball z')
      // naoki_miyahara is not in the stub dictionary: its type comes from the page JSON.
      const rows = Array.from(doc.querySelectorAll<HTMLElement>('.bsb-side-panel[data-type="artist"] a.bsb-side-row')).map((a) => a.dataset.tag)
      expect(rows).toContain('tadayoshi_yamamuro')
      expect(rows).toContain('naoki_miyahara')
    })

    it('falls back to the thumbnail captions when the page JSON is missing', () => {
      const doc = load(SHOW[lang], url)
      for (const sc of Array.from(doc.scripts)) if ((sc.textContent ?? '').includes('Post.register')) sc.remove()
      expect(renderPoolShow(doc, dict, settings(), lang)).toBe(true)
      expect(doc.querySelectorAll('.bsb-grid > li.bsb-card')).toHaveLength(liCount)
      const card = doc.querySelector<HTMLElement>('.bsb-card[data-post-id="25197"]')!
      expect(card.querySelector('a.bsb-thumb')!.hasAttribute('data-file-url')).toBe(false)
      expect(card.querySelector('.bsb-artists a')!.textContent).toBe(lang === 'ja' ? 'スタブ山室' : 'tadayoshi yamamuro')
    })

    it('claims no total when the pool is paginated', () => {
      const doc = load(SHOW[lang], url)
      const pager = doc.createElement('a')
      pager.setAttribute('href', '/pool/show/133?page=2')
      doc.getElementById('paginator')!.append(pager)
      renderPoolShow(doc, dict, settings(), lang)
      expect(doc.querySelector('.bsb-pool-count')).toBeNull()
      expect(doc.querySelector('a.bsb-pool-index')).not.toBeNull()
    })

    it('is idempotent and dispatches from renderPool', () => {
      const doc = load(SHOW[lang], url)
      expect(renderPool(doc, dict, settings(), lang)).toBe(true)
      expect(renderPool(doc, dict, settings(), lang)).toBe(false)
      expect(doc.querySelectorAll('.bsb-poolband')).toHaveLength(1)
      expect(doc.querySelectorAll('.bsb-grid')).toHaveLength(1)
    })
  })

  describe(`pool index page (${INDEX[lang]})`, () => {
    const url = 'https://www.sakugabooru.com/pool'
    const run = () => {
      const doc = load(INDEX[lang], url)
      expect(renderPoolIndex(doc, lang)).toBe(true)
      return doc
    }

    it('adds the title band with the site search form moved into it (same form, #query kept)', () => {
      const doc = run()
      const band = doc.querySelector<HTMLElement>('.bsb-poolindex')!
      expect(doc.getElementById('content')!.firstElementChild).toBe(band)
      expect(band.querySelector('h1')!.textContent).toBe(lang === 'ja' ? 'プール一覧' : 'Pools')
      const form = band.querySelector<HTMLFormElement>('form.bsb-poolsearch')!
      expect(form.getAttribute('action')).toBe('/pool')
      expect(form.getAttribute('method')).toBe('get')
      const input = form.querySelector<HTMLInputElement>('input[name="query"]')!
      expect(input.id).toBe('query')
      expect(doc.getElementById('query')).toBe(input)
      expect(input.placeholder).toBe(lang === 'ja' ? 'プール名で検索' : 'Search pools by name')
      expect(form.querySelector<HTMLInputElement>('input[type="submit"]')!.value).toBe(lang === 'ja' ? '検索' : 'Search')
      expect(doc.querySelectorAll('#pool-index form')).toHaveLength(0)
      if (lang === 'en') expect(band.textContent).not.toMatch(JP)
    })

    it('keeps every pool row and marks the table; paginator reads 前へ/次へ in Japanese', () => {
      const html = fixture(INDEX[lang])
      const doc = run()
      const table = doc.querySelector('#pool-index table.bsb-pool-table')!
      expect(table.querySelectorAll('tbody tr')).toHaveLength((html.match(/<tr class="(even|odd)"/g) ?? []).length)
      expect(table.querySelector('tbody a')!.getAttribute('href')).toMatch(/^\/pool\/show\/\d+$/)
      const prev = doc.querySelector('#paginator .previous_page')!.textContent!.trim()
      const next = doc.querySelector('#paginator .next_page')!.textContent!.trim()
      expect([prev, next]).toEqual(lang === 'ja' ? ['前へ', '次へ'] : ['← Previous', 'Next →'])
    })

    it('is idempotent', () => {
      const doc = run()
      expect(renderPoolIndex(doc, lang)).toBe(false)
      expect(doc.querySelectorAll('.bsb-poolindex')).toHaveLength(1)
    })
  })
}

describe('pool pages without the expected markup', () => {
  it('renderPool is false on a post list page', () => {
    const doc = load('post-list-2026-10-12.html', 'https://www.sakugabooru.com/post')
    expect(renderPool(doc, dict, settings(), 'ja')).toBe(false)
    expect(doc.querySelector('.bsb-poolband')).toBeNull()
  })
})
