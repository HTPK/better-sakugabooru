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
    expect(logo.textContent).toBe('sakugabooru')
    expect(doc.getElementById('site-title')).not.toBeNull()
    expect(doc.getElementById('bsb-header')).not.toBeNull()
  })

  it('maps top-level menu labels of either site locale to ours', () => {
    const doc = load(html, url)
    const popular = doc.querySelector('#main-menu a[href="/post/popular_recent"]')!.textContent
    renderHeader(doc, DEFAULTS)
    const top = Array.from(
      doc.querySelectorAll('#main-menu > ul > li > a:first-child, .bsb-account > li > a:first-child'),
    ).map((a) => a.textContent)
    expect(top).toEqual(expect.arrayContaining(['アカウント', '投稿', 'コメント', 'ノート', '作画者', 'タグ', 'プール', 'Wiki', 'フォーラム', 'ヘルプ']))
    for (const raw of ['Posts', 'My Account', 'Artists', 'マイアカウント', '絵師', '注釈']) expect(top).not.toContain(raw)
    // Submenu entries are left as the site served them.
    expect(doc.querySelector('#main-menu a[href="/post/popular_recent"]')!.textContent).toBe(popular)
  })

  it('fits the menu: folds extras under その他, hides 言語, keeps every original link', () => {
    const doc = load(html, url)
    const links = Array.from(doc.querySelectorAll('#header a'))
    renderHeader(doc, DEFAULTS)
    const visible = Array.from(doc.querySelectorAll('#main-menu > ul > li:not(.bsb-hide):not(.has-mail)'))
    expect(visible.map((li) => li.querySelector(':scope > a')!.textContent)).toEqual([
      '投稿', 'コメント', 'ノート', '作画者', 'タグ', 'プール', 'Wiki', 'フォーラム', 'ヘルプ', 'その他',
    ])
    // The site's language item stays in the DOM but is hidden: our JP|EN replaces it.
    const locale = doc.querySelector('#main-menu > ul > li.locale')!
    expect(locale.classList.contains('bsb-hide')).toBe(true)
    expect(visible.some((li) => /言語|Language/.test(li.textContent ?? ''))).toBe(false)
    // Blog, Patreon and More are moved (not cloned) into the その他 panel.
    const more = visible.at(-1)!
    const panel = more.querySelector(':scope > ul.submenu')!
    expect(panel.querySelector('a[href="https://patreon.com/Sakugabooru"]')).not.toBeNull()
    expect(panel.querySelector('a[href="https://blog.sakugabooru.com"]')).not.toBeNull()
    expect(panel.querySelector('a[href="/static/more"]')).not.toBeNull()
    expect(doc.querySelectorAll('a[href="https://patreon.com/Sakugabooru"]')).toHaveLength(1)
    // The account item sits at the right end, after the upload pill, with its dropdown intact.
    const end = doc.querySelector('.bsb-bar-end')!
    const account = end.lastElementChild!
    expect(account.matches('ul.bsb-account')).toBe(true)
    expect(account.querySelector('li.user > a[href="/user/home"]')!.textContent).toBe('アカウント')
    expect(account.querySelector('li.user > ul.submenu #login-link')).not.toBeNull()
    expect(account.previousElementSibling!.matches('a.bsb-upload')).toBe(true)
    // Nothing the site served was lost or duplicated.
    for (const a of links) expect(doc.contains(a)).toBe(true)
    expect(doc.querySelectorAll('#header a').length).toBe(links.length + 4) // logo, JP, EN, その他
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

describe('renderHeader in EN mode', () => {
  const run = () => {
    const doc = load(CASES[0].html, CASES[0].url)
    renderHeader(doc, DEFAULTS, 'en')
    return doc
  }
  it('keeps the site English menu labels', () => {
    const doc = run()
    const top = Array.from(
      doc.querySelectorAll('#main-menu > ul > li:not(.bsb-hide) > a:first-child, .bsb-account > li > a:first-child'),
    ).map((a) => a.textContent)
    expect(top).toEqual(expect.arrayContaining(['Posts', 'Comments', 'Notes', 'Artists', 'Tags', 'Pools', 'Wiki', 'Forum', 'Help', 'My Account', 'More']))
    expect(top.join('')).not.toMatch(/[぀-ヿ一-鿿]/)
  })
  it('uses English upload, search and aria labels', () => {
    const doc = run()
    expect(doc.querySelector('.bsb-bar a.bsb-upload')!.textContent).toBe('Upload')
    const form = doc.querySelector<HTMLFormElement>('.bsb-search-form')!
    expect(form.querySelector<HTMLInputElement>('input[type="submit"]')!.value).toBe('Search')
    expect(form.querySelector('input[name="tags"]')!.getAttribute('aria-label')).toBe('Search')
    expect(doc.querySelector('nav.bsb-lang')!.getAttribute('aria-label')).toBe('Language')
    expect(doc.querySelector('nav.bsb-lang a.bsb-current')!.textContent).toBe('EN')
    const text = Array.from(doc.querySelectorAll('.bsb-bar [placeholder], .bsb-bar [aria-label]'))
      .map((e) => `${e.getAttribute('placeholder') ?? ''}${e.getAttribute('aria-label') ?? ''}`)
      .join('')
    expect(text).not.toMatch(/[぀-ヿ一-鿿]/)
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

  it('list page: the header search box is hidden by CSS (the band has the search), not removed', () => {
    const doc = load(CASES[1].html, CASES[1].url)
    renderHeader(doc, DEFAULTS)
    expect(doc.querySelector('.bsb-bar .bsb-search-form input[name="tags"]')).not.toBeNull()
    const css = (doc.getElementById('bsb-header')!.textContent ?? '').replace(/\s+/g, ' ')
    expect(css).toMatch(/html\.bsb-list \.bsb-bar \.bsb-search-form \{ display: none;/)
    // The earlier overflow bug: the reparented menu must not stretch to the site's width: 100%.
    expect(css).toMatch(/\.bsb-bar #main-menu \{[^}]*width: auto;/)
  })

  it('does nothing without #header', () => {
    const doc = load('<html><body><p>x</p></body></html>', 'https://www.sakugabooru.com/')
    expect(() => renderHeader(doc, DEFAULTS)).not.toThrow()
    expect(doc.querySelector('.bsb-bar')).toBeNull()
  })
})
