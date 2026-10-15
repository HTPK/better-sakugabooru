import { DEFAULTS, type Settings } from '../settings'
import type { Dict } from '../dict'
import { attachProposeClick } from './propose'

export interface ListActions {
  saveSettings: (patch: Partial<Settings>) => Promise<void>
  navigate: (url: string) => void
}

/** Everything the content script touches, injected so the sequence is testable without chrome.*. */
export interface BootDeps {
  doc: Document
  win: Window
  loadSettings: () => Promise<Settings>
  saveSettings: (patch: Partial<Settings>) => Promise<void>
  onSettingsChange: (cb: (s: Settings) => void) => () => void
  getDict: () => Promise<Dict>
  runEarly: (settings: Settings, win: Window) => boolean
  applyTheme: (settings: Settings, doc: Document) => void
  markReady: (doc: Document) => void
  renderHeader: (doc: Document, settings: Settings) => void
  /** `actions` wires the band's per-page switch (save, then navigate). */
  renderList: (doc: Document, dict: Dict, settings: Settings, actions: ListActions) => unknown
  attachHoverPlay: (root: ParentNode, settings: Settings, win: Window) => unknown
  renderShow: (doc: Document, dict: Dict, settings: Settings) => boolean
  attachSearch: (doc: Document, dict: Dict, settings: Settings) => unknown
  warn?: (...args: unknown[]) => void
  /** Defaults to `win.location.assign`; injectable because jsdom cannot navigate. */
  navigate?: (url: string) => void
}

function domReady(doc: Document): Promise<void> {
  if (doc.readyState !== 'loading') return Promise.resolve()
  return new Promise((resolve) => doc.addEventListener('DOMContentLoaded', () => resolve(), { once: true }))
}

const LANG_LINKS = '.bsb-lang a[href], li.locale a[href*="locale="]'

/**
 * Clicking JP/EN (ours or the site's own Language menu) records the choice so early.ts stops
 * (or resumes) forcing the Japanese locale. A plain click waits for the write before navigating,
 * otherwise the next page's document_start could still read the old setting.
 */
function watchLangSwitch(d: BootDeps, warn: (...a: unknown[]) => void): void {
  const navigate = d.navigate ?? ((url: string) => d.win.location.assign(url))
  d.doc.addEventListener(
    'click',
    (e) => {
      const t = e.target as Element | null
      const a = t && typeof t.closest === 'function' ? t.closest(LANG_LINKS) : null
      if (!a) return
      let url: URL
      try {
        url = new URL(a.getAttribute('href') ?? '', d.doc.baseURI)
      } catch {
        return
      }
      const locale = url.searchParams.get('locale')
      if (locale !== 'ja' && locale !== 'en') return
      const saved = d
        .saveSettings({ forceJaLocale: locale === 'ja' })
        .catch((err) => warn('[bsb]', 'saveSettings', err))
      const plain = e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey
      if (!plain || e.defaultPrevented) return
      e.preventDefault()
      void saved.then(() => navigate(url.href))
    },
    true,
  )
}

export async function boot(d: BootDeps): Promise<void> {
  const { doc, win } = d
  const warn = d.warn ?? ((...a: unknown[]) => console.warn(...a))

  let settings: Settings
  try {
    settings = await d.loadSettings()
  } catch {
    settings = { ...DEFAULTS }
  }

  if (d.runEarly(settings, win)) return

  try {
    // document_start: <head> may not exist yet; applyTheme falls back to <html>.
    d.applyTheme(settings, doc)
  } catch (err) {
    warn('[bsb]', 'applyTheme', err)
  }

  watchLangSwitch(d, warn)
  let current = settings
  d.onSettingsChange((next) => {
    const prev = current
    current = next
    if (next.theme !== prev.theme || next.webFonts !== prev.webFonts) {
      try {
        d.applyTheme(next, doc)
      } catch (err) {
        warn('[bsb]', 'applyTheme', err)
      }
    }
  })

  try {
    await domReady(doc)
    const dict = await d.getDict()
    const step = (name: string, fn: () => unknown) => {
      try {
        fn()
      } catch (err) {
        warn('[bsb]', name, err)
      }
    }
    step('renderHeader', () => d.renderHeader(doc, settings))
    step('attachProposeClick', () => attachProposeClick(doc, (url) => win.open(url, '_blank', 'noopener')))
    if (doc.getElementById('post-list-posts')) {
      const navigate = d.navigate ?? ((url: string) => win.location.assign(url))
      // Band and search box exist before attachSearch below, so its input gets the autocomplete.
      step('renderList', () => d.renderList(doc, dict, settings, { saveSettings: d.saveSettings, navigate }))
      step('attachHoverPlay', () => d.attachHoverPlay(doc, settings, win))
    }
    if (doc.getElementById('post-view')) step('renderShow', () => d.renderShow(doc, dict, settings))
    step('attachSearch', () => d.attachSearch(doc, dict, settings))
  } catch (err) {
    warn('[bsb]', 'boot', err)
  } finally {
    d.markReady(doc)
  }
}
