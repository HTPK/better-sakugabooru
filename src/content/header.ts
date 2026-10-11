import type { Settings } from '../settings'
import { h } from './render'
import headerCss from './header.css?inline'

/** Top-level menu labels as the site serves them in English. Also used to detect the served locale. */
const MENU_EN: Record<string, string> = {
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
}
/** The site's own (partial) Japanese locale labels mapped to ours. */
const MENU_SITE_JA: Record<string, string> = {
  投稿: '投稿',
  コメント: 'コメント',
  注釈: 'ノート',
  絵師: '作画者',
  タグ: 'タグ',
  プール: 'プール',
  フォーラム: 'フォーラム',
  ヘルプ: 'ヘルプ',
  マイアカウント: 'アカウント',
}
/** Exact top-level labels of either locale mapped to ours. */
const MENU_JA: Record<string, string> = { ...MENU_SITE_JA, ...MENU_EN }
const UPLOAD_LABELS = new Set(['Upload', 'アップロード'])
const UPLOAD_JA = '動画を投稿'
const SEARCH_JA = '検索'

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
  // Majority vote: some labels ("Wiki", "Patreon") are English in both locales.
  const count = (table: Record<string, string>) =>
    links.filter((a) => Object.hasOwn(table, a.textContent?.trim() ?? '')).length
  return count(MENU_EN) > count(MENU_SITE_JA) ? 'en' : 'ja'
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

function searchForm(header: Element): HTMLFormElement | null {
  const form = Array.from(header.querySelectorAll('form')).find((f) => f.querySelector('input[name="tags"]'))
  if (!form) return null
  const box = form.closest('ul.search-box')
  form.classList.add('bsb-search-form')
  const input = form.querySelector<HTMLInputElement>('input[name="tags"]')
  if (input && !input.placeholder) input.placeholder = '作画者・作品・技法を日本語で'
  const submit = form.querySelector<HTMLElement>('input[type="submit"], button[type="submit"], button:not([type])')
  if (submit) {
    submit.classList.add('bsb-primary', 'bsb-pill')
    // Our search pill, whatever the site called it ("Search Posts" / "投稿を検索").
    // tagName, not instanceof: the document may come from another realm (iframe, jsdom).
    if (submit.tagName === 'INPUT') {
      ;(submit as HTMLInputElement).value = SEARCH_JA
      if (submit.hasAttribute('data-disable-with')) submit.setAttribute('data-disable-with', SEARCH_JA)
    } else submit.textContent = SEARCH_JA
  }
  // The dropdown panel that held the form is now empty; hide it rather than remove it.
  if (box) box.classList.add('bsb-hide')
  return form
}

function uploadLink(header: Element): HTMLAnchorElement | null {
  const a = header.querySelector<HTMLAnchorElement>('a[href="/post/upload"]')
  if (!a) return null
  const li = a.parentElement?.tagName === 'LI' ? a.parentElement : null
  a.classList.add('bsb-pill', 'bsb-upload')
  if (UPLOAD_LABELS.has(a.textContent?.trim() ?? '')) a.textContent = UPLOAD_JA
  if (li && li.children.length === 1) li.classList.add('bsb-hide')
  return a
}

const MORE_JA = 'その他'
/** Site menu items folded under our その他 dropdown, by the site's li class. */
const FOLDED = ['blog', 'patreon', 'static']

/**
 * Reshapes the site menu to fit one row: folds low-traffic items under その他 (moved, never cloned),
 * hides the site's language item (our JP|EN replaces it), and returns the account li, detached,
 * so the caller can put it at the right end of the bar.
 */
function reshapeMenu(doc: Document, menu: Element): HTMLLIElement | null {
  const ul = menu.querySelector(':scope > ul')
  if (!ul) return null
  const item = (cls: string) => ul.querySelector<HTMLLIElement>(`:scope > li.${cls}`)
  item('locale')?.classList.add('bsb-hide')
  const folded = FOLDED.map(item).filter((li): li is HTMLLIElement => li !== null)
  if (folded.length) {
    const panel = h(doc, 'ul', { class: 'submenu bsb-menu-more-panel' })
    const more = h(
      doc,
      'li',
      { class: 'bsb-menu-more' },
      h(doc, 'a', { href: '#', class: 'bsb-menu-more-toggle', 'aria-haspopup': 'true' }, MORE_JA),
      panel,
    )
    more.querySelector('a')!.addEventListener('click', (e) => e.preventDefault())
    for (const li of folded) panel.append(li)
    ul.insertBefore(more, item('has-mail'))
  }
  const account = item('user')
  account?.remove()
  return account
}

export function renderHeader(doc: Document, _settings: Settings): void {
  const header = doc.getElementById('header')
  if (!header || header.hasAttribute('data-bsb-done')) return
  header.setAttribute('data-bsb-done', '')
  injectHeaderStyle(doc)

  const menu = doc.getElementById('main-menu')
  const served = servedLang(doc, menu)

  header.classList.add('bsb-header')
  doc.getElementById('title')?.classList.add('bsb-hide')

  const bar = h(doc, 'div', { class: 'bsb-bar' }, h(doc, 'a', { class: 'bsb-logo', href: '/post' }, 'sakugabooru'))
  const end = h(doc, 'div', { class: 'bsb-bar-end' })
  // Pull the form and upload link before the menu moves, so lookups stay inside #header.
  const form = searchForm(header)
  const upload = uploadLink(header)
  let account: HTMLLIElement | null = null
  if (menu) {
    for (const a of topLinks(menu)) {
      const t = a.textContent?.trim() ?? ''
      if (Object.hasOwn(MENU_JA, t)) a.textContent = MENU_JA[t]
    }
    account = reshapeMenu(doc, menu)
    bar.append(menu)
  }
  if (form) end.append(form)
  end.append(langSwitch(doc, served))
  if (upload) end.append(upload)
  if (account) end.append(h(doc, 'ul', { class: 'bsb-account' }, account))
  bar.append(end)
  header.prepend(bar)

  // #subnavbar sits in the footer with page-specific links (Browse, Random, Popular): keep it as a slim row.
  doc.getElementById('subnavbar')?.classList.add('bsb-subnav')
}
