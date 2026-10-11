import { describe, it, expect } from 'vitest'
import snapshot from './snapshot.json'
import { lookup, displayName, buildReverseIndex, suggest, getDict, validateDict, sanitizeDict, type Dict } from './index'
import { normalizeJa } from './kana'

const dict = snapshot as Dict

describe('normalizeJa', () => {
  it('folds katakana, width, spaces, long vowel marks and case', () => {
    expect(normalizeJa('カナダ ヨシノリ')).toBe('かなだよしのり')
    expect(normalizeJa('ＡＢＣ')).toBe('abc')
    expect(normalizeJa('スーパー')).toBe('すぱ')
  })
})

describe('lookup', () => {
  it('routes by tag type', () => {
    expect(lookup(dict, 'yoshinori_kanada', 'artist')).toMatchObject({ ja: '金田伊功', kana: 'かなだ よしのり' })
    expect(lookup(dict, 'my_hero_academia', 'copyright').ja).toBe('僕のヒーローアカデミア')
    expect(lookup(dict, 'effects', 'general').ja).toBe('エフェクト')
    expect(lookup(dict, 'effects', 'meta').ja).toBe('エフェクト')
  })
  it('returns null ja for unknown tags and falls back to tag in displayName', () => {
    const l = lookup(dict, 'nobody', 'artist')
    expect(l.ja).toBeNull()
    expect(displayName(l)).toBe('nobody')
    expect(displayName(lookup(dict, 'effects', 'general'))).toBe('エフェクト')
  })
  it('does not cross maps (artist name is not a copyright)', () => {
    expect(lookup(dict, 'yoshinori_kanada', 'copyright').ja).toBeNull()
  })
  it('falls back from foo_series to foo', () => {
    expect(lookup(dict, 'my_hero_academia_series', 'copyright').ja).toBe('僕のヒーローアカデミア シリーズ')
  })
})

describe('suggest', () => {
  const idx = buildReverseIndex(dict)
  it('matches kana prefix', () => {
    expect(suggest(idx, 'かなだ').map((s) => s.tag)).toEqual(['yoshinori_kanada'])
  })
  it('matches katakana query', () => {
    expect(suggest(idx, 'カナダ').map((s) => s.tag)).toContain('yoshinori_kanada')
  })
  it('sorts prefix group by count desc', () => {
    expect(suggest(idx, '金田').map((s) => s.tag)).toEqual([
      'kanada_light_flare',
      'yoshinori_kanada',
      'kanada_dragon',
    ])
  })
  it('matches romaji tag prefix first, then substring', () => {
    expect(suggest(idx, 'kanada').map((s) => s.tag)).toEqual([
      'kanada_light_flare',
      'kanada_dragon',
      'yoshinori_kanada',
    ])
  })
  it('respects limit, dedupes, and returns fields', () => {
    expect(suggest(idx, 'a', 2)).toHaveLength(2)
    const s = suggest(idx, 'すぎた')[0]
    // Count comes from the synced snapshot, so read it rather than hard-coding a number.
    const count = dict.counts?.shuu_sugita ?? 0
    expect(s).toEqual({ tag: 'shuu_sugita', type: 'artist', ja: '杉田柊', kana: 'すぎた しゅう', count })
    const tags = suggest(idx, 'k', 50).map((x) => x.tag)
    expect(new Set(tags).size).toBe(tags.length)
  })
  it('returns nothing for empty query', () => {
    expect(suggest(idx, '  ')).toEqual([])
  })
})

describe('reverse index hardening', () => {
  const mk = (over: Partial<Dict>): Dict => ({ v: 1, updated: 'x', artists: {}, copyrights: {}, general: {}, ...over })
  it('matches multi-word English input against underscored tags', () => {
    const d = mk({ copyrights: { dragon_ball: { ja: 'ドラゴンボール' } } })
    const idx = buildReverseIndex(d)
    expect(suggest(idx, 'dragon ball').map((s) => s.tag)).toEqual(['dragon_ball'])
    expect(suggest(idx, 'Dragon Ba').map((s) => s.tag)).toEqual(['dragon_ball'])
    expect(suggest(idx, 'dragon_ball').map((s) => s.tag)).toEqual(['dragon_ball'])
  })
  it('does not read counts from the prototype chain', () => {
    const d = mk({ general: JSON.parse('{"constructor":{"ja":"x"},"__proto__":{"ja":"y"}}'), counts: {} })
    const out = suggest(buildReverseIndex(d), 'x')
    expect(out.find((s) => s.tag === 'constructor')?.count).toBe(0)
    const p = suggest(buildReverseIndex(d), 'y')
    expect(p.map((s) => s.tag)).toEqual(['__proto__'])
    expect(p[0].count).toBe(0)
  })
  it('memoises the index per dict object', () => {
    const d = mk({ artists: { a_b: { ja: 'あ' } } })
    expect(buildReverseIndex(d)).toBe(buildReverseIndex(d))
    expect(buildReverseIndex(mk({}))).not.toBe(buildReverseIndex(d))
  })
})

describe('getDict / validateDict', () => {
  it('validates shape', () => {
    expect(validateDict(dict)).toBe(true)
    expect(validateDict({ v: 2 })).toBe(false)
    expect(validateDict(null)).toBe(false)
    expect(validateDict({ v: 1, updated: 'x', artists: {}, copyrights: {} })).toBe(false)
  })
  it('validates entry shape', () => {
    const base = { v: 1, updated: 'x', artists: {}, copyrights: {}, general: {} }
    expect(validateDict({ ...base, artists: { a: {} } })).toBe(false)
    expect(validateDict({ ...base, general: { x: 5 } })).toBe(false)
    expect(validateDict({ ...base, copyrights: { c: { ja: '' } } })).toBe(false)
    expect(validateDict({ ...base, artists: { a: { ja: 'あ', kana: 1 } } })).toBe(false)
    expect(validateDict({ ...base, artists: { a: { ja: 'あ', src: 2 } } })).toBe(false)
    expect(validateDict({ ...base, counts: { a: 'many' } })).toBe(false)
    expect(validateDict({ ...base, counts: [] })).toBe(false)
    expect(validateDict({ ...base, artists: { a: { ja: 'あ', kana: 'あ', src: 'wiki' } }, counts: { a: 3 } })).toBe(true)
  })
  it('sanitizeDict drops bad entries and keeps the rest', () => {
    const base = { v: 1, updated: 'x', artists: {}, copyrights: {}, general: {} }
    const out = sanitizeDict({
      ...base,
      artists: {
        ok: { ja: 'あ', kana: 'あ', src: 'wiki' },
        empty: { ja: '' },
        num: { ja: 5 },
        notobj: 'x',
        long: { ja: 'あ'.repeat(81) },
        max: { ja: 'あ'.repeat(80) },
        nl: { ja: 'a\nb' },
        del: { ja: 'a\u007fb' },
        lrm: { ja: 'a‎b' },
        rlo: { ja: 'a‮b' },
        iso: { ja: 'a⁨b' },
        badkana: { ja: 'あ', kana: 1 },
        badsrc: { ja: 'あ', src: {} },
      },
      general: { g: { ja: 'ぐ' } },
      counts: { ok: 3, bad: 'x', inf: Infinity },
    })
    expect(out).not.toBeNull()
    expect(Object.keys(out!.artists).sort()).toEqual(['max', 'ok'])
    expect(out!.artists.ok).toEqual({ ja: 'あ', kana: 'あ', src: 'wiki' })
    expect(out!.general).toEqual({ g: { ja: 'ぐ' } })
    expect(out!.counts).toEqual({ ok: 3 })
    expect(validateDict(out)).toBe(true)
  })

  it('sanitizeDict returns null only for a wrong top-level shape', () => {
    const base = { v: 1, updated: 'x', artists: {}, copyrights: {}, general: {} }
    expect(sanitizeDict(base)).toEqual(base)
    expect(sanitizeDict(null)).toBeNull()
    expect(sanitizeDict([])).toBeNull()
    expect(sanitizeDict({ ...base, v: 2 })).toBeNull()
    expect(sanitizeDict({ ...base, updated: 3 })).toBeNull()
    expect(sanitizeDict({ ...base, general: [] })).toBeNull()
    expect(sanitizeDict({ ...base, copyrights: undefined })).toBeNull()
    expect(sanitizeDict({ ...base, counts: [] })).toBeNull()
  })

  it('sanitizeDict drops __proto__ keys instead of setting a prototype', () => {
    const raw = JSON.parse('{"v":1,"updated":"x","artists":{"__proto__":{"ja":"x"}},"copyrights":{},"general":{}}')
    const out = sanitizeDict(raw)!
    expect(Object.getPrototypeOf(out.artists)).toBe(Object.prototype)
    expect(Object.hasOwn(out.artists, '__proto__')).toBe(false)
    expect(Object.keys(out.artists)).toEqual([])
  })

  it('falls back to snapshot when storage is empty or invalid', async () => {
    expect((await getDict()).updated).toBe('2026-10-12')
    await chrome.storage.local.set({ dict: { v: 9 } })
    expect((await getDict()).artists).toHaveProperty('yoshinori_kanada')
  })
  it('prefers a valid stored dict', async () => {
    const stored = { v: 1, updated: '2030-01-01', artists: {}, copyrights: {}, general: {} }
    await chrome.storage.local.set({ dict: stored })
    expect((await getDict()).updated).toBe('2030-01-01')
  })
})
