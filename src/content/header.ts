import type { Settings } from '../settings'
import { h } from './render'
import headerCss from './header.css?inline'

/** Top-level menu labels translated only on exact match, and only on English-served pages. */
const MENU_JA: Record<string, string> = {
  Posts: '投稿',
  Comments: 'コメント',
  Notes: 'ノート',
  Artists: '作画者',
  Tags: 'タグ',
  Pools: 'プール',
  Wiki: 'Wiki',
  Forum: 'フォーラム',
  Help: 'ヘルプ',
  'My Account': 'アカウント',
  Upload: '動画を投稿',
}

function injectHeaderStyle(doc: Document): void {
  if (doc.getElementById('bsb-header')) return
  const el = doc.createElement('style')
  el.id = 'bsb-header'
  el.textContent = headerCss
  ;(doc.head ?? doc.documentElement).appendChild(el)
}

function topLinks(menu: Element | null): HTMLAnchorElement[] {
  if (!menu) return []
  return Array.from(menu.querySelectorAll<HTMLAnchorElement>(':scope > ul > li > a:first-child'))
}

/** Which language the site served. The site omits html[lang], so English menu labels decide. */
function servedLang(doc: Document, menu: Element | null): 'ja' | 'en' {
  const lang = (doc.documentElement.getAttribute('lang') ?? '').toLowerCase()
  if (lang.startsWith('ja')) return 'ja'
  if (lang) return 'en'
  const links = topLinks(menu)
  if (!links.length) return 'en'
  return links.some((a) => Object.hasOwn(MENU_JA, a.textContent?.trim() ?? '')) ? 'en' : 'ja'
}

function localeHref(doc: Document, locale: 'ja' | 'en'): string {
  const u = new URL(doc.location?.href ?? 'https://www.sakugabooru.com/post')
  u.searchParams.set('locale', locale)
  return u.pathname + u.search + u.hash
}

function langSwitch(doc: Document, served: 'ja' | 'en'): HTMLElement {
  const link = (locale: 'ja' | 'en', label: string) =>
    h(
      doc,
      'a',
      { href: localeHref(doc, locale), lang: locale, class: served === locale ? 'bsb-current' : undefined },
      label,
    )
  return h(doc, 'nav', { class: 'bsb-lang', 'aria-label': '表示言語' }, link('ja', 'JP'), h(doc, 'span', { class: 'bsb-lang-sep' }, '|'), link('en', 'EN'))
}

function searchForm(header: Element, english: boolean): HTMLFormElement | null {
  const form = Array.from(header.querySelectorAll('form')).find((f) => f.querySelector('input[name="tags"]'))
  if (!form) return null
  const box = form.closest('ul.search-box')
  form.classList.add('bsb-search-form')
  const input = form.querySelector<HTMLInputElement>('input[name="tags"]')
  if (input && !input.placeholder) input.placeholder = '作画者・作品・技法を日本語で'
  const submit = form.querySelector<HTMLElement>('input[type="submit"], button[type="submit"], button:not([type])')
  if (submit) {
    submit.classList.add('bsb-primary', 'bsb-pill')
    if (english) {
      // tagName, not instanceof: the document may come from another realm (iframe, jsdom).
      if (submit.tagName === 'INPUT') {
        ;(submit as HTMLInputElement).value = '検索'
        if (submit.hasAttribute('data-disable-with')) submit.setAttribute('data-disable-with', '検索')
      } else submit.textContent = '検索'
    }
  }
  // The dropdown panel that held the form is now empty; hide it rather than remove it.
  if (box) box.classList.add('bsb-hide')
  return form
}

function uploadLink(header: Element, english: boolean): HTMLAnchorElement | null {
  const a = header.querySelector<HTMLAnchorElement>('a[href="/post/upload"]')
  if (!a) return null
  const li = a.parentElement?.tagName === 'LI' ? a.parentElement : null
  a.classList.add('bsb-pill', 'bsb-upload')
  if (english && a.textContent?.trim() === 'Upload') a.textContent = MENU_JA.Upload
  if (li && li.children.length === 1) li.classList.add('bsb-hide')
  return a
}

export function renderHeader(doc: Document, _settings: Settings): void {
  const header = doc.getElementById('header')
  if (!header || header.hasAttribute('data-bsb-done')) return
  header.setAttribute('data-bsb-done', '')
  injectHeaderStyle(doc)

  const menu = doc.getElementById('main-menu')
  const served = servedLang(doc, menu)
  const english = served === 'en'

  header.classList.add('bsb-header')
  doc.getElementById('title')?.classList.add('bsb-hide')

  const bar = h(doc, 'div', { class: 'bsb-bar' }, h(doc, 'a', { class: 'bsb-logo', href: '/post' }, 'Sakugabooru'))
  const end = h(doc, 'div', { class: 'bsb-bar-end' })
  // Pull the form and upload link before the menu moves, so lookups stay inside #header.
  const form = searchForm(header, english)
  const upload = uploadLink(header, english)
  if (menu) {
    if (english) {
      for (const a of topLinks(menu)) {
        const t = a.textContent?.trim() ?? ''
        if (Object.hasOwn(MENU_JA, t)) a.textContent = MENU_JA[t]
      }
    }
    bar.append(menu)
  }
  if (form) end.append(form)
  end.append(langSwitch(doc, served))
  if (upload) end.append(upload)
  bar.append(end)
  header.prepend(bar)

  // #subnavbar sits in the footer with page-specific links (Browse, Random, Popular): keep it as a slim row.
  doc.getElementById('subnavbar')?.classList.add('bsb-subnav')
}
