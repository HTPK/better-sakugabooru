export type Theme = 'light' | 'dark' | 'system'
export interface Settings {
  theme: Theme
  translateTags: boolean
  showRomaji: boolean
  searchSuggest: boolean
  hoverPlay: boolean
  frontToPosts: boolean
  forceJaLocale: boolean
  webFonts: boolean
  perPage: 24 | 40 | 60 | 100
  thumbSize: 'small' | 'medium' | 'large'
  showCopyright: boolean
  showArtist: boolean
  showScoreDate: boolean
  showTech: boolean
  techLimit: number
}

export const DEFAULTS: Settings = {
  theme: 'system',
  translateTags: true,
  showRomaji: true,
  searchSuggest: true,
  hoverPlay: true,
  frontToPosts: true,
  forceJaLocale: true,
  webFonts: true,
  perPage: 40,
  thumbSize: 'medium',
  showCopyright: true,
  showArtist: true,
  showScoreDate: true,
  showTech: true,
  techLimit: 2,
}

const KEY = 'settings'

const ENUMS: Record<string, readonly unknown[]> = {
  theme: ['light', 'dark', 'system'],
  perPage: [24, 40, 60, 100],
  thumbSize: ['small', 'medium', 'large'],
}

function sanitize(raw: unknown): Settings {
  const out: Record<string, unknown> = { ...DEFAULTS }
  if (raw && typeof raw === 'object') {
    for (const [k, def] of Object.entries(DEFAULTS)) {
      const v = (raw as Record<string, unknown>)[k]
      if (v === undefined) continue
      if (k in ENUMS) {
        if (ENUMS[k].includes(v)) out[k] = v
      } else if (k === 'techLimit') {
        if (typeof v === 'number' && Number.isFinite(v)) out[k] = Math.min(5, Math.max(0, Math.round(v)))
      } else if (typeof v === typeof def) {
        out[k] = v
      }
    }
  }
  return out as unknown as Settings
}

export async function loadSettings(): Promise<Settings> {
  const r = await chrome.storage.sync.get(KEY)
  return sanitize(r[KEY])
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  const cur = await loadSettings()
  await chrome.storage.sync.set({ [KEY]: { ...cur, ...patch } })
}

export function onSettingsChange(cb: (s: Settings) => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === 'sync' && changes[KEY]) cb(sanitize(changes[KEY].newValue))
  }
  chrome.storage.onChanged.addListener(listener)
  return () => chrome.storage.onChanged.removeListener(listener)
}
