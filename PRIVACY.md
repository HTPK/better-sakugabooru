# プライバシーポリシー / Privacy Policy

SakuView for Sakugabooru (Chrome 拡張機能)

最終更新: 2026-10-13

## 日本語

この拡張機能は、利用者の個人情報・閲覧履歴・操作内容を収集しません。開発者のサーバーへ送信することもありません。設定は利用者のブラウザ内 (Chrome の同期ストレージ) にだけ保存されます。

拡張機能が行う外部との通信は次の 3 つだけです。

1. **辞書データの取得**: タグの日本語訳 (JSON データ) を jsDelivr (cdn.jsdelivr.net) から 1 日 1 回取得します。送るのはファイルの要求だけで、利用者に関する情報は含みません。
2. **Web フォントの読み込み**: 設定「Web フォント (Noto Sans JP) を読み込む」が ON の間、Google Fonts (fonts.googleapis.com) にフォントを要求します。このとき IP アドレスと参照元ページが Google に渡ります。設定で OFF にすると要求しません。
3. **「訳を提案する」「作画wiki」リンク**: 利用者が自分でクリックしたときだけ、GitHub の Issue フォーム、または 作画@wiki (w.atwiki.jp) が新しいタブで開きます。Issue フォームには投稿の URL と未訳タグ名が入力された状態で開きますが、送信は GitHub 上で利用者が確定したときだけです。

この拡張機能は sakugabooru.com のページの表示だけを書き換えます。他のサイトのページは読み取りません。

お問い合わせ: https://github.com/HTPK/better-sakugabooru/issues

## English

This extension does not collect personal data, browsing history or usage data, and sends nothing to the developer. Settings are stored only in the user's browser (Chrome sync storage).

The only network requests it makes are:

1. **Dictionary data**: the Japanese tag dictionary (JSON) is downloaded from jsDelivr (cdn.jsdelivr.net) once a day. The request contains no information about the user.
2. **Web font**: while the "Web フォント (Noto Sans JP)" setting is on, the font is requested from Google Fonts (fonts.googleapis.com), which receives the IP address and referring page. Turning the setting off stops these requests.
3. **"訳を提案する" and "作画wiki" links**: only when the user clicks them, a GitHub issue form or the Sakuga@wiki (w.atwiki.jp) page opens in a new tab. The issue form is pre-filled with the post URL and untranslated tag names; nothing is submitted unless the user submits it on GitHub.

The extension only changes how pages on sakugabooru.com are displayed and does not read pages on any other site.

Contact: https://github.com/HTPK/better-sakugabooru/issues
