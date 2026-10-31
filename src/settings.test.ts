import { describe, it, expect } from 'vitest'
import { DEFAULTS, defaultsFor, loadSettings, saveSettings, onSettingsChange } from './settings'

function browserLang(lang: string) {
  Object.defineProperty(globalThis.navigator, 'language', { value: lang, configurable: true })
}

describe('settings', () => {
  it('returns defaults when storage is empty', async () => {
    browserLang('ja-JP')
    expect(await loadSettings()).toEqual(DEFAULTS)
  })

  it('returns defaults when storage throws', async () => {
    browserLang('ja-JP')
    chrome.storage.sync.get = (async () => {
      throw new Error('storage down')
    }) as never
    expect(await loadSettings()).toEqual(DEFAULTS)
  })

  it('defaultsFor only differs in forceJaLocale', () => {
    expect(defaultsFor('ja').forceJaLocale).toBe(true)
    expect(defaultsFor('en').forceJaLocale).toBe(false)
    expect({ ...defaultsFor('en'), forceJaLocale: true }).toEqual(DEFAULTS)
  })

  it('first run on an English browser does not force the Japanese locale', async () => {
    browserLang('en-US')
    expect((await loadSettings()).forceJaLocale).toBe(false)
  })

  it('a stored forceJaLocale wins over the browser language', async () => {
    browserLang('en-US')
    await chrome.storage.sync.set({ settings: { forceJaLocale: true } })
    expect((await loadSettings()).forceJaLocale).toBe(true)
  })

  it('stored settings missing forceJaLocale fall back to the static default', async () => {
    browserLang('en-US')
    await chrome.storage.sync.set({ settings: { theme: 'dark' } })
    expect((await loadSettings()).forceJaLocale).toBe(true)
  })

  it('merges stored values over defaults', async () => {
    await chrome.storage.sync.set({ settings: { theme: 'dark', perPage: 100 } })
    const s = await loadSettings()
    expect(s.theme).toBe('dark')
    expect(s.perPage).toBe(100)
    expect(s.hoverPlay).toBe(true)
  })

  it('falls back to defaults for invalid values and clamps techLimit', async () => {
    await chrome.storage.sync.set({
      settings: { theme: 'neon', perPage: 7, thumbSize: 'huge', translateTags: 'yes', techLimit: 99 },
    })
    const s = await loadSettings()
    expect(s.theme).toBe(DEFAULTS.theme)
    expect(s.perPage).toBe(DEFAULTS.perPage)
    expect(s.thumbSize).toBe(DEFAULTS.thumbSize)
    expect(s.translateTags).toBe(DEFAULTS.translateTags)
    expect(s.techLimit).toBe(5)
    await chrome.storage.sync.set({ settings: { techLimit: -3 } })
    expect((await loadSettings()).techLimit).toBe(0)
  })

  it('persists patches', async () => {
    await saveSettings({ theme: 'light' })
    await saveSettings({ techLimit: 4 })
    const s = await loadSettings()
    expect(s.theme).toBe('light')
    expect(s.techLimit).toBe(4)
  })

  it('serialises concurrent saves so no patch is lost', async () => {
    await Promise.all([saveSettings({ theme: 'light' }), saveSettings({ techLimit: 4 }), saveSettings({ showTech: false })])
    const s = await loadSettings()
    expect(s.theme).toBe('light')
    expect(s.techLimit).toBe(4)
    expect(s.showTech).toBe(false)
  })

  it('a failed save does not block later saves', async () => {
    const sync = chrome.storage.sync as unknown as { set: (i: object) => Promise<void> }
    const orig = sync.set.bind(sync)
    sync.set = async () => Promise.reject(new Error('quota'))
    await expect(saveSettings({ theme: 'dark' })).rejects.toThrow('quota')
    sync.set = orig
    await saveSettings({ techLimit: 3 })
    expect((await loadSettings()).techLimit).toBe(3)
  })

  it('notifies listeners on change and can unsubscribe', async () => {
    const seen: string[] = []
    const off = onSettingsChange((s) => seen.push(s.theme))
    await saveSettings({ theme: 'dark' })
    expect(seen).toEqual(['dark'])
    off()
    await saveSettings({ theme: 'light' })
    expect(seen).toEqual(['dark'])
  })
})
