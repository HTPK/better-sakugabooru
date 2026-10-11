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
}

const LOCALE_COOKIE = 'locale=ja; path=/; max-age=31536000; SameSite=Lax'
const RELOAD_KEY = 'bsbLocaleReload'
const SITE_DEFAULT_LIMIT = 40

function hasJaLocale(cookie: string): boolean {
  return cookie.split(';').some((c) => c.trim() === 'locale=ja')
}

export function decideEarlyAction(input: EarlyInput): EarlyAction {
  const { settings } = input
  const url = new URL(input.url)

  // (a) The front page is a static page with no posts.
  if (settings.frontToPosts && url.pathname === '/') return { kind: 'replace', url: '/post' }

  // (b) Force the Japanese site locale.
  if (settings.forceJaLocale && !hasJaLocale(input.cookie)) {
    if (input.htmlLang !== 'ja' && !input.reloadedOnce) return { kind: 'set-locale-and-reload' }
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

/** Runs at document_start. Returns true if a navigation (replace/reload) was triggered. */
export function runEarly(settings: Settings, win: Window = window): boolean {
  const input = (): EarlyInput => ({
    url: win.location.href,
    cookie: win.document.cookie,
    htmlLang: win.document.documentElement?.lang ?? '',
    settings,
    reloadedOnce: readReloaded(win),
  })

  let action = decideEarlyAction(input())
  if (action.kind === 'set-locale') {
    win.document.cookie = LOCALE_COOKIE
    // Cookie is now set; re-decide so the remaining rules (per-page limit) still apply on this load.
    action = decideEarlyAction({ ...input(), cookie: 'locale=ja' })
  }

  switch (action.kind) {
    case 'replace':
      win.location.replace(action.url)
      return true
    case 'set-locale-and-reload':
      win.document.cookie = LOCALE_COOKIE
      try {
        win.sessionStorage.setItem(RELOAD_KEY, '1')
      } catch {
        // Without sessionStorage we cannot guard against reload loops, so skip the reload.
        return false
      }
      win.location.reload()
      return true
    default:
      return false
  }
}
