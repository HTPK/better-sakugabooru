import { normalizeJa } from './kana'
import snapshot from './snapshot.json'

export type TagType = 'artist' | 'copyright' | 'general' | 'character' | 'meta' | 'circle' | 'faults'
export interface Entry {
  ja: string
  kana?: string
  src?: string
}
export interface Dict {
  v: 1
  updated: string
  artists: Record<string, Entry>
  copyrights: Record<string, Entry>
  general: Record<string, Entry>
  counts?: Record<string, number>
}
export interface Lookup {
  tag: string
  type: TagType
  ja: string | null
  kana?: string
}
export interface Suggestion {
  tag: string
  type: TagType
  ja: string
  kana?: string
  count: number
}
export interface ReverseIndex {
  keys: Array<{ key: string; tag: string; type: TagType; ja: string; kana?: string; count: number }>
}

const own = (o: Record<string, Entry>, k: string): Entry | undefined =>
  Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined

export function lookup(dict: Dict, tag: string, type: TagType): Lookup {
  const map = type === 'artist' ? dict.artists : type === 'copyright' ? dict.copyrights : dict.general
  const hit = own(map, tag)
  if (hit) return { tag, type, ja: hit.ja, kana: hit.kana }
  if (tag.endsWith('_series')) {
    const base = own(map, tag.slice(0, -'_series'.length))
    if (base) return { tag, type, ja: base.ja + ' シリーズ' }
  }
  return { tag, type, ja: null }
}

export function displayName(l: Lookup): string {
  return l.ja ?? l.tag
}

export function buildReverseIndex(dict: Dict): ReverseIndex {
  const keys: ReverseIndex['keys'] = []
  const add = (map: Record<string, Entry>, type: TagType) => {
    for (const [tag, e] of Object.entries(map)) {
      const count = dict.counts?.[tag] ?? 0
      const base = { tag, type, ja: e.ja, kana: e.kana, count }
      keys.push({ ...base, key: normalizeJa(e.ja) })
      if (e.kana) keys.push({ ...base, key: normalizeJa(e.kana) })
      keys.push({ ...base, key: tag.toLowerCase() })
    }
  }
  add(dict.artists, 'artist')
  add(dict.copyrights, 'copyright')
  add(dict.general, 'general')
  return { keys }
}

export function suggest(index: ReverseIndex, query: string, limit = 8): Suggestion[] {
  const q = normalizeJa(query)
  if (!q) return []
  const best = new Map<string, { rank: number; k: ReverseIndex['keys'][number] }>()
  for (const k of index.keys) {
    const pos = k.key.indexOf(q)
    if (pos < 0) continue
    const rank = pos === 0 ? 0 : 1
    const id = `${k.type}:${k.tag}`
    const prev = best.get(id)
    if (!prev || rank < prev.rank) best.set(id, { rank, k })
  }
  return [...best.values()]
    .sort((a, b) => a.rank - b.rank || b.k.count - a.k.count || a.k.tag.localeCompare(b.k.tag))
    .slice(0, limit)
    .map(({ k }) => ({ tag: k.tag, type: k.type, ja: k.ja, kana: k.kana, count: k.count }))
}

export function validateDict(x: unknown): x is Dict {
  if (!x || typeof x !== 'object') return false
  const d = x as Record<string, unknown>
  const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
  const optStr = (v: unknown) => v === undefined || typeof v === 'string'
  const isEntry = (e: unknown) =>
    isObj(e) && typeof e.ja === 'string' && e.ja.length > 0 && optStr(e.kana) && optStr(e.src)
  const isMap = (m: unknown) => isObj(m) && Object.values(m).every(isEntry)
  const countsOk =
    d.counts === undefined ||
    (isObj(d.counts) && Object.values(d.counts).every((n) => typeof n === 'number' && Number.isFinite(n)))
  return (
    d.v === 1 &&
    typeof d.updated === 'string' &&
    isMap(d.artists) &&
    isMap(d.copyrights) &&
    isMap(d.general) &&
    countsOk
  )
}

export async function getDict(): Promise<Dict> {
  const r = await chrome.storage.local.get('dict')
  return validateDict(r.dict) ? r.dict : (snapshot as Dict)
}
