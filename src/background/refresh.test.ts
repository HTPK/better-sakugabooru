import { describe, it, expect } from 'vitest'
import { refreshDict, DICT_URL } from './refresh'

const good = { v: 1, updated: '2026-11-01', artists: {}, copyrights: {}, general: {} }
const resp = (body: string, status = 200) => new Response(body, { status })

describe('refreshDict', () => {
  it('stores a valid dict and requests with no-cache', async () => {
    let seen: [string, RequestInit | undefined] | undefined
    const r = await refreshDict(async (u, i) => {
      seen = [String(u), i]
      return resp(JSON.stringify(good))
    })
    expect(r.ok).toBe(true)
    expect(seen?.[0]).toBe(DICT_URL)
    expect(seen?.[1]?.cache).toBe('no-cache')
    const s = await chrome.storage.local.get(['dict', 'dictFetchedAt'])
    expect(s.dict).toEqual(good)
    expect(typeof s.dictFetchedAt).toBe('number')
  })

  it('keeps the old dict and records an error on invalid JSON', async () => {
    await chrome.storage.local.set({ dict: good })
    const r = await refreshDict(async () => resp('not json'))
    expect(r.ok).toBe(false)
    const s = await chrome.storage.local.get(['dict', 'dictLastError'])
    expect(s.dict).toEqual(good)
    expect(typeof s.dictLastError).toBe('string')
  })

  it('rejects a dict with the wrong shape', async () => {
    const r = await refreshDict(async () => resp(JSON.stringify({ v: 2 })))
    expect(r.ok).toBe(false)
    expect((await chrome.storage.local.get('dict')).dict).toBeUndefined()
  })

  it('stores the sanitized dict, dropping only bad entries', async () => {
    const raw = { ...good, artists: { ok: { ja: 'あ' }, evil: { ja: 'a‮b' } }, general: { g: { ja: '' } } }
    const r = await refreshDict(async () => resp(JSON.stringify(raw)))
    expect(r.ok).toBe(true)
    const s = await chrome.storage.local.get('dict')
    expect(s.dict).toEqual({ ...good, artists: { ok: { ja: 'あ' } }, general: {} })
  })

  it('records an error on 404', async () => {
    const r = await refreshDict(async () => resp('nope', 404))
    expect(r.ok).toBe(false)
    expect(r.error).toContain('404')
    expect((await chrome.storage.local.get('dictLastError')).dictLastError).toContain('404')
  })

  it('records an error when fetch throws', async () => {
    const r = await refreshDict(async () => {
      throw new Error('offline')
    })
    expect(r).toEqual({ ok: false, error: 'offline' })
  })

  it('clears a previous error on success', async () => {
    await chrome.storage.local.set({ dictLastError: 'old' })
    const r = await refreshDict(async () => resp(JSON.stringify(good)))
    expect(r.ok).toBe(true)
    expect((await chrome.storage.local.get('dictLastError')).dictLastError).toBeUndefined()
  })

  it('still resolves when the error write itself fails', async () => {
    chrome.storage.local.set = (async () => {
      throw new Error('quota')
    }) as never
    const r = await refreshDict(async () => resp('nope', 500))
    expect(r).toEqual({ ok: false, error: 'HTTP 500' })
  })

  it('passes a timeout signal to fetch', async () => {
    let init: RequestInit | undefined
    await refreshDict(async (_u, i) => {
      init = i
      return resp(JSON.stringify(good))
    })
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })
})
