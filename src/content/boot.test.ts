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
const LIST_JA = fixture('post-list-ja-2026-10-12.html')
const SHOW_JA = fixture('post-show-318817-ja-2026-10-12.html')
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
    const { doc, win } = load(LIST_JA)
    const { d } = deps(doc, win)
    await boot(d)
    expect(d.applyTheme).toHaveBeenCalledWith(DEFAULTS, doc)
    expect(d.renderHeader).toHaveBeenCalledWith(doc, DEFAULTS, 'ja')
    expect(d.renderList).toHaveBeenCalledWith(
      doc,
      DICT,
      DEFAULTS,
      { saveSettings: d.saveSettings, navigate: expect.any(Function) },
      'ja',
    )
    expect(d.attachHoverPlay).toHaveBeenCalledWith(doc, DEFAULTS, win)
    expect(d.renderShow).not.toHaveBeenCalled()
    expect(d.attachSearch).toHaveBeenCalledWith(doc, DICT, DEFAULTS, 'ja')
    // Search goes after the header so the moved input is positioned correctly.
    const order = (f: unknown) => vi.mocked(f as () => void).mock.invocationCallOrder[0]
    expect(order(d.attachSearch)).toBeGreaterThan(order(d.renderHeader))
    // ...and after the list, whose band adds the search input autocomplete must attach to.
    expect(order(d.attachSearch)).toBeGreaterThan(order(d.renderList))
    expect(doc.documentElement.classList.contains('bsb-ready')).toBe(true)
  })

  it('hands the list band the injected navigate and saveSettings', async () => {
    const { doc, win } = load(LIST)
    const navigate = vi.fn()
    const renderList = vi.fn((_d: Document, _x: Dict, _s: Settings, a: { navigate: (u: string) => void }) => {
      a.navigate('/post?limit=60')
    })
    const { d } = deps(doc, win, { navigate, renderList })
    await boot(d)
    expect(navigate).toHaveBeenCalledWith('/post?limit=60')
  })

  it('renders the show page without list or hover', async () => {
    const { doc, win } = load(SHOW_JA, 'https://www.sakugabooru.com/post/show/318817')
    const { d } = deps(doc, win)
    await boot(d)
    expect(d.renderShow).toHaveBeenCalledWith(doc, DICT, DEFAULTS, 'ja')
    expect(d.renderList).not.toHaveBeenCalled()
    expect(d.attachHoverPlay).not.toHaveBeenCalled()
    expect(d.renderHeader).toHaveBeenCalled()
    expect(d.attachSearch).toHaveBeenCalled()
  })

  it("passes 'en' to every renderer when the site is served in English", async () => {
    const { doc, win } = load(LIST)
    doc.documentElement.setAttribute('lang', 'en')
    const { d } = deps(doc, win)
    await boot(d)
    expect(d.renderHeader).toHaveBeenCalledWith(doc, DEFAULTS, 'en')
    expect(vi.mocked(d.renderList).mock.calls[0][4]).toBe('en')
    expect(d.attachSearch).toHaveBeenCalledWith(doc, DICT, DEFAULTS, 'en')
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

  const langDeps = (locale: string, save = vi.fn(async () => {})) => {
    const { doc, win } = load(LIST)
    const navigate = vi.fn()
    const { d } = deps(doc, win, {
      saveSettings: save,
      navigate,
      renderHeader: vi.fn((x: Document) => {
        const nav = x.createElement('nav')
        nav.className = 'bsb-lang'
        nav.innerHTML = `<a href="/post?locale=${locale}"><span>X</span></a>`
        x.body.prepend(nav)
      }),
    })
    return { doc, win, d, navigate }
  }
  const click = (win: Window, init: MouseEventInit = {}) =>
    new (win as unknown as typeof globalThis).MouseEvent('click', { bubbles: true, cancelable: true, ...init })
  const flush = () => new Promise((r) => setTimeout(r, 0))

  it.each([
    ['en', false],
    ['ja', true],
  ])('our language link locale=%s saves forceJaLocale=%s before navigating', async (locale, force) => {
    let resolveSave = () => {}
    const save = vi.fn(() => new Promise<void>((r) => (resolveSave = r)))
    const { doc, win, d, navigate } = langDeps(locale, save)
    await boot(d)
    const ev = click(win)
    doc.querySelector('.bsb-lang a span')!.dispatchEvent(ev)
    expect(d.saveSettings).toHaveBeenCalledWith({ forceJaLocale: force })
    expect(ev.defaultPrevented).toBe(true)
    await flush()
    expect(navigate).not.toHaveBeenCalled()
    resolveSave()
    await flush()
    expect(navigate).toHaveBeenCalledWith(`https://www.sakugabooru.com/post?locale=${locale}`)
  })

  it("handles the site's own li.locale links too", async () => {
    const { doc, win, d, navigate } = langDeps('en')
    await boot(d)
    const a = doc.querySelector<HTMLAnchorElement>('li.locale a[href*="locale=ja"]')!
    const ev = click(win)
    a.dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(true)
    expect(d.saveSettings).toHaveBeenCalledWith({ forceJaLocale: true })
    await flush()
    expect(navigate).toHaveBeenCalledWith('https://www.sakugabooru.com/post?locale=ja')
  })

  it('still navigates when saving fails', async () => {
    const { doc, win, d, navigate } = langDeps('ja', vi.fn(async () => Promise.reject(new Error('x'))))
    await boot(d)
    doc.querySelector('.bsb-lang a')!.dispatchEvent(click(win))
    await flush()
    expect(navigate).toHaveBeenCalledOnce()
    expect(d.warn).toHaveBeenCalledWith('[bsb]', 'saveSettings', expect.any(Error))
  })

  it('modified clicks only save and keep the default (new tab)', async () => {
    const { doc, win, d, navigate } = langDeps('ja')
    await boot(d)
    // Stop jsdom navigation after our capture listener has looked at the event.
    doc.addEventListener('click', (e) => e.defaultPrevented || e.preventDefault())
    const a = doc.querySelector('.bsb-lang a')!
    const seen: boolean[] = []
    // At-target listeners run after the document capture listener.
    a.addEventListener('click', (e) => seen.push(e.defaultPrevented))
    for (const init of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { button: 1 }]) a.dispatchEvent(click(win, init))
    await flush()
    expect(seen).toEqual([false, false, false, false])
    expect(d.saveSettings).toHaveBeenCalledTimes(4)
    expect(navigate).not.toHaveBeenCalled()
  })

  it('ignores links without a ja/en locale', async () => {
    const { doc, win, d, navigate } = langDeps('fr')
    await boot(d)
    doc.addEventListener('click', (e) => e.preventDefault())
    const ev = click(win)
    doc.querySelector('.bsb-lang a')!.dispatchEvent(ev)
    expect(d.saveSettings).not.toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()
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
