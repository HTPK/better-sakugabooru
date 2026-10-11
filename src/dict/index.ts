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

function countOf(dict: Dict, tag: string): number {
  const c = dict.counts
  if (!c || !Object.prototype.hasOwnProperty.call(c, tag)) return 0
  const n = c[tag]
  return typeof n === 'number' && Number.isFinite(n) ? n : 0
}

const indexCache = new WeakMap<Dict, ReverseIndex>()

/** Built once per dict object (memoised). */
export function buildReverseIndex(dict: Dict): ReverseIndex {
  const cached = indexCache.get(dict)
  if (cached) return cached
  const keys: ReverseIndex['keys'] = []
  const add = (map: Record<string, Entry>, type: TagType) => {
    for (const [tag, e] of Object.entries(map)) {
      const base = { tag, type, ja: e.ja, kana: e.kana, count: countOf(dict, tag) }
      keys.push({ ...base, key: normalizeJa(e.ja) })
      if (e.kana) keys.push({ ...base, key: normalizeJa(e.kana) })
      const en = tag.toLowerCase()
      keys.push({ ...base, key: en })
      // Spaces are dropped by normalizeJa, so "dragon ball" must also hit "dragonball".
      const joined = en.replace(/_/g, '')
      if (joined !== en) keys.push({ ...base, key: joined })
    }
  }
  add(dict.artists, 'artist')
  add(dict.copyrights, 'copyright')
  add(dict.general, 'general')
  const index = { keys }
  indexCache.set(dict, index)
  return index
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

const JA_MAX = 80
/** C0 controls, DEL, LRM/RLM, bidi embeddings/overrides and isolates: they could reorder or hide page text. */
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARS = /[\u0000-\u001f\u007f‎‏‪-‮⁦-⁩]/

const isPlainObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

function cleanEntry(e: unknown): Entry | null {
  if (!isPlainObj(e)) return null
  const { ja, kana, src } = e
  if (typeof ja !== 'string' || !ja || ja.length > JA_MAX || UNSAFE_CHARS.test(ja)) return null
  if (kana !== undefined && (typeof kana !== 'string' || UNSAFE_CHARS.test(kana))) return null
  if (src !== undefined && typeof src !== 'string') return null
  const out: Entry = { ja }
  if (kana !== undefined) out.kana = kana
  if (src !== undefined) out.src = src
  return out
}

function cleanMap<T>(m: Record<string, unknown>, clean: (v: unknown) => T | null): Record<string, T> {
  const out: Record<string, T> = {}
  for (const [k, v] of Object.entries(m)) {
    // Assigning "__proto__" would set the prototype instead of adding a key.
    if (k === '__proto__') continue
    const c = clean(v)
    if (c !== null) out[k] = c
  }
  return out
}

/**
 * For freshly fetched dictionaries: drops individual bad entries (empty/over-long `ja`, control or
 * bidi characters, wrong field types) and keeps the rest. Null only if the top-level shape is wrong.
 */
export function sanitizeDict(raw: unknown): Dict | null {
  if (!isPlainObj(raw) || raw.v !== 1 || typeof raw.updated !== 'string') return null
  const { artists, copyrights, general, counts } = raw
  if (!isPlainObj(artists) || !isPlainObj(copyrights) || !isPlainObj(general)) return null
  if (counts !== undefined && !isPlainObj(counts)) return null
  const dict: Dict = {
    v: 1,
    updated: raw.updated,
    artists: cleanMap(artists, cleanEntry),
    copyrights: cleanMap(copyrights, cleanEntry),
    general: cleanMap(general, cleanEntry),
  }
  if (counts !== undefined) {
    dict.counts = cleanMap(counts, (n) => (typeof n === 'number' && Number.isFinite(n) ? n : null))
  }
  return dict
}

export async function getDict(): Promise<Dict> {
  const r = await chrome.storage.local.get('dict')
  return validateDict(r.dict) ? r.dict : (snapshot as Dict)
}
