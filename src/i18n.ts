export type Lang = 'ja' | 'en'

/** Underscored tag -> readable name. */
export const spaced = (tag: string) => tag.replace(/_/g, ' ')

/** Top-level menu labels as the site serves them in English / in its own partial Japanese locale. */
const SITE_MENU_EN = new Set(['Posts', 'Comments', 'Notes', 'Artists', 'Tags', 'Pools', 'Wiki', 'Forum', 'Help', 'My Account'])
const SITE_MENU_JA = new Set(['投稿', 'コメント', '注釈', '絵師', 'タグ', 'プール', 'フォーラム', 'ヘルプ', 'マイアカウント'])

/** Which language the site served. The site omits html[lang], so the menu labels decide. */
export function detectLang(doc: Document): Lang {
  const lang = (doc.documentElement.getAttribute('lang') ?? '').toLowerCase()
  if (lang.startsWith('ja')) return 'ja'
  if (lang) return 'en'
  const menu = doc.getElementById('main-menu')
  const links = menu ? Array.from(menu.querySelectorAll<HTMLAnchorElement>(':scope > ul > li > a:first-child')) : []
  if (!links.length) {
    // No menu (e.g. the front page): the locale cookie decides.
    let cookie = ''
    try {
      cookie = doc.cookie
    } catch {
      /* cookies unavailable */
    }
    return /(?:^|;\s*)locale=ja(?:;|$)/.test(cookie) ? 'ja' : 'en'
  }
  // Majority vote: some labels ("Wiki", "Patreon") are English in both locales.
  const count = (set: Set<string>) => links.filter((a) => set.has(a.textContent?.trim() ?? '')).length
  return count(SITE_MENU_EN) > count(SITE_MENU_JA) ? 'en' : 'ja'
}

/** Language of the extension's own UI (popup) from the browser UI language. */
export function uiLang(navigatorLanguage: string | undefined): Lang {
  return (navigatorLanguage ?? '').toLowerCase().startsWith('ja') ? 'ja' : 'en'
}

export interface Strings {
  /** BCP 47 tag for number and date formatting. */
  locale: string

  // header
  menuPosts: string
  menuComments: string
  menuNotes: string
  menuArtists: string
  menuTags: string
  menuPools: string
  menuForum: string
  menuHelp: string
  menuAccount: string
  menuMore: string
  upload: string
  search: string
  langSwitchLabel: string

  // list / listband
  posts: string
  postsDeco: string
  sort: string
  sortNew: string
  sortScore: string
  sortRandom: string
  sortLeadNew: string
  sortLeadScore: string
  sortLeadRandom: string
  perPage: string
  searchPlaceholder: string
  removeChip: (label: string) => string
  nameSep: string
  /** Separator between short facts (full-width space in ja). */
  wideSep: string
  bandSummary: (names: string, orderLead: string, perPage: number) => string
  sideLabel: string
  panelArtists: string
  panelWorks: string
  panelTech: string
  more: (n: number) => string
  moreArtists: (n: number) => string
  less: string
  propose: string
  proposeSideNote: (mark: string) => string
  proposeTitle: (tag: string) => string
  prev: string
  next: string
  artistUnknown: string
  untranslated: string

  // show
  prevPost: string
  nextPost: string
  backToList: string
  navLabel: string
  addFav: string
  removeFav: string
  editTags: string
  addNote: string
  history: string
  comments: string
  writeComment: string
  submitComment: string
  pool: string
  poolPrev: string
  poolNext: string
  groupCopyright: string
  groupArtist: string
  groupCharacter: string
  groupTech: string
  groupMeta: string
  groupOther: string
  statusActive: string
  statusPending: string
  statusFlagged: string
  statusDeleted: string
  factUploader: string
  factPosted: string
  factSource: string
  factRating: string
  factSize: string
  factStatus: string
  factFamily: string
  factParent: string
  factChild: string
  factChildAny: string
  proposeNoteLead: string
  wiki: string
  wikiTitle: (name: string) => string

  // player
  play: string
  pause: string
  progress: string
  speed: string
  frameTitle: (fps: string) => string
  frameBack: string
  frameFwd: string
  loop: string
  mute: string
  unmute: string
  saveMp4: string
  fullscreen: string

  // popup
  ppSettings: string
  ppTheme: string
  ppLight: string
  ppDark: string
  ppSystem: string
  ppFeatures: string
  ppTranslate: string
  ppTranslateHint: string
  ppRomaji: string
  ppRomajiHint: string
  ppSuggest: string
  ppSuggestHint: string
  ppHover: string
  ppHoverHint: string
  ppFront: string
  ppFrontHint: string
  ppJaLocale: string
  ppJaLocaleHint: string
  ppFonts: string
  ppFontsHint: string
  ppList: string
  ppPerPage: string
  ppThumb: string
  ppSmall: string
  ppMedium: string
  ppLarge: string
  ppCols: (n: number) => string
  ppUnder: string
  ppWork: string
  ppArtist: string
  ppScoreDate: string
  ppTech: string
  ppTechUpTo: string
  ppDec: string
  ppInc: string
  ppDictWord: string
  ppDictEntries: string
  ppDictUpdated: string
  ppAuto: string
  ppRefresh: string
  ppRefreshing: string
  ppRefreshFailed: string
  ppNotFetched: string
  ppPropose: string
}

const ja: Strings = {
  locale: 'ja-JP',

  menuPosts: '投稿',
  menuComments: 'コメント',
  menuNotes: 'ノート',
  menuArtists: '作画者',
  menuTags: 'タグ',
  menuPools: 'プール',
  menuForum: 'フォーラム',
  menuHelp: 'ヘルプ',
  menuAccount: 'アカウント',
  menuMore: 'その他',
  upload: '動画を投稿',
  search: '検索',
  langSwitchLabel: '表示言語',

  posts: '投稿一覧',
  postsDeco: 'POSTS',
  sort: '並び',
  sortNew: '新着',
  sortScore: 'スコア',
  sortRandom: 'ランダム',
  sortLeadNew: '新着',
  sortLeadScore: 'スコア順',
  sortLeadRandom: 'ランダム',
  perPage: '表示件数',
  searchPlaceholder: '作画者・作品・技法を日本語で',
  removeChip: (label) => `${label} を外す`,
  nameSep: '・',
  wideSep: '　',
  bandSummary: (names, orderLead, perPage) => `${names ? `${names}の` : ''}${orderLead}を 1 ページに ${perPage} 件`,
  sideLabel: 'タグ',
  panelArtists: '作画者',
  panelWorks: '作品',
  panelTech: '技法',
  more: (n) => `ほか ${n} 件`,
  moreArtists: (n) => `ほか ${n} 名`,
  less: '閉じる',
  propose: '訳を提案する',
  proposeSideNote: (mark) => `赤い「${mark}」は辞書にまだ無い語です (押すとその語の訳を提案できます)。`,
  proposeTitle: (tag) => `「${tag}」の訳を GitHub で提案する`,
  prev: '前へ',
  next: '次へ',
  artistUnknown: '作画者不明',
  untranslated: '未訳',

  prevPost: '前の投稿',
  nextPost: '次の投稿',
  backToList: '一覧へ戻る',
  navLabel: '前後の投稿',
  addFav: 'お気に入りに追加',
  removeFav: 'お気に入りから削除',
  editTags: 'タグを編集',
  addNote: 'ノートを追加',
  history: '履歴',
  comments: 'コメント',
  writeComment: 'コメントを書く',
  submitComment: 'コメントを投稿',
  pool: 'プール',
  poolPrev: '前',
  poolNext: '次',
  groupCopyright: '作品',
  groupArtist: '作画者',
  groupCharacter: 'キャラクター',
  groupTech: '技法',
  groupMeta: 'メタ',
  groupOther: 'その他',
  statusActive: '承認済み',
  statusPending: '承認待ち',
  statusFlagged: 'フラグ',
  statusDeleted: '削除済み',
  factUploader: '投稿者',
  factPosted: '投稿日',
  factSource: '出典',
  factRating: 'レーティング',
  factSize: 'サイズ',
  factStatus: '状態',
  factFamily: '親子',
  factParent: '親投稿あり',
  factChild: '子投稿 ',
  factChildAny: '子投稿あり',
  proposeNoteLead: '訳が違う、または足りないタグがあれば ',
  wiki: '作画wiki',
  wikiTitle: (name) => `作画@wiki で「${name}」を開く`,

  play: '再生',
  pause: '一時停止',
  progress: '再生位置',
  speed: '再生速度',
  frameTitle: (fps) => `コマ番号 (${fps} fps)`,
  frameBack: '1 フレーム戻る',
  frameFwd: '1 フレーム進む',
  loop: 'ループ',
  mute: 'ミュート',
  unmute: 'ミュート解除',
  saveMp4: 'mp4 を保存',
  fullscreen: '全画面',

  ppSettings: '設定',
  ppTheme: 'テーマ',
  ppLight: 'ライト',
  ppDark: 'ダーク',
  ppSystem: 'OS に合わせる',
  ppFeatures: '機能',
  ppTranslate: 'タグを日本語で表示',
  ppTranslateHint: '辞書にある作画者・作品・技法を日本語に',
  ppRomaji: '原文 (ローマ字) も小さく表示',
  ppRomajiHint: 'コピーや英語での検索に使う',
  ppSuggest: '検索ボックスの日本語補完',
  ppSuggestHint: '漢字・かなで打つと英語タグを提案',
  ppHover: '一覧でホバー再生',
  ppHoverHint: 'サムネに乗せると無音で再生',
  ppFront: 'トップページを新着一覧に',
  ppFrontHint: 'sakugabooru.com を開くと投稿一覧へ',
  ppJaLocale: '日本語モード',
  ppJaLocaleHint: 'サイトの日本語表示とタグの日本語化。オフでサイトも拡張も英語に',
  ppFonts: 'Web フォント (Noto Sans JP) を読み込む',
  ppFontsHint: 'オフにすると端末のフォントで表示',
  ppList: '一覧の表示',
  ppPerPage: '1 ページの件数',
  ppThumb: 'サムネの大きさ',
  ppSmall: '小',
  ppMedium: '中',
  ppLarge: '大',
  ppCols: (n) => `${n}列`,
  ppUnder: 'サムネの下に表示',
  ppWork: '作品名',
  ppArtist: '作画者',
  ppScoreDate: '点数',
  ppTech: '技法タグ',
  ppTechUpTo: '件まで',
  ppDec: '減らす',
  ppInc: '増やす',
  ppDictWord: '辞書',
  ppDictEntries: '語',
  ppDictUpdated: '更新',
  ppAuto: '毎日自動で更新されます',
  ppRefresh: '今すぐ更新',
  ppRefreshing: '更新中…',
  ppRefreshFailed: '更新に失敗しました',
  ppNotFetched: '[未取得]',
  ppPropose: '訳を提案',
}

const en: Strings = {
  locale: 'en-US',

  menuPosts: 'Posts',
  menuComments: 'Comments',
  menuNotes: 'Notes',
  menuArtists: 'Artists',
  menuTags: 'Tags',
  menuPools: 'Pools',
  menuForum: 'Forum',
  menuHelp: 'Help',
  menuAccount: 'My Account',
  menuMore: 'More',
  upload: 'Upload',
  search: 'Search',
  langSwitchLabel: 'Language',

  posts: 'Posts',
  postsDeco: '',
  sort: 'Sort',
  sortNew: 'Newest',
  sortScore: 'Score',
  sortRandom: 'Random',
  sortLeadNew: 'Newest',
  sortLeadScore: 'By score',
  sortLeadRandom: 'Random',
  perPage: 'Per page',
  searchPlaceholder: 'Search artists, works, techniques',
  removeChip: (label) => `Remove ${label}`,
  nameSep: ', ',
  wideSep: ' ',
  bandSummary: (names, orderLead, perPage) => `${names ? `${names}: ` : ''}${orderLead}, ${perPage} per page`,
  sideLabel: 'Tags',
  panelArtists: 'Artists',
  panelWorks: 'Works',
  panelTech: 'Techniques',
  more: (n) => `+${n} more`,
  moreArtists: (n) => `+${n} more`,
  less: 'Show less',
  propose: 'Suggest a translation',
  proposeSideNote: (mark) => `Red "${mark}" marks a tag missing from the dictionary. Click it to suggest a translation.`,
  proposeTitle: (tag) => `Suggest a translation for "${tag}" on GitHub`,
  prev: 'Prev',
  next: 'Next',
  artistUnknown: 'artist unknown',
  untranslated: 'untranslated',

  prevPost: 'Prev',
  nextPost: 'Next',
  backToList: 'Back to list',
  navLabel: 'Previous and next posts',
  addFav: 'Add to favorites',
  removeFav: 'Remove from favorites',
  editTags: 'Edit tags',
  addNote: 'Add note',
  history: 'History',
  comments: 'Comments',
  writeComment: 'Write a comment',
  submitComment: 'Post comment',
  pool: 'Pool',
  poolPrev: 'Prev',
  poolNext: 'Next',
  groupCopyright: 'Works',
  groupArtist: 'Artists',
  groupCharacter: 'Characters',
  groupTech: 'Techniques',
  groupMeta: 'Meta',
  groupOther: 'Other',
  statusActive: 'Approved',
  statusPending: 'Pending',
  statusFlagged: 'Flagged',
  statusDeleted: 'Deleted',
  factUploader: 'Uploader',
  factPosted: 'Posted',
  factSource: 'Source',
  factRating: 'Rating',
  factSize: 'Size',
  factStatus: 'Status',
  factFamily: 'Family',
  factParent: 'Parent',
  factChild: 'Children ',
  factChildAny: 'Has children',
  proposeNoteLead: 'Wrong or missing tag translation? ',
  wiki: 'Sakuga wiki',
  wikiTitle: (name) => `Open ${name} on Sakuga@wiki`,

  play: 'Play',
  pause: 'Pause',
  progress: 'Seek',
  speed: 'Playback speed',
  frameTitle: (fps) => `Frame number (${fps} fps)`,
  frameBack: 'Back 1 frame',
  frameFwd: 'Forward 1 frame',
  loop: 'Loop',
  mute: 'Mute',
  unmute: 'Unmute',
  saveMp4: 'Save mp4',
  fullscreen: 'Fullscreen',

  ppSettings: 'Settings',
  ppTheme: 'Theme',
  ppLight: 'Light',
  ppDark: 'Dark',
  ppSystem: 'Follow OS',
  ppFeatures: 'Features',
  ppTranslate: 'Show tags in Japanese',
  ppTranslateHint: 'Known artists, works and techniques in Japanese',
  ppRomaji: 'Also show original names, small',
  ppRomajiHint: 'Handy for copying and English search',
  ppSuggest: 'Japanese search suggestions',
  ppSuggestHint: 'Type kanji or kana to get English tags',
  ppHover: 'Hover to play in lists',
  ppHoverHint: 'Plays muted when you point at a thumbnail',
  ppFront: 'Front page shows newest posts',
  ppFrontHint: 'Opening sakugabooru.com goes to the post list',
  ppJaLocale: 'Japanese mode',
  ppJaLocaleHint: 'Japanese site locale plus Japanese tag names. Off = all English',
  ppFonts: 'Load web fonts (Noto Sans JP)',
  ppFontsHint: 'Off uses your device fonts',
  ppList: 'List',
  ppPerPage: 'Per page',
  ppThumb: 'Thumbnail size',
  ppSmall: 'Small',
  ppMedium: 'Medium',
  ppLarge: 'Large',
  ppCols: (n) => `${n} cols`,
  ppUnder: 'Under thumbnails',
  ppWork: 'Work title',
  ppArtist: 'Artist',
  ppScoreDate: 'Score',
  ppTech: 'Technique tags',
  ppTechUpTo: 'max',
  ppDec: 'Fewer',
  ppInc: 'More',
  ppDictWord: 'Dictionary',
  ppDictEntries: 'entries',
  ppDictUpdated: 'updated',
  ppAuto: 'Updates automatically every day',
  ppRefresh: 'Refresh now',
  ppRefreshing: 'Refreshing…',
  ppRefreshFailed: 'Refresh failed',
  ppNotFetched: '[not fetched]',
  ppPropose: 'Suggest a translation',
}

export const STRINGS: Record<Lang, Strings> = { ja, en }
