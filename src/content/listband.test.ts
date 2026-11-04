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
  artists: { stub_person: { ja: 'スタブ作画者' } },
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

    it('no lead without tags (sort and page size are visible on the switches)', () => {
      expect(band(run('https://www.sakugabooru.com/post')).querySelector('.bsb-lead')).toBeNull()
      expect(band(run('https://www.sakugabooru.com/post?limit=24')).querySelector('.bsb-lead')).toBeNull()
    })

    it('lead with tags is the translated names joined with ・, nothing else', () => {
      const lead = band(run('https://www.sakugabooru.com/post?tags=my_hero_academia+effects+order%3Ascore&limit=60')).querySelector('.bsb-lead')!
      expect(lead.textContent).toBe('スタブ作品・スタブ効果')
      expect(Array.from(lead.querySelectorAll('.bsb-lead-name')).map((n) => n.getAttribute('data-type'))).toEqual(['copyright', 'general'])
      const raw = band(run('https://www.sakugabooru.com/post?tags=kabukyuu')).querySelector('.bsb-lead')!.textContent
      expect(raw).toBe('kabukyuu')
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

    it('an artist name in the lead carries a 作画wiki link (new tab) to the page titled by the Japanese name', () => {
      const doc = run('https://www.sakugabooru.com/post?tags=stub_person+effects')
      const lead = doc.querySelector<HTMLElement>('.bsb-listband .bsb-lead')!
      const wiki = lead.querySelector<HTMLAnchorElement>('a.bsb-lead-wiki')!
      expect(wiki.previousElementSibling!.textContent).toBe('スタブ作画者')
      expect(wiki.getAttribute('href')).toBe('https://w.atwiki.jp/sakuga/?page=%E3%82%B9%E3%82%BF%E3%83%96%E4%BD%9C%E7%94%BB%E8%80%85')
      expect(wiki.getAttribute('target')).toBe('_blank')
      expect(wiki.getAttribute('rel')).toContain('noopener')
      expect(wiki.textContent).toBe('作画wiki')
      expect(wiki.getAttribute('title')).toBe('作画@wiki で「スタブ作画者」を開く')
      expect(lead.querySelectorAll('a.bsb-lead-wiki')).toHaveLength(1)
      // Never in the search chips; works and techniques have no wiki page by name; untranslated artists have no page title to use.
      expect(doc.querySelector('.bsb-qchip a')).toBeNull()
      expect(band(run('https://www.sakugabooru.com/post?tags=kabukyuu')).querySelector('a.bsb-lead-wiki')).toBeNull()
      expect(band(run('https://www.sakugabooru.com/post?tags=stub_person', { translateTags: false })).querySelector('a.bsb-lead-wiki')).toBeNull()
    })

    it('a pool:N token reads プール #N in the chip and the lead, with no romaji line', () => {
      const doc = run('https://www.sakugabooru.com/post?tags=pool%3A133+order%3Ascore')
      const chip = doc.querySelector<HTMLElement>('.bsb-listband .bsb-qchip')!
      expect(chip.dataset.tag).toBe('pool:133')
      expect(chip.querySelector('.bsb-qchip-ja')!.textContent).toBe('プール #133')
      expect(chip.querySelector('.bsb-qchip-en')).toBeNull()
      expect(band(doc).querySelector('.bsb-lead')!.textContent).toBe('プール #133')
      const named = run('https://www.sakugabooru.com/post?tags=pool%3Aboo_arc')
      expect(named.querySelector('.bsb-qchip-ja')!.textContent).toBe('プール「boo arc」')
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

describe('renderListBand in English mode', () => {
  const JP = /[぀-ヿ一-鿿]/
  const doc = (url: string) => load('post-list-2026-10-12.html', url)
  const en = (url: string) => {
    const d = doc(url)
    renderListBand(d, dict, { ...DEFAULTS, translateTags: true, showRomaji: true }, {}, {}, 'en')
    return d
  }

  it('title is exactly Posts with no deco text, English labels', () => {
    const b = band(en('https://www.sakugabooru.com/post'))
    expect(b.querySelector('h1')!.textContent).toBe('Posts')
    expect(b.querySelector('.bsb-en-title')).toBeNull()
    expect(Array.from(b.querySelectorAll('.bsb-sort a')).map((a) => a.textContent)).toEqual(['Newest', 'Score', 'Random'])
    expect(Array.from(b.querySelectorAll('.bsb-opt-label')).map((a) => a.textContent)).toEqual(['Sort', 'Per page'])
    expect(b.querySelector<HTMLInputElement>('#bsb-q')!.placeholder).toBe('Search artists, works, techniques')
    expect(b.textContent).not.toMatch(JP)
  })

  it('chips show the spaced tag, never the dictionary, no romaji line', () => {
    const b = band(en('https://www.sakugabooru.com/post?tags=my_hero_academia'))
    const chip = b.querySelector('.bsb-qchip')!
    expect(chip.querySelector('.bsb-qchip-ja')!.textContent).toBe('my hero academia')
    expect(chip.querySelector('.bsb-qchip-en')).toBeNull()
    expect(chip.querySelector('.bsb-qchip-x')!.getAttribute('aria-label')).toBe('Remove my hero academia')
    expect(b.querySelector('.bsb-lead')!.textContent).toContain('my hero academia')
    expect(b.textContent).not.toMatch(JP)
  })

  it('no wiki link beside artist names (no Japanese name to open), pool token reads Pool #N', () => {
    const b = band(en('https://www.sakugabooru.com/post?tags=stub_person+pool%3A7'))
    expect(b.querySelector('a.bsb-lead-wiki')).toBeNull()
    expect(b.querySelectorAll('.bsb-qchip')[1].querySelector('.bsb-qchip-ja')!.textContent).toBe('Pool #7')
    expect(b.querySelector('.bsb-lead')!.textContent).toBe('stub person, Pool #7')
    expect(b.textContent).not.toMatch(JP)
  })
})
