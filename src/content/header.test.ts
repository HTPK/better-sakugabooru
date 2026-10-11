import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { JSDOM } from 'jsdom'
import { renderHeader } from './header'
import { DEFAULTS } from '../settings'

const fixture = (name: string) => readFileSync(resolve(__dirname, '../../test/fixtures', name), 'utf8')
const CASES = [
  {
    name: 'post-list (en)',
    html: fixture('post-list-2026-10-12.html'),
    url: 'https://www.sakugabooru.com/post?tags=effects&page=2',
    served: 'EN',
  },
  {
    name: 'post-list (ja)',
    html: fixture('post-list-ja-2026-10-12.html'),
    url: 'https://www.sakugabooru.com/post?tags=effects&page=2',
    served: 'JP',
  },
  {
    name: 'post-show (en)',
    html: fixture('post-show-318817-2026-10-12.html'),
    url: 'https://www.sakugabooru.com/post/show/318817?locale=en',
    served: 'EN',
  },
  {
    name: 'post-show (ja)',
    html: fixture('post-show-318817-ja-2026-10-12.html'),
    url: 'https://www.sakugabooru.com/post/show/318817',
    served: 'JP',
  },
]

const load = (html: string, url: string) => new JSDOM(html, { url }).window.document

describe.each(CASES)('renderHeader on $name', ({ html, url, served }) => {
  it('builds the bar and reparents the site menu (same node)', () => {
    const doc = load(html, url)
    const menu = doc.getElementById('main-menu')
    renderHeader(doc, DEFAULTS)
    const header = doc.getElementById('header')!
    expect(header.classList.contains('bsb-header')).toBe(true)
    const bar = header.querySelector('.bsb-bar')!
    expect(bar).not.toBeNull()
    expect(doc.getElementById('main-menu')).toBe(menu)
    expect(bar.contains(menu)).toBe(true)
    const logo = bar.querySelector<HTMLAnchorElement>('a.bsb-logo')!
    expect(logo.getAttribute('href')).toBe('/post')
    expect(logo.textContent).toBe('Sakugabooru')
    expect(doc.getElementById('site-title')).not.toBeNull()
    expect(doc.getElementById('bsb-header')).not.toBeNull()
  })

  it('maps top-level menu labels of either site locale to ours', () => {
    const doc = load(html, url)
    const popular = doc.querySelector('#main-menu a[href="/post/popular_recent"]')!.textContent
    renderHeader(doc, DEFAULTS)
    const top = Array.from(doc.querySelectorAll('#main-menu > ul > li > a:first-child')).map((a) => a.textContent)
    expect(top).toEqual(expect.arrayContaining(['アカウント', '投稿', 'コメント', 'ノート', '作画者', 'タグ', 'プール', 'Wiki', 'フォーラム', 'ヘルプ']))
    for (const raw of ['Posts', 'My Account', 'Artists', 'マイアカウント', '絵師', '注釈']) expect(top).not.toContain(raw)
    // Submenu entries are left as the site served them.
    expect(doc.querySelector('#main-menu a[href="/post/popular_recent"]')!.textContent).toBe(popular)
  })

  it('moves the header search form into the bar', () => {
    const doc = load(html, url)
    renderHeader(doc, DEFAULTS)
    const form = doc.querySelector<HTMLFormElement>('.bsb-bar form.bsb-search-form')!
    expect(form).not.toBeNull()
    expect(form.getAttribute('action')).toBe('/post')
    expect(form.querySelector('input[name="tags"]')).not.toBeNull()
    const submit = form.querySelector<HTMLInputElement>('input[type="submit"]')!
    expect(submit.value).toBe('検索')
    expect(submit.getAttribute('data-disable-with')).toBe('検索')
  })

  it('pulls the upload link out as a red pill', () => {
    const doc = load(html, url)
    renderHeader(doc, DEFAULTS)
    const up = doc.querySelector<HTMLAnchorElement>('.bsb-bar a.bsb-upload')!
    expect(up).not.toBeNull()
    expect(up.classList.contains('bsb-pill')).toBe(true)
    expect(up.getAttribute('href')).toBe('/post/upload')
    expect(up.textContent).toBe('動画を投稿')
  })

  it('adds a JP | EN switch that preserves other params', () => {
    const doc = load(html, url)
    renderHeader(doc, DEFAULTS)
    const links = Array.from(doc.querySelectorAll<HTMLAnchorElement>('nav.bsb-lang a'))
    expect(links.map((a) => a.textContent)).toEqual(['JP', 'EN'])
    const [ja, en] = links.map((a) => new URL(a.getAttribute('href')!, url))
    const orig = new URL(url)
    expect(ja.searchParams.get('locale')).toBe('ja')
    expect(en.searchParams.get('locale')).toBe('en')
    for (const u of [ja, en]) {
      expect(u.pathname).toBe(orig.pathname)
      for (const [k, v] of orig.searchParams) if (k !== 'locale') expect(u.searchParams.get(k)).toBe(v)
    }
    expect(links.filter((a) => a.classList.contains('bsb-current')).map((a) => a.textContent)).toEqual([served])
  })

  it('is idempotent', () => {
    const doc = load(html, url)
    renderHeader(doc, DEFAULTS)
    const once = doc.getElementById('header')!.innerHTML
    renderHeader(doc, DEFAULTS)
    expect(doc.getElementById('header')!.innerHTML).toBe(once)
    expect(doc.querySelectorAll('.bsb-bar')).toHaveLength(1)
    expect(doc.querySelectorAll('style#bsb-header')).toHaveLength(1)
  })
})

describe('renderHeader on a Japanese page', () => {
  it('trusts html lang=ja for the current-language marker', () => {
    const doc = load(CASES[0].html, CASES[0].url)
    doc.documentElement.setAttribute('lang', 'ja')
    renderHeader(doc, DEFAULTS)
    expect(doc.querySelector('#main-menu > ul > li.post > a')!.textContent).toBe('投稿')
    expect(doc.querySelector('nav.bsb-lang a.bsb-current')!.textContent).toBe('JP')
  })

  it('does nothing without #header', () => {
    const doc = load('<html><body><p>x</p></body></html>', 'https://www.sakugabooru.com/')
    expect(() => renderHeader(doc, DEFAULTS)).not.toThrow()
    expect(doc.querySelector('.bsb-bar')).toBeNull()
  })
})
