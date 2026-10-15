import { describe, it, expect } from 'vitest'
import { JSDOM } from 'jsdom'
import { attachProposeClick, proposeUrl, untranslatedMark } from './propose'

const setup = (url: string) => {
  const doc = new JSDOM('<a id="tag" href="/post?tags=foo_bar">foo_bar</a>', { url }).window.document
  const link = doc.getElementById('tag')!
  const mark = untranslatedMark(doc, 'foo_bar')
  link.append(mark)
  const opened: string[] = []
  attachProposeClick(doc, (u) => opened.push(u))
  return { doc, link, mark, opened }
}

describe('proposeUrl', () => {
  it('prefills title, label and tags, and the post only when given', () => {
    const u = new URL(proposeUrl(['a_b', 'c'], 'https://www.sakugabooru.com/post/show/1'))
    expect(u.origin + u.pathname).toBe('https://github.com/HTPK/better-sakugabooru/issues/new')
    expect(u.searchParams.get('template')).toBe('translation.yml')
    expect(u.searchParams.get('title')).toBe('翻訳提案: a_b, c')
    expect(u.searchParams.get('labels')).toBe('translation')
    expect(u.searchParams.get('tags')).toBe('a_b\nc')
    expect(u.searchParams.get('post')).toBe('https://www.sakugabooru.com/post/show/1')
    expect(new URL(proposeUrl(['a'])).searchParams.has('post')).toBe(false)
  })
})

describe('untranslated mark click', () => {
  it('opens the proposal for that one tag instead of following the tag link', () => {
    const { doc, link, mark, opened } = setup('https://www.sakugabooru.com/post/show/42/foo?x=1')
    let followed = false
    link.addEventListener('click', (e) => {
      followed = !e.defaultPrevented
    })
    mark.dispatchEvent(new doc.defaultView!.MouseEvent('click', { bubbles: true, button: 0 }))
    expect(opened).toHaveLength(1)
    const u = new URL(opened[0])
    expect(u.searchParams.get('tags')).toBe('foo_bar')
    expect(u.searchParams.get('post')).toBe('https://www.sakugabooru.com/post/show/42/foo')
    expect(followed).toBe(false)
  })

  it('leaves the post field empty on list pages and ignores clicks elsewhere in the link', () => {
    const { doc, link, mark, opened } = setup('https://www.sakugabooru.com/post?tags=x')
    link.dispatchEvent(new doc.defaultView!.MouseEvent('click', { bubbles: true, button: 0 }))
    expect(opened).toHaveLength(0)
    mark.dispatchEvent(new doc.defaultView!.MouseEvent('click', { bubbles: true, button: 0 }))
    expect(new URL(opened[0]).searchParams.has('post')).toBe(false)
  })

  it('carries the tag and a tooltip', () => {
    const { mark } = setup('https://www.sakugabooru.com/post')
    expect(mark.textContent).toBe('未訳')
    expect(mark.dataset.tag).toBe('foo_bar')
    expect(mark.title).toContain('foo_bar')
  })
})
