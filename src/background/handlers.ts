import { refreshDict } from './refresh'

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
