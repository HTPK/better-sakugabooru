import { describe, it, expect } from 'vitest'
import { JSDOM } from 'jsdom'
import { detectLang, uiLang, spaced, STRINGS } from './i18n'

function page(labels: string[], htmlLang?: string): Document {
  const lis = labels.map((l) => `<li><a href="#">${l}</a><ul><li><a href="#">sub</a></li></ul></li>`).join('')
  const menu = labels.length ? `<div id="main-menu"><ul>${lis}</ul></div>` : ''
  const attr = htmlLang ? ` lang="${htmlLang}"` : ''
  return new JSDOM(`<!doctype html><html${attr}><body>${menu}</body></html>`).window.document
}

describe('detectLang', () => {
  it('trusts html[lang]', () => {
    expect(detectLang(page(['Posts'], 'ja'))).toBe('ja')
    expect(detectLang(page(['投稿'], 'en'))).toBe('en')
  })
  it('votes on menu labels when html[lang] is absent', () => {
    expect(detectLang(page(['Posts', 'Comments', 'Wiki', 'Patreon']))).toBe('en')
    expect(detectLang(page(['投稿', 'コメント', 'Wiki', 'Patreon']))).toBe('ja')
  })
  it('defaults to en without a menu', () => {
    expect(detectLang(page([]))).toBe('en')
  })
  it('falls back to the locale cookie without html[lang] and menu', () => {
    const doc = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://www.sakugabooru.com/' }).window.document
    expect(detectLang(doc)).toBe('en')
    doc.cookie = 'locale=ja'
    expect(detectLang(doc)).toBe('ja')
    doc.cookie = 'locale=en'
    expect(detectLang(doc)).toBe('en')
  })
  it('html[lang] and menu still win over the cookie', () => {
    const doc = new JSDOM('<!doctype html><html lang="en"><body></body></html>', { url: 'https://www.sakugabooru.com/' }).window.document
    doc.cookie = 'locale=ja'
    expect(detectLang(doc)).toBe('en')
  })
})

describe('uiLang', () => {
  it('is ja only for ja*', () => {
    expect(uiLang('ja-JP')).toBe('ja')
    expect(uiLang('JA')).toBe('ja')
    expect(uiLang('en-US')).toBe('en')
    expect(uiLang(undefined)).toBe('en')
  })
})

describe('STRINGS', () => {
  it('has the same keys in ja and en', () => {
    expect(Object.keys(STRINGS.en).sort()).toEqual(Object.keys(STRINGS.ja).sort())
  })
  it('has no Japanese characters in en', () => {
    const bad: string[] = []
    for (const [k, v] of Object.entries(STRINGS.en)) {
      const sample = typeof v === 'function' ? (v as (...a: unknown[]) => string)(3, '2026/01/01') : v
      if (/[　぀-ヿ一-鿿]/.test(String(sample))) bad.push(k)
    }
    expect(bad).toEqual([])
  })
  it('formats parameterised entries', () => {
    expect(STRINGS.en.more(3)).toBe('+3 more')
    expect(STRINGS.en.removeChip('a b')).toBe('Remove a b')
  })
})

describe('spaced', () => {
  it('replaces underscores', () => {
    expect(spaced('a_b_c')).toBe('a b c')
  })
})
