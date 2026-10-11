import { describe, it, expect, vi } from 'vitest'
import { DEFAULTS, type Settings } from '../settings'
import { decideEarlyAction, runEarly, type EarlyAction } from './early'

const BASE = 'https://www.sakugabooru.com'
const s = (patch: Partial<Settings> = {}): Settings => ({ ...DEFAULTS, ...patch })

type Case = [string, { url: string; cookie?: string; htmlLang?: string; settings?: Partial<Settings>; reloadedOnce?: boolean }, EarlyAction]

const cases: Case[] = [
  ['front -> /post', { url: `${BASE}/` }, { kind: 'replace', url: '/post' }],
  ['front with query -> /post', { url: `${BASE}/?foo=1` }, { kind: 'replace', url: '/post' }],
  ['front kept when frontToPosts off', { url: `${BASE}/`, settings: { frontToPosts: false } }, { kind: 'none' }],
  ['front redirect wins over locale', { url: `${BASE}/`, cookie: '' }, { kind: 'replace', url: '/post' }],
  ['english page without cookie -> set + reload', { url: `${BASE}/post`, cookie: 'a=b', htmlLang: 'en' }, { kind: 'set-locale-and-reload' }],
  ['already reloaded once -> set cookie only', { url: `${BASE}/post`, cookie: '', htmlLang: 'en', reloadedOnce: true }, { kind: 'set-locale' }],
  ['ja page without cookie -> set cookie only', { url: `${BASE}/post`, cookie: '', htmlLang: 'ja' }, { kind: 'set-locale' }],
  ['locale=en cookie counts as missing', { url: `${BASE}/post`, cookie: 'locale=en', htmlLang: 'en' }, { kind: 'set-locale-and-reload' }],
  ['xlocale=ja is not locale=ja', { url: `${BASE}/post`, cookie: 'xlocale=ja', htmlLang: 'en' }, { kind: 'set-locale-and-reload' }],
  ['forceJaLocale off', { url: `${BASE}/post`, cookie: '', htmlLang: 'en', settings: { forceJaLocale: false } }, { kind: 'none' }],
  ['list with default perPage', { url: `${BASE}/post` }, { kind: 'none' }],
  ['list adds limit', { url: `${BASE}/post`, settings: { perPage: 100 } }, { kind: 'replace', url: `${BASE}/post?limit=100` }],
  ['search adds limit', { url: `${BASE}/post?tags=x`, settings: { perPage: 60 } }, { kind: 'replace', url: `${BASE}/post?tags=x&limit=60` }],
  ['existing limit kept', { url: `${BASE}/post?tags=x&limit=24`, settings: { perPage: 60 } }, { kind: 'none' }],
  ['show page never gets limit', { url: `${BASE}/post/show/318817`, settings: { perPage: 100 } }, { kind: 'none' }],
  ['other pages untouched', { url: `${BASE}/tag?name=x`, settings: { perPage: 100 } }, { kind: 'none' }],
  ['hash preserved', { url: `${BASE}/post?page=2#x`, settings: { perPage: 24 } }, { kind: 'replace', url: `${BASE}/post?page=2&limit=24#x` }],
]

describe('decideEarlyAction', () => {
  it.each(cases)('%s', (_name, c, want) => {
    expect(
      decideEarlyAction({
        url: c.url,
        cookie: c.cookie ?? 'foo=1; locale=ja',
        htmlLang: c.htmlLang ?? 'ja',
        settings: s(c.settings),
        reloadedOnce: c.reloadedOnce ?? false,
      }),
    ).toEqual(want)
  })
})

function fakeWin(url: string, cookie: string, lang: string, session: Record<string, string> = {}) {
  const cookies: string[] = []
  const win = {
    location: { href: url, replace: vi.fn(), reload: vi.fn() },
    document: {
      documentElement: { lang },
      get cookie() {
        return [cookie, ...cookies.map((c) => c.split(';')[0])].filter(Boolean).join('; ')
      },
      set cookie(v: string) {
        cookies.push(v)
      },
    },
    sessionStorage: {
      getItem: (k: string) => session[k] ?? null,
      setItem: (k: string, v: string) => void (session[k] = v),
    },
  }
  return { win: win as unknown as Window, cookies, session, loc: win.location }
}

describe('runEarly', () => {
  it('replaces the front page', () => {
    const f = fakeWin(`${BASE}/`, 'locale=ja', 'ja')
    expect(runEarly(s(), f.win)).toBe(true)
    expect(f.loc.replace).toHaveBeenCalledWith('/post')
  })

  it('sets the cookie, marks the session and reloads an English page', () => {
    const f = fakeWin(`${BASE}/post`, '', 'en')
    expect(runEarly(s(), f.win)).toBe(true)
    expect(f.cookies).toEqual(['locale=ja; path=/; max-age=31536000; SameSite=Lax'])
    expect(f.session.bsbLocaleReload).toBe('1')
    expect(f.loc.reload).toHaveBeenCalledOnce()
  })

  it('does not reload twice in a session', () => {
    const f = fakeWin(`${BASE}/post`, '', 'en', { bsbLocaleReload: '1' })
    expect(runEarly(s(), f.win)).toBe(false)
    expect(f.cookies).toHaveLength(1)
    expect(f.loc.reload).not.toHaveBeenCalled()
  })

  it('sets the cookie on a ja page and still applies the limit', () => {
    const f = fakeWin(`${BASE}/post?tags=x`, '', 'ja')
    expect(runEarly(s({ perPage: 100 }), f.win)).toBe(true)
    expect(f.cookies).toHaveLength(1)
    expect(f.loc.replace).toHaveBeenCalledWith(`${BASE}/post?tags=x&limit=100`)
  })

  it('does nothing when nothing applies', () => {
    const f = fakeWin(`${BASE}/post/show/318817`, 'locale=ja', 'ja')
    expect(runEarly(s({ perPage: 100 }), f.win)).toBe(false)
    expect(f.loc.replace).not.toHaveBeenCalled()
    expect(f.loc.reload).not.toHaveBeenCalled()
  })
})
