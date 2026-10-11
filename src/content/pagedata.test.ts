import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { JSDOM } from 'jsdom'
import { extractJsonObjects, parsePosts } from './pagedata'

const FIXTURE = resolve(__dirname, '../../test/fixtures/post-list-2026-10-12.html')

describe('extractJsonObjects', () => {
  it('extracts balanced objects ignoring braces inside strings and escapes', () => {
    const text =
      'Post.register({"id":1,"source":"a } b { \\" }"});\nPost.register({"id":2,"o":{"x":"}"}})\nfoo({"no":1})'
    const out = extractJsonObjects(text, 'Post.register')
    expect(out).toHaveLength(2)
    expect(JSON.parse(out[0])).toEqual({ id: 1, source: 'a } b { " }' })
    expect(JSON.parse(out[1])).toEqual({ id: 2, o: { x: '}' } })
  })

  it('does not match a longer prefix (register_tags vs register)', () => {
    const out = extractJsonObjects('Post.register_tags({"a":"general"})', 'Post.register')
    expect(out).toEqual([])
  })

  it('skips unbalanced input', () => {
    expect(extractJsonObjects('Post.register({"id":1', 'Post.register')).toEqual([])
  })
})

describe('parsePosts', () => {
  const html = readFileSync(FIXTURE, 'utf8')
  const doc = new JSDOM(html).window.document
  const { posts, tagTypes } = parsePosts(doc)

  it('parses all 40 posts from the fixture', () => {
    expect(posts).toHaveLength(40)
  })

  it('maps fields of the first post', () => {
    const p = posts[0]
    expect(p.id).toBe(318841)
    expect(p.score).toBe(9)
    expect(p.fileUrl.endsWith('.mp4')).toBe(true)
    expect(p.tags).toContain('shuuichiro_manabe')
    expect(p.createdAt).toBe(1791735834)
    expect(p.author).toBe('BakaManiaHD')
    expect(p.source).toBe('#01')
    expect(p.width).toBe(854)
    expect(p.height).toBe(480)
    expect(p.fileSize).toBe(25062936)
    expect(p.rating).toBe('s')
    expect(p.parentId).toBeNull()
    expect(p.hasChildren).toBe(false)
    expect(p.previewUrl).toMatch(/\/preview\/.*\.jpg$/)
  })

  it('reads tag types', () => {
    expect(tagTypes['shuu_sugita']).toBe('artist')
    expect(tagTypes['presumed']).toBe('meta')
    expect(tagTypes['effects']).toBe('general')
  })

  it('defaults unknown tag types to general and splits several posts per script', () => {
    const d = new JSDOM(
      '<script>Post.register({"id":5,"tags":" a  b ","score":1,"created_at":2,"author":"x","source":" s ","preview_url":"p","file_url":"f","width":1,"height":2,"file_size":3,"rating":"s","parent_id":4,"has_children":true});\nPost.register({"id":6,"tags":"c"})\nPost.register_tags({"a":"weird","b":"artist"})</script>',
    ).window.document
    const r = parsePosts(d)
    expect(r.posts.map((p) => p.id)).toEqual([5, 6])
    expect(r.posts[0].tags).toEqual(['a', 'b'])
    expect(r.posts[0].source).toBe('s')
    expect(r.posts[0].parentId).toBe(4)
    expect(r.posts[0].hasChildren).toBe(true)
    expect(r.posts[1].parentId).toBeNull()
    expect(r.tagTypes).toEqual({ a: 'general', b: 'artist' })
  })
})
