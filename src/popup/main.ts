import '../theme/tokens.css'
import './popup.css'
import { DEFAULTS, loadSettings, saveSettings, type Settings, type Theme } from '../settings'
import { validateDict, type Dict } from '../dict'
import { resolveTheme } from '../content/theme'
import snapshot from '../dict/snapshot.json'

export interface PopupDeps {
  load: () => Promise<Settings>
  save: (patch: Partial<Settings>) => Promise<void>
  sendMessage: (msg: unknown) => Promise<unknown>
  getStorage: (keys: string[]) => Promise<Record<string, unknown>>
}

const DARK_QUERY = '(prefers-color-scheme: dark)'
const TECH_MIN = 0
const TECH_MAX = 5
const BOOL_KEYS = [
  'translateTags',
  'showRomaji',
  'searchSuggest',
  'hoverPlay',
  'frontToPosts',
  'forceJaLocale',
  'webFonts',
  'showCopyright',
  'showArtist',
  'showScoreDate',
  'showTech',
] as const
type BoolKey = (typeof BOOL_KEYS)[number]
type SegKey = 'theme' | 'perPage' | 'thumbSize'

const defaultDeps: PopupDeps = {
  load: () => loadSettings(),
  save: (patch) => saveSettings(patch),
  sendMessage: (msg) => chrome.runtime.sendMessage(msg),
  getStorage: (keys) => chrome.storage.local.get(keys),
}

const entryCount = (d: Dict) =>
  Object.keys(d.artists).length + Object.keys(d.copyrights).length + Object.keys(d.general).length

const pad = (n: number) => String(n).padStart(2, '0')

function dictDate(stored: Dict | null, fetchedAt: unknown): string | null {
  if (stored) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(stored.updated)
    return m ? `${m[1]}/${m[2]}/${m[3]}` : stored.updated
  }
  if (typeof fetchedAt === 'number' && Number.isFinite(fetchedAt) && fetchedAt > 0) {
    const t = new Date(fetchedAt)
    return `${t.getFullYear()}/${pad(t.getMonth() + 1)}/${pad(t.getDate())}`
  }
  return null
}

function version(): string {
  try {
    return chrome.runtime.getManifest().version
  } catch {
    return ''
  }
}

export async function initPopup(doc: Document, deps: Partial<PopupDeps> = {}): Promise<void> {
  const d: PopupDeps = { ...defaultDeps, ...deps }
  const root = doc.documentElement
  const mql = doc.defaultView?.matchMedia?.(DARK_QUERY) ?? null
  let theme: Theme = DEFAULTS.theme
  const applyTheme = () => root.setAttribute('data-bsb-theme', resolveTheme(theme, mql?.matches ?? false))
  applyTheme()
  mql?.addEventListener?.('change', () => {
    if (theme === 'system') applyTheme()
  })

  const q = <T extends Element = HTMLElement>(sel: string) => doc.querySelector<T>(sel)
  const ver = version()
  const verEl = q('#pp-version')
  if (verEl) verEl.textContent = ver ? `v${ver}` : ''

  const settings = await d.load()
  theme = settings.theme
  applyTheme()

  const save = (patch: Partial<Settings>) => void d.save(patch).catch(() => {})

  // Checkboxes
  for (const key of BOOL_KEYS) {
    const input = q<HTMLInputElement>(`input[data-key="${key}"]`)
    if (!input) continue
    input.checked = settings[key as BoolKey]
    input.addEventListener('change', () => save({ [key]: input.checked }))
  }

  // Segmented buttons
  const parse: Record<SegKey, (v: string) => Settings[SegKey]> = {
    theme: (v) => v as Theme,
    perPage: (v) => Number(v) as Settings['perPage'],
    thumbSize: (v) => v as Settings['thumbSize'],
  }
  for (const key of Object.keys(parse) as SegKey[]) {
    const buttons = Array.from(doc.querySelectorAll<HTMLButtonElement>(`[data-seg="${key}"] button[data-value]`))
    const mark = (value: unknown) =>
      buttons.forEach((b) => b.setAttribute('aria-pressed', String(parse[key](b.dataset.value!) === value)))
    mark(settings[key])
    for (const b of buttons) {
      b.addEventListener('click', () => {
        const value = parse[key](b.dataset.value!)
        mark(value)
        if (key === 'theme') {
          theme = value as Theme
          applyTheme()
        }
        save({ [key]: value })
      })
    }
  }

  // Tech-tag stepper
  const dec = q<HTMLButtonElement>('#pp-tech-dec')
  const inc = q<HTMLButtonElement>('#pp-tech-inc')
  const valEl = q('#pp-tech-value')
  let techLimit = settings.techLimit
  const showTech = () => {
    if (valEl) valEl.textContent = String(techLimit)
    if (dec) dec.disabled = techLimit <= TECH_MIN
    if (inc) inc.disabled = techLimit >= TECH_MAX
  }
  const step = (delta: number) => (e: Event) => {
    e.preventDefault() // the stepper sits inside the 技法タグ label; never toggle its checkbox
    const next = Math.min(TECH_MAX, Math.max(TECH_MIN, techLimit + delta))
    if (next === techLimit) return
    techLimit = next
    showTech()
    save({ techLimit })
  }
  dec?.addEventListener('click', step(-1))
  inc?.addEventListener('click', step(1))
  showTech()

  // Footer: dictionary status
  const countEl = q('#pp-dict-count')
  const dateEl = q('#pp-dict-date')
  const errEl = q('#pp-dict-error')
  const showError = (msg: string | null) => {
    if (!errEl) return
    errEl.textContent = msg ?? ''
    errEl.hidden = !msg
  }
  const renderFooter = async () => {
    let r: Record<string, unknown> = {}
    try {
      r = await d.getStorage(['dict', 'dictFetchedAt', 'dictLastError'])
    } catch {
      // storage unavailable: fall back to the bundled snapshot
    }
    const stored = validateDict(r.dict) ? r.dict : null
    if (countEl) countEl.textContent = entryCount(stored ?? (snapshot as Dict)).toLocaleString('ja-JP')
    if (dateEl) dateEl.textContent = dictDate(stored, r.dictFetchedAt) ?? '[未取得]'
    showError(typeof r.dictLastError === 'string' && r.dictLastError ? r.dictLastError : null)
  }
  await renderFooter()

  const refreshBtn = q<HTMLButtonElement>('#pp-refresh')
  if (refreshBtn) {
    const idle = refreshBtn.textContent ?? ''
    refreshBtn.addEventListener('click', async () => {
      if (refreshBtn.disabled) return
      refreshBtn.disabled = true
      refreshBtn.textContent = '更新中…'
      let res: unknown
      try {
        res = await d.sendMessage({ type: 'bsb:refresh-now' })
      } catch (e) {
        res = { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
      await renderFooter()
      const r = res as { ok?: unknown; error?: unknown } | undefined
      if (!r || r.ok !== true) showError(typeof r?.error === 'string' && r.error ? r.error : '更新に失敗しました')
      refreshBtn.textContent = idle
      refreshBtn.disabled = false
    })
  }
}
