import type { TagType } from '../dict'

export interface Post {
  id: number
  tags: string[]
  score: number
  createdAt: number
  author: string
  source: string
  previewUrl: string
  fileUrl: string
  width: number
  height: number
  fileSize: number
  rating: string
  parentId: number | null
  hasChildren: boolean
}

const TAG_TYPES: readonly TagType[] = ['artist', 'copyright', 'general', 'character', 'meta', 'circle', 'faults']

/** Returns the balanced `{...}` text starting at `start` (which must be `{`), or null if unbalanced. */
function balancedObject(text: string, start: number): string | null {
  let depth = 0
  let inStr = false
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (inStr) {
      if (c === '\\') i++
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') inStr = true
    else if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

/** All balanced `{...}` objects that directly follow each `prefix(` occurrence. */
export function extractJsonObjects(text: string, prefix: string): string[] {
  const needle = prefix + '('
  const out: string[] = []
  let from = 0
  for (;;) {
    const at = text.indexOf(needle, from)
    if (at < 0) break
    let j = at + needle.length
    while (j < text.length && /\s/.test(text[j])) j++
    from = at + needle.length
    if (text[j] !== '{') continue
    const obj = balancedObject(text, j)
    // Unbalanced: the rest of the text is inside it, so rescanning would only be quadratic work.
    if (!obj) break
    out.push(obj)
    from = j + obj.length
  }
  return out
}

function tryParse(s: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(s)
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

function toPost(r: Record<string, unknown>): Post {
  return {
    id: num(r.id),
    tags: str(r.tags).split(/\s+/).filter(Boolean),
    score: num(r.score),
    createdAt: num(r.created_at),
    author: str(r.author),
    source: str(r.source).trim(),
    previewUrl: str(r.preview_url),
    fileUrl: str(r.file_url),
    width: num(r.width),
    height: num(r.height),
    fileSize: num(r.file_size),
    rating: str(r.rating),
    parentId: typeof r.parent_id === 'number' ? r.parent_id : null,
    hasChildren: r.has_children === true,
  }
}

/**
 * The user's blacklist as the site holds it: `<script id="user-blacklisted-tags">` with a JSON
 * array of strings, each a space-separated conjunction (Moebooru's Post.init_blacklisted reads it).
 */
export function readBlacklist(doc: Document): string[][] {
  const el = doc.getElementById('user-blacklisted-tags')
  if (!el) return []
  let raw: unknown
  try {
    raw = JSON.parse(el.textContent ?? '')
  } catch {
    return []
  }
  if (!Array.isArray(raw)) return []
  return raw
    .filter((e): e is string => typeof e === 'string')
    .map((e) => e.split(/\s+/).filter(Boolean))
    .filter((terms) => terms.length > 0)
}

/** Moebooru semantics: an entry hides a post when all its terms match (`-tag` negates, `rating:x` uses the first letter). */
export function isBlacklisted(post: Post, entries: string[][]): boolean {
  if (!entries.length) return false
  const have = new Set(post.tags)
  if (post.rating) have.add(`rating:${post.rating.charAt(0)}`)
  const has = (term: string) => {
    const m = /^rating:(.)/.exec(term)
    return have.has(m ? `rating:${m[1]}` : term)
  }
  return entries.some((terms) => {
    const pos = terms.filter((t) => !t.startsWith('-'))
    if (!pos.length) return false
    return pos.every(has) && terms.every((t) => !t.startsWith('-') || !has(t.slice(1)))
  })
}

export function parsePosts(doc: Document): { posts: Post[]; tagTypes: Record<string, TagType> } {
  const posts: Post[] = []
  const seen = new Set<number>()
  const tagTypes: Record<string, TagType> = Object.create(null)
  for (const script of Array.from(doc.scripts)) {
    const text = script.textContent ?? ''
    if (!text.includes('Post.register')) continue
    for (const s of extractJsonObjects(text, 'Post.register')) {
      const r = tryParse(s)
      if (!r || typeof r.id !== 'number' || seen.has(r.id)) continue
      seen.add(r.id)
      posts.push(toPost(r))
    }
    for (const s of extractJsonObjects(text, 'Post.register_tags')) {
      const r = tryParse(s)
      if (!r) continue
      for (const [tag, type] of Object.entries(r)) {
        tagTypes[tag] = TAG_TYPES.includes(type as TagType) ? (type as TagType) : 'general'
      }
    }
  }
  return { posts, tagTypes }
}
