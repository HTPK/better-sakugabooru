import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DEFAULTS, type Settings } from '../settings'
import { applyTheme, markReady, resolveTheme } from './theme'

type MqlListener = (e: { matches: boolean }) => void

function fakeMatchMedia(initial: boolean) {
  const listeners: MqlListener[] = []
  const mql = {
    matches: initial,
    media: '(prefers-color-scheme: dark)',
    addEventListener: (_t: string, l: MqlListener) => void listeners.push(l),
    removeEventListener: (_t: string, l: MqlListener) => {
      const i = listeners.indexOf(l)
      if (i >= 0) listeners.splice(i, 1)
    },
  }
  const set = (v: boolean) => {
    mql.matches = v
    for (const l of [...listeners]) l({ matches: v })
  }
  return { fn: vi.fn(() => mql), set, listeners }
}

const s = (patch: Partial<Settings> = {}): Settings => ({ ...DEFAULTS, ...patch })

beforeEach(() => {
  document.head.innerHTML = ''
  document.documentElement.removeAttribute('data-bsb-theme')
  document.documentElement.className = ''
  window.matchMedia = fakeMatchMedia(false).fn as unknown as typeof window.matchMedia
})

describe('resolveTheme', () => {
  it.each([
    ['light', false, 'light'],
    ['light', true, 'light'],
    ['dark', false, 'dark'],
    ['dark', true, 'dark'],
    ['system', false, 'light'],
    ['system', true, 'dark'],
  ] as const)('%s + prefersDark=%s -> %s', (setting, dark, want) => {
    expect(resolveTheme(setting, dark)).toBe(want)
  })
})

describe('applyTheme', () => {
  it('sets the theme attribute', () => {
    applyTheme(s({ theme: 'dark' }))
    expect(document.documentElement.getAttribute('data-bsb-theme')).toBe('dark')
    applyTheme(s({ theme: 'light' }))
    expect(document.documentElement.getAttribute('data-bsb-theme')).toBe('light')
  })

  it('injects the three stylesheets once', () => {
    applyTheme(s())
    applyTheme(s())
    for (const id of ['bsb-tokens', 'bsb-site', 'bsb-fonts']) {
      expect(document.querySelectorAll(`style#${id}`)).toHaveLength(1)
    }
    expect(document.getElementById('bsb-tokens')!.textContent).toContain('--bsb-red:#DC000C')
  })

  it('points the font face at the extension URL', () => {
    applyTheme(s())
    const css = document.getElementById('bsb-fonts')!.textContent!
    expect(css).toContain('chrome-extension://test/fonts/Jost-VF.woff2')
    expect(css).not.toContain('__FONT_BASE__')
  })

  it('toggles the Google Fonts link with webFonts', () => {
    applyTheme(s({ webFonts: true }))
    applyTheme(s({ webFonts: true }))
    const links = document.querySelectorAll<HTMLLinkElement>('link#bsb-gfonts')
    expect(links).toHaveLength(1)
    expect(links[0].href).toBe('https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;700&display=swap')
    expect(links[0].rel).toBe('stylesheet')
    applyTheme(s({ webFonts: false }))
    expect(document.getElementById('bsb-gfonts')).toBeNull()
  })

  it('follows system changes when theme is system, and stops when switched away', () => {
    const mm = fakeMatchMedia(false)
    window.matchMedia = mm.fn as unknown as typeof window.matchMedia
    applyTheme(s({ theme: 'system' }))
    expect(document.documentElement.getAttribute('data-bsb-theme')).toBe('light')
    mm.set(true)
    expect(document.documentElement.getAttribute('data-bsb-theme')).toBe('dark')
    applyTheme(s({ theme: 'system' }))
    expect(mm.listeners).toHaveLength(1)
    applyTheme(s({ theme: 'light' }))
    expect(mm.listeners).toHaveLength(0)
    mm.set(true)
    expect(document.documentElement.getAttribute('data-bsb-theme')).toBe('light')
  })
})

describe('site.css rules', () => {
  it('uses tokens only: no hex colors, no shadows, radius only on pills/round shapes', () => {
    applyTheme(s())
    const css = document.getElementById('bsb-site')!.textContent!
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b(?![-\w])/)
    for (const m of css.matchAll(/box-shadow:\s*([^;]+);/g)) expect(m[1].trim()).toBe('none')
    for (const m of css.matchAll(/border-radius:\s*([^;]+);/g)) expect(['0', '50px', '50%']).toContain(m[1].trim())
  })
})

describe('markReady', () => {
  it('adds bsb-ready', () => {
    markReady()
    expect(document.documentElement.classList.contains('bsb-ready')).toBe(true)
  })
})
