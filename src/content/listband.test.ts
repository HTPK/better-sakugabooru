import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { JSDOM, VirtualConsole } from 'jsdom'
import { renderListBand, sortUrl, limitUrl, queryTokens } from './listband'
import { DEFAULTS, type Settings } from '../settings'
import type { Dict } from '../dict'

const fixture = (name: string) => readFileSync(resolve(__dirname, '../../test/fixtures', name), 'utf8')
const FIXTURES = ['post-list-2026-10-12.html', 'post-list-ja-2026-10-12.html']

// Placeholder Japanese so tests never assert real translations.
const dict: Dict = {
  v: 1,
  updated: 'test',
  artists: {},
  copyrights: { my_hero_academia: { ja: 'スタブ作品' } },
  general: { effects: { ja: 'スタブ効果' } },
}

const load = (file: string, url: string) =>
  new JSDOM(fixture(file), { url, virtualConsole: new VirtualConsole() }).window.document
const band = (doc: Document) => doc.querySelector<HTMLElement>('.bsb-listband')!
const TAGGED = 'https://www.sakugabooru.com/post?tags=my_hero_academia+effects'

for (const file of FIXTURES) {
  describe(`renderListBand (${file})`, () => {
    const run = (url: string, patch: Partial<Settings> = {}, actions = {}) => {
      const doc = load(file, url)
      renderListBand(doc, dict, { ...DEFAULTS, ...patch }, actions)
      return doc
    }

    it('inserts the band at the top of #content with POSTS / 投稿一覧', () => {
      const doc = run('https://www.sakugabooru.com/post')
      const b = band(doc)
      expect(b.classList.contains('bsb-band')).toBe(true)
      expect(doc.getElementById('content')!.firstElementChild).toBe(b)
      expect(b.querySelector('.bsb-en-title')!.textContent).toBe('POSTS')
      expect(b.querySelector('h1')!.textContent).toBe('投稿一覧')
    })

    it('puts the search form in the title row (right end), sort and per page below', () => {
      const b = band(run('https://www.sakugabooru.com/post'))
      expect(b.querySelector('.bsb-listband-title > form.bsb-qform')).not.toBeNull()
      expect(b.querySelector('.bsb-listband-tools .bsb-qform')).toBeNull()
      expect(b.querySelector('.bsb-listband-tools .bsb-listopts')).not.toBeNull()
    })

    it('lead without tags uses the served page size (URL limit, else the site default 40)', () => {
      expect(band(run('https://www.sakugabooru.com/post')).querySelector('.bsb-lead')!.textContent).toBe(
        '新着を 1 ページに 40 件',
      )
      expect(band(run('https://www.sakugabooru.com/post?limit=24')).querySelector('.bsb-lead')!.textContent).toBe(
        '新着を 1 ページに 24 件',
      )
    })

    it('lead with tags joins the translated names with ・', () => {
      const lead = band(run(TAGGED + '&limit=60')).querySelector('.bsb-lead')!.textContent
      expect(lead).toBe('スタブ作品・スタブ効果の新着を 1 ページに 60 件')
      const raw = band(run('https://www.sakugabooru.com/post?tags=kabukyuu')).querySelector('.bsb-lead')!.textContent
      expect(raw).toBe('kabukyuuの新着を 1 ページに 40 件')
    })

    it('shows query tags as chips (ja + romaji) and keeps the text input empty', () => {
      const doc = run(TAGGED)
      const chips = Array.from(doc.querySelectorAll<HTMLElement>('.bsb-listband .bsb-qchip'))
      expect(chips.map((c) => c.dataset.tag)).toEqual(['my_hero_academia', 'effects'])
      expect(chips[0].querySelector('.bsb-qchip-ja')!.textContent).toBe('スタブ作品')
      expect(chips[0].querySelector('.bsb-qchip-en')!.textContent).toBe('my_hero_academia')
      const input = doc.querySelector<HTMLInputElement>('.bsb-listband input[name="tags"]')!
      expect(input.value).toBe('')
      expect(input.placeholder).toBe('作画者・作品・技法を日本語で')
      const form = input.form!
      expect(form.getAttribute('method')).toBe('get')
      expect(form.getAttribute('action')).toBe('/post')
    })

    it('submits chips + typed text as a single tags value; × removes a chip', () => {
      const doc = run(TAGGED + ' order:score')
      const form = doc.querySelector<HTMLFormElement>('.bsb-listband form')!
      const input = form.querySelector<HTMLInputElement>('input.bsb-qinput')!
      form.querySelector<HTMLButtonElement>('.bsb-qchip[data-tag="effects"] .bsb-qchip-x')!.click()
      expect(form.querySelectorAll('.bsb-qchip')).toHaveLength(1)
      input.value = 'kabukyuu '
      form.addEventListener('submit', (e) => e.preventDefault())
      form.dispatchEvent(new doc.defaultView!.Event('submit', { cancelable: true }))
      const data = new doc.defaultView!.FormData(form)
      expect(data.getAll('tags')).toEqual(['my_hero_academia order:score kabukyuu'])
    })

    it('restores the input name after submit so autocomplete keeps working on back', async () => {
      const doc = run(TAGGED)
      const form = doc.querySelector<HTMLFormElement>('.bsb-listband form')!
      form.addEventListener('submit', (e) => e.preventDefault())
      form.dispatchEvent(new doc.defaultView!.Event('submit', { cancelable: true }))
      await new Promise((r) => setTimeout(r, 0))
      expect(form.querySelector('input.bsb-qinput')!.getAttribute('name')).toBe('tags')
      expect(form.querySelector('input[type="hidden"]')!.hasAttribute('name')).toBe(false)
    })

    it('Backspace in an empty input removes the last chip', () => {
      const doc = run(TAGGED)
      const input = doc.querySelector<HTMLInputElement>('.bsb-listband input.bsb-qinput')!
      input.dispatchEvent(new doc.defaultView!.KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }))
      expect(Array.from(doc.querySelectorAll<HTMLElement>('.bsb-qchip')).map((c) => c.dataset.tag)).toEqual([
        'my_hero_academia',
      ])
    })

    it('sort links rewrite order: in tags and mark the active one', () => {
      const doc = run(TAGGED + ' order:score&page=3')
      const links = Array.from(doc.querySelectorAll<HTMLAnchorElement>('.bsb-sort a'))
      expect(links.map((a) => a.textContent)).toEqual(['新着', 'スコア', 'ランダム'])
      const tagsOf = (a: HTMLAnchorElement) => new URL(a.getAttribute('href')!, 'https://x/').searchParams
      expect(tagsOf(links[0]).get('tags')).toBe('my_hero_academia effects')
      expect(tagsOf(links[1]).get('tags')).toBe('my_hero_academia effects order:score')
      expect(tagsOf(links[2]).get('tags')).toBe('my_hero_academia effects order:random')
      expect(tagsOf(links[2]).get('page')).toBeNull()
      expect(links.map((a) => a.classList.contains('bsb-on'))).toEqual([false, true, false])
      expect(links[1].getAttribute('aria-current')).toBe('true')
    })

    it('per-page buttons save the setting, then navigate with limit', async () => {
      const saveSettings = vi.fn(async () => {})
      const navigate = vi.fn()
      const doc = run(TAGGED + '&page=2', {}, { saveSettings, navigate })
      const btns = Array.from(doc.querySelectorAll<HTMLButtonElement>('.bsb-perpage button'))
      expect(btns.map((b) => b.textContent)).toEqual(['24', '40', '60', '100'])
      expect(btns.map((b) => b.classList.contains('bsb-on'))).toEqual([false, true, false, false])
      btns[2].click()
      await vi.waitFor(() => expect(navigate).toHaveBeenCalledTimes(1))
      expect(saveSettings).toHaveBeenCalledWith({ perPage: 60 })
      const u = new URL(navigate.mock.calls[0][0] as string, 'https://x/')
      expect(u.searchParams.get('limit')).toBe('60')
      expect(u.searchParams.get('tags')).toBe('my_hero_academia effects')
      expect(u.searchParams.get('page')).toBeNull()
    })

    it('hides the site sidebar search form but keeps it in the DOM', () => {
      const doc = run('https://www.sakugabooru.com/post')
      const site = doc.getElementById('tags')!
      expect(site.closest('.bsb-hide')).not.toBeNull()
    })

    it('is idempotent', () => {
      const doc = run(TAGGED)
      renderListBand(doc, dict, DEFAULTS)
      expect(doc.querySelectorAll('.bsb-listband')).toHaveLength(1)
    })
  })
}

describe('url helpers', () => {
  it('queryTokens splits tags', () => {
    expect(queryTokens(new URL('https://x/post?tags=a+b%20%20c'))).toEqual(['a', 'b', 'c'])
    expect(queryTokens(new URL('https://x/post'))).toEqual([])
  })
  it('sortUrl drops tags when nothing remains', () => {
    expect(new URL(sortUrl('https://x/post?tags=order:random', 'new'), 'https://x/').searchParams.has('tags')).toBe(false)
  })
  it('limitUrl keeps other params', () => {
    const u = new URL(limitUrl('https://x/post?tags=a&page=4', 100), 'https://x/')
    expect(u.searchParams.get('tags')).toBe('a')
    expect(u.searchParams.get('limit')).toBe('100')
    expect(u.searchParams.has('page')).toBe(false)
  })
})
