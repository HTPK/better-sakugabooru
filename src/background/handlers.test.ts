import { describe, it, expect } from 'vitest'
import { ALARM, ensureAlarm, handleInstalled, handleAlarm, handleMessage } from './handlers'

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

  it('handleMessage ignores unknown messages', () => {
    expect(handleMessage({ type: 'x' }, () => {})).toBe(false)
    expect(handleMessage(null, () => {})).toBe(false)
  })
})
