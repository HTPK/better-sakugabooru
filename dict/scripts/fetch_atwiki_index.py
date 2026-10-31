"""Fetch the 作画@wiki animator index (アニメーター辞典) into cache/atwiki/index.json.

Page 167 links one page per kana row; each row page links the animators'
pages (link text = the Japanese name). Raw HTML is cached under
cache/atwiki/pages/<id>.html, 1 s between requests. Stdlib only.
"""
import argparse
import html as htmllib
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import ROOT, TRANSIENT, USER_AGENT, save_json  # noqa: E402

SITE = "https://w.atwiki.jp/sakuga/pages/{}.html"
INDEX_ID = 167
PAGES = ROOT / "cache" / "atwiki" / "pages"
JUNK_TEXTS = {"ページを更新", "登録/ログイン", "操作ガイド"}

_SCRIPT = re.compile(r"<script\b.*?</script\s*>", re.S | re.I)
_STYLE = re.compile(r"<style\b.*?</style\s*>", re.S | re.I)
_COMMENT = re.compile(r"<!--.*?-->", re.S)
_LINK = re.compile(r'<a\b[^>]*?\bhref="([^"]*)"[^>]*>(.*?)</a\s*>', re.S | re.I)
_TAG = re.compile(r"<[^>]+>")
_PAGE_ID = re.compile(r"(?:^|/)sakuga/pages/(\d+)\.html(?:$|[#?])")
_ROW_TEXT = re.compile(r"^(?:[ぁ-ん]行|[ぁ-ん]\s*[～~〜・]\s*[ぁ-ん]行?|他)$")


def clean(html_text):
    """Drop scripts, styles and comments before link parsing."""
    return _COMMENT.sub("", _STYLE.sub("", _SCRIPT.sub("", html_text)))


def link_text(inner):
    t = htmllib.unescape(_TAG.sub("", inner)).replace("　", " ").replace("\xa0", " ")
    return " ".join(t.split())


def links(html_text):
    """[(page_id, text)] for every sakuga page link, document order."""
    out = []
    for href, inner in _LINK.findall(clean(html_text)):
        m = _PAGE_ID.search(htmllib.unescape(href))
        if m:
            out.append((int(m.group(1)), link_text(inner)))
    return out


def body_of(html_text):
    """The wiki body (after id="wikibody"); the whole page when absent."""
    i = html_text.find('id="wikibody"')
    return html_text[i:] if i >= 0 else html_text


def nav_ids(html_text):
    """Ids of every sakuga page linked from the index page (menu + row links)."""
    return {i for i, _ in links(html_text)}


def parse_index(html_text):
    """{row link text: page id} from the body of the index page (あ行 ... 他)."""
    rows = {}
    for pid, text in links(body_of(html_text)):
        if _ROW_TEXT.match(text) and text not in rows:
            rows[text] = pid
    return rows


def parse_row(html_text, exclude=frozenset()):
    """[(id, name)] animator links on a row page, de-duplicated by id."""
    seen, out = set(), []
    for pid, text in links(body_of(html_text)):
        if not text or text in JUNK_TEXTS or pid in exclude or pid in seen:
            continue
        seen.add(pid)
        out.append((pid, text))
    return out


def fetch_html(page_id, pages_dir=PAGES, sleep=1.0, sleep_fn=time.sleep, opener=None):
    """Cached raw HTML of one atwiki page (utf-8). Network only on a cache miss."""
    pages_dir = Path(pages_dir)
    p = pages_dir / f"{page_id}.html"
    if p.exists() and p.stat().st_size > 0:
        return p.read_text(encoding="utf-8")
    opener = opener or urllib.request.urlopen
    last = None
    for attempt in range(4):
        if sleep:
            sleep_fn(sleep)
        req = urllib.request.Request(SITE.format(page_id), headers={"User-Agent": USER_AGENT})
        try:
            with opener(req, timeout=60) as r:
                text = r.read().decode("utf-8", "replace")
            break
        except urllib.error.HTTPError as e:
            if e.code < 500 and e.code != 429:
                raise
            last = e
        except TRANSIENT as e:
            last = e
        sleep_fn(2 ** attempt * 2)
    else:
        raise last
    pages_dir.mkdir(parents=True, exist_ok=True)
    with open(p, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)
    return text


def build(fetch, limit_rows=None):
    """Run the whole crawl through `fetch(page_id) -> html`. Returns the index dict."""
    index_html = fetch(INDEX_ID)
    rows = parse_index(index_html)
    exclude = nav_ids(index_html)
    names, by_id = [], {}
    page_row = {}
    for row, pid in rows.items():
        page_row.setdefault(pid, row)  # わ行 and 他 may share one page
    todo = list(page_row.items())
    if limit_rows is not None:
        todo = todo[:limit_rows]
    counts = {}
    for pid, row in todo:
        got = parse_row(fetch(pid), exclude)
        counts[row] = len(got)
        for aid, name in got:
            if aid not in by_id:
                by_id[aid] = {"name": name, "id": aid, "row": row}
    order = {r: i for i, r in enumerate(rows)}
    names = sorted(by_id.values(), key=lambda d: (order[d["row"]], d["name"]))
    return {"fetched": date.today().isoformat(), "rows": rows, "names": names}, counts


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sleep", type=float, default=1.0)
    ap.add_argument("--limit-rows", type=int)
    a = ap.parse_args()
    out, counts = build(lambda pid: fetch_html(pid, sleep=a.sleep), a.limit_rows)
    path = ROOT / "cache" / "atwiki" / "index.json"
    save_json(path, out)
    for row, n in counts.items():
        print(f"{row}: {n}")
    print(f"rows {out['rows']}")
    print(f"total {len(out['names'])} names -> {path}")


if __name__ == "__main__":
    main()
