import type { Settings, Theme } from '../settings'
import tokensCss from '../theme/tokens.css?inline'
import siteCss from '../theme/site.css?inline'
import fontsCss from '../theme/fonts.css?inline'

const GFONTS_ID = 'bsb-gfonts'
const GFONTS_HREF = 'https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;700&display=swap'
const DARK_QUERY = '(prefers-color-scheme: dark)'

export function resolveTheme(setting: Theme, prefersDark: boolean): 'light' | 'dark' {
  if (setting === 'system') return prefersDark ? 'dark' : 'light'
  return setting
}

function injectStyle(doc: Document, id: string, css: string): void {
  if (doc.getElementById(id)) return
  const el = doc.createElement('style')
  el.id = id
  el.textContent = css
  ;(doc.head ?? doc.documentElement).appendChild(el)
}

function setFontsLink(doc: Document, on: boolean): void {
  const cur = doc.getElementById(GFONTS_ID)
  if (!on) {
    cur?.remove()
    return
  }
  if (cur) return
  const link = doc.createElement('link')
  link.id = GFONTS_ID
  link.rel = 'stylesheet'
  link.href = GFONTS_HREF
  ;(doc.head ?? doc.documentElement).appendChild(link)
}

// One system-theme listener per document; replaced or removed on every applyTheme call.
const systemListeners = new WeakMap<Document, { mql: MediaQueryList; fn: (e: MediaQueryListEvent) => void }>()

function darkQuery(doc: Document): MediaQueryList | null {
  const win = doc.defaultView
  return win && typeof win.matchMedia === 'function' ? win.matchMedia(DARK_QUERY) : null
}

export function applyTheme(settings: Settings, doc: Document = document): void {
  const root = doc.documentElement
  const prev = systemListeners.get(doc)
  if (prev) {
    prev.mql.removeEventListener('change', prev.fn)
    systemListeners.delete(doc)
  }
  const mql = darkQuery(doc)
  root.setAttribute('data-bsb-theme', resolveTheme(settings.theme, mql?.matches ?? false))
  if (settings.theme === 'system' && mql) {
    const fn = (e: MediaQueryListEvent) => root.setAttribute('data-bsb-theme', resolveTheme('system', e.matches))
    mql.addEventListener('change', fn)
    systemListeners.set(doc, { mql, fn })
  }

  injectStyle(doc, 'bsb-tokens', tokensCss)
  injectStyle(doc, 'bsb-site', siteCss)
  injectStyle(doc, 'bsb-fonts', fontsCss.split('__FONT_BASE__').join(chrome.runtime.getURL('fonts/')))
  setFontsLink(doc, settings.webFonts)
}

export function markReady(doc: Document = document): void {
  doc.documentElement.classList.add('bsb-ready')
}
