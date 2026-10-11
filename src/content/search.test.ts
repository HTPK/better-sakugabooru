import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { attachSearch } from './search'
import { DEFAULTS } from '../settings'
import type { Dict } from '../dict'

const dict: Dict = {
  v: 1,
  updated: '2026-10-12',
  artists: {
    yoshinori_kanada: { ja: '金田伊功', kana: 'かなだ よしのり' },
    taro_kanada: { ja: '金田太郎', kana: 'かなだ たろう' },
    hanako_kanada: { ja: '金田花子', kana: 'かなだ はなこ' },
  },
  copyrights: { dragon_ball: { ja: 'ドラゴンボール' } },
  general: {},
  counts: { yoshinori_kanada: 926, taro_kanada: 20, hanako_kanada: 5 },
}

let input: HTMLInputElement
let detach: () => void = () => {}

function type(value: string): Event {
  input.value = value
  input.setSelectionRange(value.length, value.length)
  const e = new Event('input', { bubbles: true })
  input.dispatchEvent(e)
  return e
}
const key = (k: string, init: KeyboardEventInit = {}) => {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init })
  input.dispatchEvent(e)
  return e
}
const box = () => document.querySelector<HTMLElement>('.bsb-suggest')
const rows = () => Array.from(document.querySelectorAll<HTMLElement>('.bsb-suggest .bsb-sg'))
const visible = () => !!box() && !box()!.hidden

beforeEach(() => {
  document.head.innerHTML = ''
  document.body.innerHTML = '<form><input type="text" name="tags" id="tags"></form>'
  input = document.querySelector('input')!
})
afterEach(() => detach())

describe('attachSearch', () => {
  it('renders rows for a kana token ordered by count', () => {
    detach = attachSearch(document, dict, DEFAULTS)
    type('かなだ')
    expect(visible()).toBe(true)
    expect(box()!.getAttribute('role')).toBe('listbox')
    const r = rows()
    expect(r.map((x) => x.dataset.tag)).toEqual(['yoshinori_kanada', 'taro_kanada', 'hanako_kanada'])
    expect(r[0].getAttribute('role')).toBe('option')
    expect(r[0].dataset.type).toBe('artist')
    expect(r[0].querySelector('.bsb-sg-ja')!.textContent).toBe('金田伊功')
    expect(r[0].querySelector('.bsb-sg-romaji')!.textContent).toBe('yoshinori kanada')
    expect(r[0].querySelector('.bsb-sg-kana')!.textContent).toBe('かなだ よしのり')
    expect(r[0].querySelector('.bsb-sg-count')!.textContent).toBe('926')
    expect(document.getElementById('bsb-search')).not.toBeNull()
  })

  it('uses only the last token and omits count when absent', () => {
    detach = attachSearch(document, dict, DEFAULTS)
    type('sakuga どらごん')
    expect(rows().map((x) => x.dataset.tag)).toEqual(['dragon_ball'])
    expect(rows()[0].querySelector('.bsb-sg-count')).toBeNull()
  })

  it('ArrowDown + Enter inserts the top tag and hides', () => {
    detach = attachSearch(document, dict, DEFAULTS)
    type('animated かなだ')
    key('ArrowDown')
    expect(rows()[0].getAttribute('aria-selected')).toBe('true')
    const enter = key('Enter')
    expect(enter.defaultPrevented).toBe(true)
    expect(input.value).toBe('animated yoshinori_kanada ')
    expect(input.selectionStart).toBe(input.value.length)
    expect(visible()).toBe(false)
  })

  it('ArrowUp wraps and Enter without selection does nothing', () => {
    detach = attachSearch(document, dict, DEFAULTS)
    type('かなだ')
    expect(key('Enter').defaultPrevented).toBe(false)
    expect(input.value).toBe('かなだ')
    key('ArrowUp')
    expect(rows()[2].getAttribute('aria-selected')).toBe('true')
  })

  it('ignores keys while an IME is composing', () => {
    detach = attachSearch(document, dict, DEFAULTS)
    type('かなだ')
    key('ArrowDown')
    key('Enter', { isComposing: true })
    expect(input.value).toBe('かなだ')
  })

  it('mousedown on a row inserts', () => {
    detach = attachSearch(document, dict, DEFAULTS)
    type('かなだ')
    const md = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    rows()[1].querySelector('.bsb-sg-ja')!.dispatchEvent(md)
    expect(md.defaultPrevented).toBe(true)
    expect(input.value).toBe('taro_kanada ')
    expect(visible()).toBe(false)
  })

  it('Esc hides', () => {
    detach = attachSearch(document, dict, DEFAULTS)
    type('かなだ')
    key('Escape')
    expect(visible()).toBe(false)
  })

  it('ASCII token with no hits renders nothing, short ASCII is ignored', () => {
    detach = attachSearch(document, dict, DEFAULTS)
    type('ef')
    expect(visible()).toBe(false)
    type('k')
    expect(visible()).toBe(false)
  })

  it('finds multi-word English through the English key', () => {
    detach = attachSearch(document, dict, DEFAULTS)
    type('dragonb')
    expect(rows().map((x) => x.dataset.tag)).toEqual(['dragon_ball'])
  })

  it('suppresses site listeners only for non-ASCII tokens', () => {
    let site = 0
    input.addEventListener('input', () => site++)
    input.addEventListener('keydown', () => site++)
    detach = attachSearch(document, dict, DEFAULTS)
    type('かなだ')
    key('ArrowDown')
    expect(site).toBe(0)
    type('kanada')
    expect(visible()).toBe(true)
    key('ArrowDown')
    expect(site).toBe(2)
  })

  it('hides on blur and on resize', async () => {
    detach = attachSearch(document, dict, DEFAULTS)
    type('かなだ')
    input.dispatchEvent(new Event('blur'))
    await new Promise((r) => setTimeout(r, 250))
    expect(visible()).toBe(false)
    type('かなだ')
    window.dispatchEvent(new Event('resize'))
    expect(visible()).toBe(false)
  })

  it('refocus or typing after blur cancels the pending hide', async () => {
    detach = attachSearch(document, dict, DEFAULTS)
    type('かなだ')
    input.dispatchEvent(new Event('blur'))
    input.dispatchEvent(new Event('focus'))
    await new Promise((r) => setTimeout(r, 250))
    expect(visible()).toBe(true)
    input.dispatchEvent(new Event('blur'))
    type('かなだ')
    await new Promise((r) => setTimeout(r, 250))
    expect(visible()).toBe(true)
  })

  it('omits the count span when the stored count is not finite', () => {
    const bad = { ...dict, counts: { yoshinori_kanada: Number.NaN } } as Dict
    detach = attachSearch(document, bad, DEFAULTS)
    type('金田伊功')
    expect(rows()[0].dataset.tag).toBe('yoshinori_kanada')
    expect(rows()[0].querySelector('.bsb-sg-count')).toBeNull()
  })

  it('detach removes listeners and the box', () => {
    detach = attachSearch(document, dict, DEFAULTS)
    type('かなだ')
    detach()
    expect(box()).toBeNull()
    type('かなだ')
    expect(box()).toBeNull()
  })

  it('exposes combobox ARIA wiring', () => {
    detach = attachSearch(document, dict, DEFAULTS)
    expect(input.getAttribute('role')).toBe('combobox')
    expect(input.getAttribute('aria-autocomplete')).toBe('list')
    expect(input.getAttribute('aria-expanded')).toBe('false')
    type('かなだ')
    expect(input.getAttribute('aria-expanded')).toBe('true')
    const listId = box()!.id
    expect(listId).toBeTruthy()
    expect(input.getAttribute('aria-controls')).toBe(listId)
    expect(rows().map((r) => r.id)).toEqual(rows().map((_, i) => `bsb-sg-${i}`))
    expect(input.hasAttribute('aria-activedescendant')).toBe(false)
    key('ArrowDown')
    expect(input.getAttribute('aria-activedescendant')).toBe('bsb-sg-0')
    key('ArrowDown')
    expect(input.getAttribute('aria-activedescendant')).toBe('bsb-sg-1')
    key('Escape')
    expect(input.getAttribute('aria-expanded')).toBe('false')
    expect(input.hasAttribute('aria-activedescendant')).toBe(false)
  })

  it('removes ARIA attributes on detach', () => {
    detach = attachSearch(document, dict, DEFAULTS)
    detach()
    detach = () => {}
    for (const a of ['role', 'aria-autocomplete', 'aria-expanded', 'aria-controls', 'aria-activedescendant']) {
      expect(input.hasAttribute(a)).toBe(false)
    }
  })

  it('attaches nothing when searchSuggest is off', () => {
    detach = attachSearch(document, dict, { ...DEFAULTS, searchSuggest: false })
    type('かなだ')
    expect(box()).toBeNull()
    expect(document.getElementById('bsb-search')).toBeNull()
  })
})
