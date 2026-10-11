import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { JSDOM } from 'jsdom'
import { translateSidebar } from './list'
import { DEFAULTS } from '../settings'
import type { Dict } from '../dict'

const fixture = (name: string) => readFileSync(resolve(__dirname, '../../test/fixtures', name), 'utf8')
const dict: Dict = { v: 1, updated: 'test', artists: {}, copyrights: {}, general: {} }
const load = (html: string) => new JSDOM(html, { url: 'https://www.sakugabooru.com/post' }).window.document
const heads = (doc: Document) => Array.from(doc.querySelectorAll('.sidebar h5')).map((h) => (h.textContent ?? '').replace(/\s+/g, ' ').trim())

const CASES = [
  { name: 'list en', file: 'post-list-2026-10-12.html', expect: ['タグ', '非表示の投稿'] },
  { name: 'list ja', file: 'post-list-ja-2026-10-12.html', expect: ['タグ', '非表示の投稿', '検索'] },
  { name: 'show en', file: 'post-show-318817-2026-10-12.html', expect: ['タグ', '検索', '関連する投稿'] },
  { name: 'show ja', file: 'post-show-318817-ja-2026-10-12.html', expect: ['タグ', '検索', '関連する投稿'] },
]

describe('translateSidebar headings', () => {
  for (const c of CASES) {
    it(`${c.name}: translates English headings, idempotent`, () => {
      const doc = load(fixture(c.file))
      translateSidebar(doc, dict, DEFAULTS)
      const once = heads(doc)
      for (const e of c.expect) expect(once.some((t) => t.startsWith(e))).toBe(true)
      for (const en of ['Tags', 'Hidden Posts', 'Search', 'Related Posts', 'Statistics', 'Options', 'History']) {
        expect(once).not.toContain(en)
      }
      translateSidebar(doc, dict, DEFAULTS)
      expect(heads(doc)).toEqual(once)
    })
  }

  it('keeps the Hidden Posts count span and link intact', () => {
    const doc = load(fixture('post-list-ja-2026-10-12.html'))
    translateSidebar(doc, dict, DEFAULTS)
    const h5 = Array.from(doc.querySelectorAll('.sidebar h5')).find((h) => h.querySelector('#blacklist-count'))!
    expect(h5.querySelector('a')?.textContent).toBe('非表示の投稿')
    expect(h5.querySelector('#blacklist-count')).not.toBeNull()
  })

  it('leaves unknown headings alone', () => {
    const doc = load('<div class="sidebar"><h5>関連するタグ</h5><h5>Whatever</h5></div>')
    translateSidebar(doc, dict, DEFAULTS)
    expect(heads(doc)).toEqual(['関連するタグ', 'Whatever'])
  })
})
