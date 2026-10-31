import { buildReverseIndex, suggest, type Dict, type Suggestion } from '../dict'
import type { Settings } from '../settings'
import { spaced, type Lang } from '../i18n'
import { h } from './render'
import searchCss from './search.css?inline'

const STYLE_ID = 'bsb-search'
const LIMIT = 8
const BLUR_HIDE_MS = 150
const LISTBOX_ID = 'bsb-suggest-list'
const OPTION_ID = 'bsb-sg-'
const isAscii = (s: string) => /^[\x00-\x7f]*$/.test(s)

function injectStyle(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return
  const el = doc.createElement('style')
  el.id = STYLE_ID
  el.textContent = searchCss
  ;(doc.head ?? doc.documentElement).appendChild(el)
}

/** The token being typed: text after the last whitespace, up to the caret. */
function currentToken(input: HTMLInputElement): { token: string; start: number; end: number } {
  const end = input.selectionStart ?? input.value.length
  const before = input.value.slice(0, end)
  const m = /\S*$/.exec(before)
  const token = m ? m[0] : ''
  return { token, start: end - token.length, end }
}

function hasCount(dict: Dict, tag: string): boolean {
  if (!dict.counts || !Object.prototype.hasOwnProperty.call(dict.counts, tag)) return false
  const n = dict.counts[tag]
  return typeof n === 'number' && Number.isFinite(n)
}

/**
 * Japanese/kana autocomplete for every `input[name="tags"]`.
 * For non-ASCII tokens it suppresses the site's own TagCompletionBox while our list is open;
 * for ASCII tokens it only adds a list when the dictionary has hits and never blocks the site.
 */
export function attachSearch(doc: Document, dict: Dict, settings: Settings, lang: Lang = 'ja'): () => void {
  if (!settings.searchSuggest) return () => {}
  const win = doc.defaultView
  const inputs = Array.from(doc.querySelectorAll<HTMLInputElement>('input[name="tags"]'))
  if (!inputs.length) return () => {}
  injectStyle(doc)

  let box: HTMLDivElement | null = null
  let items: Suggestion[] = []
  let selected = -1
  let active: HTMLInputElement | null = null
  let nonAscii = false
  let blurTimer: ReturnType<typeof setTimeout> | null = null

  const isOpen = () => !!box && !box.hidden && items.length > 0

  const hide = () => {
    items = []
    selected = -1
    for (const input of inputs) {
      input.setAttribute('aria-expanded', 'false')
      input.removeAttribute('aria-activedescendant')
    }
    if (box) {
      box.hidden = true
      box.replaceChildren()
    }
  }

  const select = (i: number) => {
    selected = i
    box?.querySelectorAll('.bsb-sg').forEach((r, j) => r.setAttribute('aria-selected', String(j === i)))
    if (active) {
      if (i >= 0) active.setAttribute('aria-activedescendant', `${OPTION_ID}${i}`)
      else active.removeAttribute('aria-activedescendant')
    }
  }

  const insert = (input: HTMLInputElement, tag: string) => {
    const { start, end } = currentToken(input)
    const v = input.value
    const text = tag + ' '
    const rest = v.slice(end).replace(/^\s+/, '')
    input.value = v.slice(0, start) + text + rest
    const caret = start + text.length
    input.setSelectionRange(caret, caret)
    hide()
  }

  const ensureBox = (): HTMLDivElement => {
    if (box) return box
    box = h(doc, 'div', { class: 'bsb-suggest', role: 'listbox', id: LISTBOX_ID })
    box.hidden = true
    box.addEventListener('mousedown', onBoxDown)
    doc.body.appendChild(box)
    return box
  }

  const position = (input: HTMLInputElement, el: HTMLElement) => {
    const r = input.getBoundingClientRect()
    el.style.top = `${r.bottom + (win?.scrollY ?? 0)}px`
    el.style.left = `${r.left + (win?.scrollX ?? 0)}px`
  }

  const render = (input: HTMLInputElement, list: Suggestion[]) => {
    const el = ensureBox()
    items = list
    selected = -1
    el.replaceChildren(
      ...list.map((s, i) =>
        h(
          doc,
          'div',
          {
            class: 'bsb-sg',
            id: `${OPTION_ID}${i}`,
            role: 'option',
            'aria-selected': 'false',
            'data-tag': s.tag,
            'data-type': s.type,
          },
          h(doc, 'span', { class: 'bsb-sg-ja' }, lang === 'en' ? spaced(s.tag) : s.ja),
          hasCount(dict, s.tag) ? h(doc, 'span', { class: 'bsb-sg-count' }, String(s.count)) : null,
          lang === 'en' ? null : h(doc, 'span', { class: 'bsb-sg-romaji' }, spaced(s.tag)),
          s.kana ? h(doc, 'span', { class: 'bsb-sg-kana' }, s.kana) : null,
        ),
      ),
    )
    position(input, el)
    el.hidden = false
    input.setAttribute('aria-expanded', 'true')
    input.removeAttribute('aria-activedescendant')
  }

  const cancelBlur = () => {
    if (blurTimer !== null) clearTimeout(blurTimer)
    blurTimer = null
  }

  const onInput = (e: Event) => {
    cancelBlur()
    const input = e.currentTarget as HTMLInputElement
    active = input
    const { token } = currentToken(input)
    nonAscii = !isAscii(token)
    if (!token || (!nonAscii && token.length < 2)) return hide()
    const list = suggest(buildReverseIndex(dict), token, LIMIT)
    if (!list.length) return hide()
    render(input, list)
    if (nonAscii) e.stopImmediatePropagation()
  }

  const onKeydown = (e: Event) => {
    const ke = e as KeyboardEvent
    if (ke.isComposing || ke.keyCode === 229) return
    const input = e.currentTarget as HTMLInputElement
    if (!isOpen() || active !== input) return
    const n = items.length
    let handled = true
    if (ke.key === 'ArrowDown') select(selected < 0 ? 0 : (selected + 1) % n)
    else if (ke.key === 'ArrowUp') select(selected < 0 ? n - 1 : (selected - 1 + n) % n)
    else if (ke.key === 'Escape') hide()
    else if (ke.key === 'Enter' && selected >= 0) insert(input, items[selected].tag)
    else handled = false
    if (!handled) return
    ke.preventDefault()
    if (nonAscii) ke.stopImmediatePropagation()
  }

  const onBlur = () => {
    if (blurTimer !== null) clearTimeout(blurTimer)
    blurTimer = setTimeout(() => {
      blurTimer = null
      hide()
    }, BLUR_HIDE_MS)
  }

  function onBoxDown(e: MouseEvent) {
    const row = (e.target as Element | null)?.closest<HTMLElement>('.bsb-sg')
    e.preventDefault()
    if (!row || !active) return
    const tag = row.dataset.tag
    if (tag) insert(active, tag)
  }

  // Capture phase on the input itself: at-target capture listeners run before the site's
  // bubble listeners, so stopImmediatePropagation can keep TagCompletionBox quiet.
  for (const input of inputs) {
    input.setAttribute('role', 'combobox')
    input.setAttribute('aria-autocomplete', 'list')
    input.setAttribute('aria-expanded', 'false')
    input.setAttribute('aria-controls', LISTBOX_ID)
    input.addEventListener('input', onInput, true)
    input.addEventListener('keydown', onKeydown, true)
    input.addEventListener('blur', onBlur)
    input.addEventListener('focus', cancelBlur)
  }
  win?.addEventListener('resize', hide)

  return () => {
    for (const input of inputs) {
      input.removeEventListener('input', onInput, true)
      input.removeEventListener('keydown', onKeydown, true)
      input.removeEventListener('blur', onBlur)
      input.removeEventListener('focus', cancelBlur)
      for (const a of ['role', 'aria-autocomplete', 'aria-expanded', 'aria-controls', 'aria-activedescendant']) {
        input.removeAttribute(a)
      }
    }
    win?.removeEventListener('resize', hide)
    cancelBlur()
    box?.removeEventListener('mousedown', onBoxDown)
    box?.remove()
    box = null
    items = []
  }
}
