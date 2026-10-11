import { DEFAULTS, type Settings } from '../settings'
import type { Dict } from '../dict'

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
  renderList: (doc: Document, dict: Dict, settings: Settings) => unknown
  attachHoverPlay: (root: ParentNode, settings: Settings, win: Window) => unknown
  renderShow: (doc: Document, dict: Dict, settings: Settings) => boolean
  attachSearch: (doc: Document, dict: Dict, settings: Settings) => unknown
  warn?: (...args: unknown[]) => void
}

function domReady(doc: Document): Promise<void> {
  if (doc.readyState !== 'loading') return Promise.resolve()
  return new Promise((resolve) => doc.addEventListener('DOMContentLoaded', () => resolve(), { once: true }))
}

/** Clicking JP/EN records the choice so early.ts stops (or resumes) forcing the Japanese locale. */
function watchLangSwitch(d: BootDeps, warn: (...a: unknown[]) => void): void {
  d.doc.addEventListener(
    'click',
    (e) => {
      const t = e.target as Element | null
      const a = t && typeof t.closest === 'function' ? t.closest('.bsb-lang a[href]') : null
      if (!a) return
      let locale: string | null = null
      try {
        locale = new URL(a.getAttribute('href') ?? '', d.doc.baseURI).searchParams.get('locale')
      } catch {
        return
      }
      if (locale !== 'ja' && locale !== 'en') return
      // No preventDefault: navigation proceeds; the storage write is fire-and-forget.
      d.saveSettings({ forceJaLocale: locale === 'ja' }).catch((err) => warn('[bsb]', 'saveSettings', err))
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
    if (doc.getElementById('post-list-posts')) {
      step('renderList', () => d.renderList(doc, dict, settings))
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
