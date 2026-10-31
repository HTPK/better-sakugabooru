"""Verify proposed `tag -> Japanese name` pairs against 作画@wiki + Sakugabooru posts.

Evidence the proposer cannot fake: (1) the atwiki page title starts with the
proposed name, (2) the work titles of the tag's recent posts (dictionary ja
names, or the English tag spelled with spaces) occur in the atwiki page text.
Verdicts: accept / review / reject. Stdlib only, all fetches cached, 1 s sleeps.
"""
import argparse
import html as htmllib
import re
import sys
import unicodedata
import urllib.parse
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import ROOT, cached, http_json, load_json, save_json  # noqa: E402
from fetch_atwiki_index import _TAG, body_of, clean, fetch_html  # noqa: E402

POSTS_DIR = ROOT / "cache" / "atwiki" / "posts"
POSTS_URL = "https://www.sakugabooru.com/post.json?tags={}&limit=30"
_TITLE = re.compile(r"<title[^>]*>(.*?)</title\s*>", re.S | re.I)
MIN_JA_LEN = 2
MIN_EN_LEN = 4


def _norm(s):
    return unicodedata.normalize("NFKC", s).strip()


def page_title(html_text):
    m = _TITLE.search(html_text)
    return " ".join(htmllib.unescape(m.group(1)).split()) if m else ""


def page_text(html_text):
    """Visible wiki body text (menu/navigation dropped), whitespace collapsed."""
    t = _TAG.sub(" ", clean(body_of(html_text)))
    return " ".join(htmllib.unescape(t).replace("\xa0", " ").replace("　", " ").split())


def works_of_posts(posts, dict_ja):
    """{copyright_tag: posts} for tags with a Japanese name, most frequent first."""
    c = Counter()
    for p in posts if isinstance(posts, list) else []:
        for t in set((p.get("tags") or "").split()):
            if dict_ja.get(t):
                c[t] += 1
    return dict(sorted(c.items(), key=lambda kv: (-kv[1], kv[0])))


def load_dict_ja(data_dir=ROOT / "data"):
    """{copyright tag: ja}; overrides win over generated copyrights.json."""
    ja = {}
    for t, e in load_json(Path(data_dir) / "copyrights.json").items():
        if isinstance(e, dict) and e.get("ja"):
            ja[t] = e["ja"]
    for t, e in load_json(Path(data_dir) / "overrides.json").items():
        if isinstance(e, dict) and e.get("ja") and e.get("type", "copyright") == "copyright":
            ja[t] = e["ja"]
    return ja


def match_works(works, dict_ja, text):
    """([(tag, how, needle)], top5_matched) for works whose title occurs in `text`."""
    low = text.lower()
    hits = []
    for tag in works:
        ja = dict_ja.get(tag, "")
        en = tag.replace("_", " ").lower()
        if len(ja) >= MIN_JA_LEN and ja in text:
            hits.append((tag, "ja", ja))
        elif len(en) >= MIN_EN_LEN and re.search(
                r"(?<![a-z0-9])" + re.escape(en) + r"(?![a-z0-9])", low):
            hits.append((tag, "en", en))
    top5 = list(works)[:5]
    return hits, sum(1 for h in hits if h[0] in top5)


def judge(matched, total, title_ok):
    if not title_ok:
        return "reject"
    if matched >= 2 or (matched >= 1 and total <= 3):
        return "accept"
    return "review"


def verify_row(row, fetch_page, fetch_posts, dict_ja):
    out = dict(row)
    ja, tag, aid = row.get("ja", ""), row.get("tag", ""), row.get("atwiki_id")
    if not (ja and tag and aid):
        out.update(verdict="review", evidence=["incomplete proposal (tag/ja/atwiki_id)"])
        return out
    try:
        html_text = fetch_page(aid)
        posts = fetch_posts(tag)
    except Exception as e:  # noqa: BLE001 - one row must not abort the run
        out.update(verdict="review", evidence=[f"fetch failed: {type(e).__name__}: {e}"])
        return out
    title = page_title(html_text)
    title_ok = _norm(title).startswith(_norm(ja))
    works = works_of_posts(posts, dict_ja)
    hits, top5 = match_works(works, dict_ja, page_text(html_text))
    evidence = [f"title: {title}"]
    if not title_ok:
        evidence.append("title mismatch")
    evidence += [f"{how}: {needle} ({tg}, {works[tg]} posts)" for tg, how, needle in hits]
    out.update(verdict=judge(len(hits), len(works), title_ok), evidence=evidence,
               matched=len(hits), total=len(works), top5_matched=top5)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--proposals", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--sleep", type=float, default=1.0)
    a = ap.parse_args()
    rows = load_json(a.proposals, default=[])
    dict_ja = load_dict_ja()

    def fetch_page(pid):
        return fetch_html(pid, sleep=a.sleep)

    def fetch_posts(tag):
        url = POSTS_URL.format(urllib.parse.quote(tag, safe=""))
        return cached(POSTS_DIR, url, lambda: http_json(url), sleep=a.sleep)

    results = [verify_row(r, fetch_page, fetch_posts, dict_ja) for r in rows]
    # save_json sorts keys; a list keeps its order
    save_json(a.out, results)
    print(f"{'tag':<32} {'ja':<14} {'verdict':<7} matched/total")
    for r in results:
        print(f"{r['tag']:<32} {r['ja']:<14} {r['verdict']:<7} {r.get('matched', '-')}/{r.get('total', '-')}")
    print(dict(Counter(r["verdict"] for r in results)), f"of {len(results)} -> {a.out}")


if __name__ == "__main__":
    main()
