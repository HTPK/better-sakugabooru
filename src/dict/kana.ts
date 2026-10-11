/** NFKC -> katakana to hiragana -> drop whitespace and long-vowel mark -> lowercase. */
export function normalizeJa(s: string): string {
  let out = ''
  for (const ch of s.normalize('NFKC')) {
    const c = ch.codePointAt(0)!
    out += c >= 0x30a1 && c <= 0x30f6 ? String.fromCodePoint(c - 0x60) : ch
  }
  return out.replace(/[\s　ー]/g, '').toLowerCase()
}
