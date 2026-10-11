import { validateDict } from '../dict'

export const DICT_URL = 'https://cdn.jsdelivr.net/gh/HTPK/sakugabooru-ja-dict@main/dist/dict.json'

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>

export async function refreshDict(fetchFn: FetchFn = (u, i) => fetch(u, i)): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetchFn(DICT_URL, { cache: 'no-cache' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const dict: unknown = JSON.parse(await res.text())
    if (!validateDict(dict)) throw new Error('invalid dict shape')
    await chrome.storage.local.set({ dict, dictFetchedAt: Date.now() })
    return { ok: true }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    await chrome.storage.local.set({ dictLastError: error })
    return { ok: false, error }
  }
}
