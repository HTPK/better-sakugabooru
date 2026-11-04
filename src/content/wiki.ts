/** 作画@wiki (Sakuga@wiki) pages are titled by the animator's Japanese name. */
const WIKI_BASE = 'https://w.atwiki.jp/sakuga/?page='

export function wikiUrl(name: string): string {
  return `${WIKI_BASE}${encodeURIComponent(name)}`
}
