import type { Settings } from '../settings'

export type EarlyAction =
  | { kind: 'none' }
  | { kind: 'replace'; url: string }
  | { kind: 'set-locale-and-reload' }
  | { kind: 'set-locale' }

export interface EarlyInput {
  url: string
  cookie: string
  htmlLang: string
  settings: Settings
  reloadedOnce: boolean
  /** PerformanceNavigationTiming.type of this load, if known. */
  navType?: string
  /** Front-page redirects done within FRONT_WINDOW_MS (loop guard). */
  recentFrontRedirects?: number
}

const LOCALE_COOKIE = 'locale=ja; path=/; max-age=31536000; SameSite=Lax'
const RELOAD_KEY = 'bsbLocaleReload'
const FRONT_KEY = 'bsbFrontRedirects'
const FRONT_MAX = 2
const FRONT_WINDOW_MS = 10_000
const SITE_DEFAULT_LIMIT = 40
/** Reloading these would re-run history/form state the user did not ask for; the cookie still helps the next load. */
const NO_RELOAD_NAV = new Set(['back_forward', 'reload'])

function hasJaLocale(cookie: string): boolean {
  return cookie.split(';').some((c) => c.trim() === 'locale=ja')
}

export function decideEarlyAction(input: EarlyInput): EarlyAction {
  const { settings } = input
  const url = new URL(input.url)

  // (a) The front page is a static page with no posts. Capped so a server-side /post -> / bounce cannot loop.
  if (settings.frontToPosts && url.pathname === '/' && (input.recentFrontRedirects ?? 0) < FRONT_MAX) {
    return { kind: 'replace', url: '/post' }
  }

  // (b) Force the Japanese site locale.
  if (settings.forceJaLocale && !hasJaLocale(input.cookie)) {
    const canReload = !input.reloadedOnce && !(input.navType && NO_RELOAD_NAV.has(input.navType))
    if (input.htmlLang !== 'ja' && canReload) return { kind: 'set-locale-and-reload' }
    return { kind: 'set-locale' }
  }

  // (c) Per-page count on the list page only (not /post/show/...).
  if (url.pathname === '/post' && !url.searchParams.has('limit') && settings.perPage !== SITE_DEFAULT_LIMIT) {
    url.searchParams.set('limit', String(settings.perPage))
    return { kind: 'replace', url: url.href }
  }

  return { kind: 'none' }
}

function readReloaded(win: Window): boolean {
  try {
    return win.sessionStorage.getItem(RELOAD_KEY) === '1'
  } catch {
    return false
  }
}

/** Timestamps of recent front redirects, or null when sessionStorage is unusable. */
function readFrontRedirects(win: Window, now: number): number[] | null {
  try {
    const raw: unknown = JSON.parse(win.sessionStorage.getItem(FRONT_KEY) ?? '[]')
    if (!Array.isArray(raw)) return []
    return raw.filter((t): t is number => typeof t === 'number' && now - t >= 0 && now - t < FRONT_WINDOW_MS)
  } catch (e) {
    return e instanceof SyntaxError ? [] : null
  }
}

function navType(win: Window): string | undefined {
  try {
    const e = win.performance?.getEntriesByType?.('navigation')[0] as { type?: unknown } | undefined
    return typeof e?.type === 'string' ? e.type : undefined
  } catch {
    return undefined
  }
}

/** Runs at document_start. Returns true if a navigation (replace/reload) was triggered. */
export function runEarly(settings: Settings, win: Window = window, now: number = Date.now()): boolean {
  const front = readFrontRedirects(win, now)
  // Without sessionStorage the loop guard cannot work, so the front redirect is skipped.
  const recentFrontRedirects = front ? front.length : FRONT_MAX
  const input = (patch: Partial<EarlyInput> = {}): EarlyInput => ({
    url: win.location.href,
    cookie: win.document.cookie,
    htmlLang: win.document.documentElement?.lang ?? '',
    settings,
    reloadedOnce: readReloaded(win),
    navType: navType(win),
    recentFrontRedirects,
    ...patch,
  })
  const setCookie = (): boolean => {
    win.document.cookie = LOCALE_COOKIE
    return hasJaLocale(win.document.cookie)
  }
  // Re-decides with the locale rule satisfied (cookie set) or disabled (cookie refused), so later rules still apply.
  const rest = (cookieSet: boolean) =>
    decideEarlyAction(cookieSet ? input({ cookie: 'locale=ja' }) : input({ settings: { ...settings, forceJaLocale: false } }))

  let action = decideEarlyAction(input())
  if (action.kind === 'set-locale') action = rest(setCookie())
  else if (action.kind === 'set-locale-and-reload') {
    const ok = setCookie()
    let marked = false
    if (ok) {
      try {
        win.sessionStorage.setItem(RELOAD_KEY, '1')
        marked = true
      } catch {
        // Without sessionStorage we cannot guard against reload loops, so skip the reload.
      }
    }
    if (marked) {
      win.location.reload()
      return true
    }
    action = rest(ok)
  }

  if (action.kind !== 'replace') return false
  if (new URL(win.location.href).pathname === '/' && action.url === '/post' && front) {
    try {
      win.sessionStorage.setItem(FRONT_KEY, JSON.stringify([...front, now]))
    } catch {
      return false
    }
  }
  win.location.replace(action.url)
  return true
}
