import { describe, it, expect, beforeEach, vi } from 'vitest'
import html from './index.html?raw'
import { initPopup, type PopupDeps } from './main'
import { DEFAULTS, type Settings } from '../settings'
import snapshot from '../dict/snapshot.json'

const flush = () => new Promise((r) => setTimeout(r, 0))
const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel)!
const box = (key: string) => $<HTMLInputElement>(`input[data-key="${key}"]`)
const seg = (key: string, value: string) => $<HTMLButtonElement>(`[data-seg="${key}"] button[data-value="${value}"]`)

function mount(): void {
  const parsed = new DOMParser().parseFromString(html, 'text/html')
  parsed.querySelectorAll('script').forEach((s) => s.remove())
  document.documentElement.removeAttribute('data-bsb-theme')
  document.body.innerHTML = parsed.body.innerHTML
}

function deps(over: Partial<PopupDeps> = {}, settings: Partial<Settings> = {}, storage: Record<string, unknown> = {}) {
  const save = vi.fn(async (_p: Partial<Settings>) => {})
  const sendMessage = vi.fn(async (_m: unknown): Promise<unknown> => ({ ok: true }))
  const d: PopupDeps = {
    load: async () => ({ ...DEFAULTS, ...settings }),
    save,
    sendMessage,
    getStorage: async () => storage,
    uiLanguage: 'ja-JP',
    ...over,
  }
  return { d, save: (over.save as typeof save) ?? save, sendMessage: (over.sendMessage as typeof sendMessage) ?? sendMessage }
}

const stubDict = {
  v: 1,
  updated: '2026-09-30',
  artists: { a: { ja: 'あ' }, b: { ja: 'い' } },
  copyrights: { c: { ja: 'う' } },
  general: { d: { ja: 'え' }, e: { ja: 'お' }, f: { ja: 'か' } },
}

beforeEach(mount)

describe('popup', () => {
  it('reflects loaded settings and applies the theme', async () => {
    const { d } = deps({}, { theme: 'dark', hoverPlay: false, perPage: 60, thumbSize: 'large', techLimit: 4 })
    await initPopup(document, d)
    expect(box('translateTags').checked).toBe(true)
    expect(box('hoverPlay').checked).toBe(false)
    expect(seg('theme', 'dark').getAttribute('aria-pressed')).toBe('true')
    expect(seg('theme', 'light').getAttribute('aria-pressed')).toBe('false')
    expect(seg('perPage', '60').getAttribute('aria-pressed')).toBe('true')
    expect(seg('thumbSize', 'large').getAttribute('aria-pressed')).toBe('true')
    expect($('#pp-tech-value').textContent).toBe('4')
    expect(document.documentElement.getAttribute('data-bsb-theme')).toBe('dark')
  })

  it('clicking ダーク saves only the theme and re-applies it', async () => {
    const { d, save } = deps({}, { theme: 'light' })
    await initPopup(document, d)
    expect(document.documentElement.getAttribute('data-bsb-theme')).toBe('light')
    seg('theme', 'dark').click()
    expect(save).toHaveBeenCalledWith({ theme: 'dark' })
    expect(seg('theme', 'dark').getAttribute('aria-pressed')).toBe('true')
    expect(seg('theme', 'light').getAttribute('aria-pressed')).toBe('false')
    expect(document.documentElement.getAttribute('data-bsb-theme')).toBe('dark')
  })

  it('checking a box saves the single key', async () => {
    const { d, save } = deps({}, { showRomaji: false })
    await initPopup(document, d)
    box('showRomaji').click()
    expect(save).toHaveBeenCalledWith({ showRomaji: true })
    box('webFonts').click()
    expect(save).toHaveBeenLastCalledWith({ webFonts: false })
  })

  it('perPage and thumbSize buttons save typed values', async () => {
    const { d, save } = deps()
    await initPopup(document, d)
    seg('perPage', '60').click()
    expect(save).toHaveBeenCalledWith({ perPage: 60 })
    seg('thumbSize', 'small').click()
    expect(save).toHaveBeenLastCalledWith({ thumbSize: 'small' })
  })

  it('stepper clamps to 0..5 and saves techLimit', async () => {
    const { d, save } = deps({}, { techLimit: 2 })
    await initPopup(document, d)
    $<HTMLButtonElement>('#pp-tech-inc').click()
    expect(save).toHaveBeenCalledWith({ techLimit: 3 })
    expect($('#pp-tech-value').textContent).toBe('3')
    expect(box('showTech').checked).toBe(true)

    mount()
    const at5 = deps({}, { techLimit: 5 })
    await initPopup(document, at5.d)
    expect($<HTMLButtonElement>('#pp-tech-inc').disabled).toBe(true)
    expect($<HTMLButtonElement>('#pp-tech-dec').disabled).toBe(false)

    mount()
    const at0 = deps({}, { techLimit: 0 })
    await initPopup(document, at0.d)
    expect($<HTMLButtonElement>('#pp-tech-dec').disabled).toBe(true)
  })

  it('footer shows the snapshot count and [未取得] with empty storage', async () => {
    const { d } = deps()
    await initPopup(document, d)
    const n =
      Object.keys(snapshot.artists).length + Object.keys(snapshot.copyrights).length + Object.keys(snapshot.general).length
    expect($('#pp-dict-count').textContent).toBe(n.toLocaleString('ja-JP'))
    expect($('#pp-dict-date').textContent).toBe('[未取得]')
    expect($('#pp-dict-error').hidden).toBe(true)
  })

  it('footer shows the stored dict count, date and last error', async () => {
    const { d } = deps({}, {}, { dict: stubDict, dictFetchedAt: 0, dictLastError: 'HTTP 503' })
    await initPopup(document, d)
    expect($('#pp-dict-count').textContent).toBe('6')
    expect($('#pp-dict-date').textContent).toBe('2026/09/30')
    expect($('#pp-dict-error').hidden).toBe(false)
    expect($('#pp-dict-error').textContent).toBe('HTTP 503')
  })

  it('footer falls back to dictFetchedAt for the date', async () => {
    const at = new Date(2026, 9, 5, 12).getTime()
    const { d } = deps({}, {}, { dictFetchedAt: at })
    await initPopup(document, d)
    expect($('#pp-dict-date').textContent).toBe('2026/10/05')
  })

  it('今すぐ更新 sends bsb:refresh-now and shows the error', async () => {
    let resolve!: (v: unknown) => void
    const sendMessage = vi.fn(() => new Promise<unknown>((r) => (resolve = r)))
    const { d } = deps({ sendMessage })
    await initPopup(document, d)
    const btn = $<HTMLButtonElement>('#pp-refresh')
    btn.click()
    expect(sendMessage).toHaveBeenCalledWith({ type: 'bsb:refresh-now' })
    expect(btn.textContent).toBe('更新中…')
    expect(btn.disabled).toBe(true)
    resolve({ ok: false, error: 'x' })
    await flush()
    await flush()
    expect(btn.textContent).toBe('今すぐ更新')
    expect(btn.disabled).toBe(false)
    expect($('#pp-dict-error').hidden).toBe(false)
    expect($('#pp-dict-error').textContent).toBe('x')
  })

  it('今すぐ更新 success re-reads storage into the footer', async () => {
    const storage: Record<string, unknown> = {}
    const { d } = deps({ getStorage: async () => storage, sendMessage: async () => {
      storage.dict = stubDict
      return { ok: true }
    } })
    await initPopup(document, d)
    expect($('#pp-dict-date').textContent).toBe('[未取得]')
    $<HTMLButtonElement>('#pp-refresh').click()
    await flush()
    await flush()
    expect($('#pp-dict-count').textContent).toBe('6')
    expect($('#pp-dict-date').textContent).toBe('2026/09/30')
  })

  it('en UI language translates every visible string', async () => {
    const { d } = deps()
    await initPopup(document, { ...d, uiLanguage: 'en-US' })
    expect(document.documentElement.getAttribute('lang')).toBe('en')
    expect($('.pp-sub').textContent).toBe('Settings')
    expect(Array.from(document.querySelectorAll('[data-seg="theme"] button')).map((b) => b.textContent)).toEqual([
      'Light',
      'Dark',
      'Follow OS',
    ])
    expect($('#pp-refresh').textContent).toBe('Refresh now')
    expect($('[data-seg="thumbSize"] button[data-value="small"]').textContent).toBe('Small 8 cols')
    const n =
      Object.keys(snapshot.artists).length + Object.keys(snapshot.copyrights).length + Object.keys(snapshot.general).length
    expect($('#pp-dict-count').textContent).toBe(n.toLocaleString('en-US'))
    expect($('#pp-dict-date').textContent).toBe('[not fetched]')
    expect($('#pp-tech-dec').getAttribute('aria-label')).toBe('Fewer')
    const jp = /[　぀-ヿ一-鿿]/
    const bad = Array.from(document.querySelectorAll('.pp *'))
      .flatMap((el) => [
        ...Array.from(el.childNodes).filter((c) => c.nodeType === 3).map((c) => c.textContent ?? ''),
        ...Array.from(el.attributes).map((a) => a.value),
      ])
      .filter((t) => jp.test(t))
    expect(bad).toEqual([])
  })

  it('en refresh button shows English progress text', async () => {
    const { d } = deps({ sendMessage: async () => ({ ok: false }) })
    await initPopup(document, { ...d, uiLanguage: 'en' })
    const btn = $<HTMLButtonElement>('#pp-refresh')
    btn.click()
    expect(btn.textContent).toBe('Refreshing…')
    await flush()
    await flush()
    expect($('#pp-dict-error').textContent).toBe('Refresh failed')
    expect(btn.textContent).toBe('Refresh now')
  })

  it('ja UI language leaves the HTML text unchanged', async () => {
    const before = document.body.innerHTML
    const { d } = deps()
    await initPopup(document, { ...d, uiLanguage: 'ja-JP' })
    expect(document.documentElement.getAttribute('lang')).toBe('ja')
    expect($('.pp-sub').textContent).toBe('設定')
    expect($('[data-seg="thumbSize"] button[data-value="small"]').textContent).toBe('小 8列')
    expect($('.pp-dict > span').textContent).toBe('辞書 ' + $('#pp-dict-count').textContent + ' 語　更新 [未取得]')
    expect(before).toContain('data-i18n')
  })

  it('suggestion link opens the dict repo issue form in a new tab', () => {
    const a = $<HTMLAnchorElement>('.pp-link')
    expect(a.textContent).toBe('訳を提案')
    expect(a.getAttribute('href')).toBe('https://github.com/HTPK/better-sakugabooru/issues/new?template=translation.yml')
    expect(a.target).toBe('_blank')
    expect(a.rel).toBe('noopener')
  })
})
