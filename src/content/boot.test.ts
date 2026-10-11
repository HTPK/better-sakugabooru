import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { JSDOM, VirtualConsole } from 'jsdom'
import { boot, type BootDeps } from './boot'
import { DEFAULTS, type Settings } from '../settings'
import type { Dict } from '../dict'

const fixture = (name: string) => readFileSync(resolve(__dirname, '../../test/fixtures', name), 'utf8')
const LIST = fixture('post-list-2026-10-12.html')
const SHOW = fixture('post-show-318817-2026-10-12.html')
const DICT: Dict = { v: 1, updated: 'test', artists: {}, copyrights: {}, general: {} }

function load(html: string, url = 'https://www.sakugabooru.com/post') {
  // jsdom logs "navigation not implemented" when a link is clicked; keep test output quiet.
  const dom = new JSDOM(html, { url, virtualConsole: new VirtualConsole() })
  return { doc: dom.window.document, win: dom.window as unknown as Window }
}

function deps(doc: Document, win: Window, patch: Partial<BootDeps> = {}) {
  let changeCb: ((s: Settings) => void) | null = null
  const d = {
    doc,
    win,
    loadSettings: vi.fn(async () => ({ ...DEFAULTS })),
    saveSettings: vi.fn(async () => {}),
    onSettingsChange: vi.fn((cb: (s: Settings) => void) => {
      changeCb = cb
      return () => {}
    }),
    getDict: vi.fn(async () => DICT),
    runEarly: vi.fn(() => false),
    applyTheme: vi.fn(),
    markReady: vi.fn((x: Document) => x.documentElement.classList.add('bsb-ready')),
    renderHeader: vi.fn(),
    renderList: vi.fn(() => ({ cards: 1 })),
    attachHoverPlay: vi.fn(() => () => {}),
    renderShow: vi.fn(() => true),
    attachSearch: vi.fn(() => () => {}),
    warn: vi.fn(),
    ...patch,
  } satisfies BootDeps
  return { d, change: (s: Settings) => changeCb?.(s) }
}

describe('boot', () => {
  it('stops after runEarly triggers a navigation', async () => {
    const { doc, win } = load(LIST)
    const { d } = deps(doc, win, { runEarly: vi.fn(() => true) })
    await boot(d)
    expect(d.runEarly).toHaveBeenCalledWith(DEFAULTS, win)
    for (const f of [d.applyTheme, d.getDict, d.renderHeader, d.renderList, d.renderShow, d.attachSearch, d.markReady]) {
      expect(f).not.toHaveBeenCalled()
    }
  })

  it('falls back to defaults when settings fail to load', async () => {
    const { doc, win } = load(LIST)
    const { d } = deps(doc, win, { loadSettings: vi.fn(async () => Promise.reject(new Error('x'))) })
    await boot(d)
    expect(d.runEarly).toHaveBeenCalledWith(DEFAULTS, win)
    expect(d.applyTheme).toHaveBeenCalledWith(DEFAULTS, doc)
  })

  it('renders header, list, hover and search on a list page', async () => {
    const { doc, win } = load(LIST)
    const { d } = deps(doc, win)
    await boot(d)
    expect(d.applyTheme).toHaveBeenCalledWith(DEFAULTS, doc)
    expect(d.renderHeader).toHaveBeenCalledWith(doc, DEFAULTS)
    expect(d.renderList).toHaveBeenCalledWith(doc, DICT, DEFAULTS)
    expect(d.attachHoverPlay).toHaveBeenCalledWith(doc, DEFAULTS, win)
    expect(d.renderShow).not.toHaveBeenCalled()
    expect(d.attachSearch).toHaveBeenCalledWith(doc, DICT, DEFAULTS)
    // Search goes after the header so the moved input is positioned correctly.
    const order = (f: unknown) => vi.mocked(f as () => void).mock.invocationCallOrder[0]
    expect(order(d.attachSearch)).toBeGreaterThan(order(d.renderHeader))
    expect(doc.documentElement.classList.contains('bsb-ready')).toBe(true)
  })

  it('renders the show page without list or hover', async () => {
    const { doc, win } = load(SHOW, 'https://www.sakugabooru.com/post/show/318817')
    const { d } = deps(doc, win)
    await boot(d)
    expect(d.renderShow).toHaveBeenCalledWith(doc, DICT, DEFAULTS)
    expect(d.renderList).not.toHaveBeenCalled()
    expect(d.attachHoverPlay).not.toHaveBeenCalled()
    expect(d.renderHeader).toHaveBeenCalled()
    expect(d.attachSearch).toHaveBeenCalled()
  })

  it('a throwing step is logged and the rest still runs, ending ready', async () => {
    const { doc, win } = load(LIST)
    const err = new Error('boom')
    const { d } = deps(doc, win, {
      renderList: vi.fn(() => {
        throw err
      }),
    })
    await boot(d)
    expect(d.warn).toHaveBeenCalledWith('[bsb]', 'renderList', err)
    expect(d.attachSearch).toHaveBeenCalled()
    expect(doc.documentElement.classList.contains('bsb-ready')).toBe(true)
  })

  it('still marks ready when the dictionary fails', async () => {
    const { doc, win } = load(LIST)
    const { d } = deps(doc, win, { getDict: vi.fn(async () => Promise.reject(new Error('nodict'))) })
    await boot(d)
    expect(d.markReady).toHaveBeenCalledWith(doc)
    expect(doc.documentElement.classList.contains('bsb-ready')).toBe(true)
  })

  it('waits for DOMContentLoaded while the document is loading', async () => {
    const { doc, win } = load(LIST)
    Object.defineProperty(doc, 'readyState', { value: 'loading', configurable: true })
    const { d } = deps(doc, win)
    const done = boot(d)
    await new Promise((r) => setTimeout(r, 0))
    expect(d.applyTheme).toHaveBeenCalled()
    expect(d.renderHeader).not.toHaveBeenCalled()
    doc.dispatchEvent(new (win as unknown as typeof globalThis).Event('DOMContentLoaded'))
    await done
    expect(d.renderHeader).toHaveBeenCalled()
  })

  it('front page: theme, header and ready only', async () => {
    const { doc, win } = load(fixture('front-2026-10-12.html'), 'https://www.sakugabooru.com/')
    const { d } = deps(doc, win)
    await boot({ ...d, loadSettings: vi.fn(async () => ({ ...DEFAULTS, frontToPosts: false })) })
    expect(d.applyTheme).toHaveBeenCalled()
    expect(d.renderHeader).toHaveBeenCalled()
    expect(d.renderList).not.toHaveBeenCalled()
    expect(d.renderShow).not.toHaveBeenCalled()
    expect(doc.documentElement.classList.contains('bsb-ready')).toBe(true)
  })

  it.each([
    ['en', false],
    ['ja', true],
  ])('language link locale=%s saves forceJaLocale=%s without blocking navigation', async (locale, force) => {
    const { doc, win } = load(LIST)
    const { d } = deps(doc, win, {
      renderHeader: vi.fn((x: Document) => {
        const nav = x.createElement('nav')
        nav.className = 'bsb-lang'
        nav.innerHTML = `<a href="/post?locale=${locale}"><span>X</span></a>`
        x.body.prepend(nav)
      }),
    })
    await boot(d)
    const ev = new (win as unknown as typeof globalThis).MouseEvent('click', { bubbles: true, cancelable: true })
    doc.querySelector('.bsb-lang a span')!.dispatchEvent(ev)
    expect(d.saveSettings).toHaveBeenCalledWith({ forceJaLocale: force })
    expect(ev.defaultPrevented).toBe(false)
  })

  it('re-applies the theme only when theme or webFonts change', async () => {
    const { doc, win } = load(LIST)
    const { d, change } = deps(doc, win)
    await boot(d)
    expect(d.applyTheme).toHaveBeenCalledTimes(1)
    change({ ...DEFAULTS, perPage: 60 })
    expect(d.applyTheme).toHaveBeenCalledTimes(1)
    const dark = { ...DEFAULTS, perPage: 60 as const, theme: 'dark' as const }
    change(dark)
    expect(d.applyTheme).toHaveBeenCalledTimes(2)
    expect(d.applyTheme).toHaveBeenLastCalledWith(dark, doc)
    change({ ...dark, webFonts: false })
    expect(d.applyTheme).toHaveBeenCalledTimes(3)
  })
})
