import { describe, it, expect } from 'vitest'
import { ALARM, ensureAlarm, handleInstalled, handleAlarm, handleMessage, seedSettingsOnInstalled } from './handlers'
import { DEFAULTS, defaultsFor } from '../settings'

const alarmsOf = () => (chrome.alarms as unknown as { alarms: Record<string, unknown> }).alarms
const flush = () => new Promise((r) => setTimeout(r, 0))

describe('background handlers', () => {
  it('ensureAlarm creates the alarm only when missing', () => {
    ensureAlarm()
    expect(alarmsOf()[ALARM]).toEqual({ periodInMinutes: 1440 })
    alarmsOf()[ALARM] = { periodInMinutes: 1440, marker: true }
    ensureAlarm()
    expect(alarmsOf()[ALARM]).toEqual({ periodInMinutes: 1440, marker: true })
  })

  it('handleInstalled refreshes and creates the alarm', () => {
    let calls = 0
    handleInstalled(async () => {
      calls++
      return { ok: true }
    })
    expect(calls).toBe(1)
    expect(alarmsOf()[ALARM]).toBeDefined()
  })

  describe('seedSettingsOnInstalled', () => {
    const mk = (stored: unknown, language: string) => {
      const sets: unknown[] = []
      return {
        sets,
        deps: {
          get: async () => stored,
          set: async (v: unknown) => {
            sets.push(v)
          },
          language,
        },
      }
    }

    it('install on an English browser seeds forceJaLocale:false', async () => {
      const { sets, deps } = mk(undefined, 'en-US')
      await seedSettingsOnInstalled({ reason: 'install' }, deps)
      expect(sets).toEqual([defaultsFor('en')])
    })

    it('install on a Japanese browser seeds the Japanese defaults', async () => {
      const { sets, deps } = mk(undefined, 'ja-JP')
      await seedSettingsOnInstalled({ reason: 'install' }, deps)
      expect(sets).toEqual([DEFAULTS])
    })

    it('update with nothing stored seeds the Japanese defaults, whatever the browser language', async () => {
      const { sets, deps } = mk(undefined, 'en-US')
      await seedSettingsOnInstalled({ reason: 'update' }, deps)
      expect(sets).toEqual([DEFAULTS])
    })

    it('leaves stored settings untouched', async () => {
      for (const reason of ['install', 'update']) {
        const { sets, deps } = mk({ theme: 'dark' }, 'en-US')
        await seedSettingsOnInstalled({ reason }, deps)
        expect(sets).toEqual([])
      }
    })

    it('ignores other reasons', async () => {
      const { sets, deps } = mk(undefined, 'en-US')
      await seedSettingsOnInstalled({ reason: 'chrome_update' }, deps)
      expect(sets).toEqual([])
    })
  })

  it('handleAlarm refreshes only for our alarm', () => {
    let calls = 0
    const refresh = async () => {
      calls++
      return { ok: true }
    }
    handleAlarm({ name: 'other' } as chrome.alarms.Alarm, refresh)
    handleAlarm({ name: ALARM } as chrome.alarms.Alarm, refresh)
    expect(calls).toBe(1)
  })

  it('handleMessage responds with the refresh result', async () => {
    const seen: unknown[] = []
    const keep = handleMessage({ type: 'bsb:refresh-now' }, (r) => seen.push(r), async () => ({ ok: true }))
    expect(keep).toBe(true)
    await flush()
    expect(seen).toEqual([{ ok: true }])
  })

  it('handleMessage responds even when refresh rejects', async () => {
    const seen: unknown[] = []
    handleMessage({ type: 'bsb:refresh-now' }, (r) => seen.push(r), () => Promise.reject(new Error('boom')))
    await flush()
    expect(seen).toEqual([{ ok: false, error: 'Error: boom' }])
  })

  it('handleMessage responds when refresh throws synchronously', async () => {
    const seen: unknown[] = []
    const keep = handleMessage({ type: 'bsb:refresh-now' }, (r) => seen.push(r), () => {
      throw new Error('sync')
    })
    expect(keep).toBe(true)
    await flush()
    expect(seen).toEqual([{ ok: false, error: 'Error: sync' }])
  })

  it('handleMessage ignores unknown messages', () => {
    expect(handleMessage({ type: 'x' }, () => {})).toBe(false)
    expect(handleMessage(null, () => {})).toBe(false)
  })
})
