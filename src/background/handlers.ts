import { refreshDict } from './refresh'
import { uiLang } from '../i18n'
import { DEFAULTS, defaultsFor, type Settings } from '../settings'

export const ALARM = 'bsb-dict-refresh'
const PERIOD_MIN = 1440

type Refresh = () => Promise<{ ok: boolean; error?: string }>

/** Creates the daily alarm if it is missing (alarms can be lost across browser restarts/updates). */
export function ensureAlarm(): void {
  chrome.alarms.get(ALARM, (a) => {
    if (!a) chrome.alarms.create(ALARM, { periodInMinutes: PERIOD_MIN })
  })
}

export function handleInstalled(refresh: Refresh = () => refreshDict()): void {
  void refresh().catch(() => {})
  chrome.alarms.create(ALARM, { periodInMinutes: PERIOD_MIN })
}

interface SeedDeps {
  /** Returns the stored `settings` value (undefined when nothing is stored). */
  get: () => Promise<unknown>
  set: (value: Settings) => Promise<void>
  language: string | undefined
}

const realSeedDeps = (): SeedDeps => ({
  get: async () => (await chrome.storage.sync.get('settings')).settings,
  set: (settings) => chrome.storage.sync.set({ settings }),
  language: globalThis.navigator?.language,
})

/**
 * Fresh install: seed defaults from the browser UI language. Upgrade from a version that stored
 * nothing: keep the Japanese defaults those users have always had. Stored settings are never touched.
 */
export async function seedSettingsOnInstalled(
  details: { reason: string },
  deps: SeedDeps = realSeedDeps(),
): Promise<void> {
  if (details.reason !== 'install' && details.reason !== 'update') return
  if ((await deps.get()) !== undefined) return
  await deps.set(details.reason === 'install' ? defaultsFor(uiLang(deps.language)) : { ...DEFAULTS })
}

export function handleAlarm(alarm: chrome.alarms.Alarm, refresh: Refresh = () => refreshDict()): void {
  if (alarm.name === ALARM) void refresh().catch(() => {})
}

/** Returns true when it will respond asynchronously (keeps the message channel open). */
export function handleMessage(
  msg: unknown,
  sendResponse: (r: unknown) => void,
  refresh: Refresh = () => refreshDict(),
): boolean {
  if (msg && typeof msg === 'object' && (msg as { type?: unknown }).type === 'bsb:refresh-now') {
    Promise.resolve()
      .then(() => refresh())
      .then(sendResponse, (e) => sendResponse({ ok: false, error: String(e) }))
    return true
  }
  return false
}
