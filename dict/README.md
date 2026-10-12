# Dictionary

Japanese names for Sakugabooru tags (artists, works, general terms), used by the extension in this repository. The extension fetches `dict/dist/dict.json` from jsDelivr, so a fix here reaches users without a Web Store release. After changing the data, run `pnpm sync-snapshot` in the repository root to refresh the copy bundled with the extension.

## Layout

- `data/artists.json`, `data/copyrights.json`, `data/general.json`: generated entries (Wikidata / an external database).
- `data/overrides.json`: hand-maintained corrections. Always wins over generated data.
- `dist/dict.json`: the built dictionary. `REVIEW.md` lists uncertain candidates, `COVERAGE.md` shows how much is translated.

## Entry format

```json
"yoshinori_kanada": {
  "ja": "金田伊功",
  "kana": "かなだ よしのり",
  "src": "wikidata:Q919281",
  "count": 926,
  "needs_review": false
}
```

`kana` is optional. `src` is `wikidata:Q...`, `an external database:ID`, `manual`, or `manual:<url>`. In `overrides.json` you may add `"type": "artists" | "copyrights" | "general"` for tags not yet in a data file (default `general`).

## Fixing a name (GitHub web editor)

Open `data/overrides.json`, press the pencil icon, add a line such as
`"shuu_sugita": { "ja": "杉田秀", "src": "manual" }`, and commit. Keep the file valid JSON (commas between entries).

## Scripts (Python 3, stdlib only, run inside `dict/`)

```
py -3 scripts/fetch_tags.py                 # cache/tags.json
py -3 scripts/gen_artists.py --limit 50     # Wikidata -> data/artists.json
py -3 scripts/gen_copyrights.py --limit 50  # an external database  -> data/copyrights.json
py -3 scripts/build.py                      # dist/dict.json, REVIEW.md, COVERAGE.md
py -3 -m pytest -q
```

## License

MIT (see the repository root). Data derived from Wikidata (CC0) and an external database titles.
