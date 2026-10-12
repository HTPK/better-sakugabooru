import { sanitizeDict } from '../dict'

export const DICT_URL = 'https://cdn.jsdelivr.net/gh/HTPK/better-sakugabooru@main/dict/dist/dict.json'

const TIMEOUT_MS = 30_000

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>

export async function refreshDict(fetchFn: FetchFn = (u, i) => fetch(u, i)): Promise<{ ok: boolean; error?: string }> {
  try {
    const init: RequestInit = { cache: 'no-cache' }
    if (typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal) init.signal = AbortSignal.timeout(TIMEOUT_MS)
    const res = await fetchFn(DICT_URL, init)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const dict = sanitizeDict(JSON.parse(await res.text()))
    if (!dict) throw new Error('invalid dict shape')
    await chrome.storage.local.set({ dict, dictFetchedAt: Date.now() })
    await chrome.storage.local.remove('dictLastError')
    return { ok: true }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    try {
      await chrome.storage.local.set({ dictLastError: error })
    } catch {
      // storage unavailable: the caller still gets the error
    }
    return { ok: false, error }
  }
}
