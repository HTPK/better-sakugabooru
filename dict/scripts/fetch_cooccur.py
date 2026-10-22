"""Collect the work tags that share posts with each `_series` tag.

A `_series` tag rarely matches a Wikidata item by name (`avatar_series`,
`x_series`), but its posts also carry the concrete works (`genso_suikoden`,
`suikoden_3`), and those items point at their franchise (P179 / P8345). One
`post.json` call per series tag; the raw answers go to cache/cooccur/, the
aggregate {series_tag: {work_tag: posts}} to cache/cooccur.json.

Only series tags that the dictionary does not translate yet are fetched
(dist/dict.json), unless --all is given.
"""
import argparse
import sys
import urllib.parse
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import ROOT, cached, http_json, load_json, load_tags, save_json  # noqa: E402

BASE = "https://www.sakugabooru.com/post.json"
LIMIT = 100
MIN_COUNT = 5
SERIES_SUFFIX = "_series"


def post_url(tag):
    return f"{BASE}?tags={urllib.parse.quote(tag, safe='')}&limit={LIMIT}"


def cooccurring(posts, tag, copyright_names):
    """{work_tag: number of posts} for the copyright tags found next to `tag`."""
    c = Counter()
    for p in posts:
        for t in set((p.get("tags") or "").split()):
            if t != tag and t in copyright_names:
                c[t] += 1
    return dict(c.most_common())


def targets(tags, translated, all_tags=False):
    out = []
    for t in tags:
        if t["count"] < MIN_COUNT or not t["name"].endswith(SERIES_SUFFIX):
            continue
        if all_tags or t["name"] not in translated:
            out.append(t["name"])
    return out


def run(series_tags, copyright_names, fetch_json, on_progress=None, out=None):
    out = {} if out is None else out
    for i, tag in enumerate(series_tags, 1):
        try:
            posts = fetch_json(post_url(tag))
        except Exception as e:  # noqa: BLE001 - one tag must not abort the run
            print(f"warning: {tag}: {type(e).__name__}: {e}", file=sys.stderr)
            continue
        out[tag] = cooccurring(posts if isinstance(posts, list) else [], tag, copyright_names)
        if on_progress and i % 25 == 0:
            on_progress(out)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sleep", type=float, default=1.0)
    ap.add_argument("--all", action="store_true", help="also series tags already translated")
    ap.add_argument("--limit", type=int)
    a = ap.parse_args()
    tags = load_tags(ROOT, "copyright")
    if not tags:
        sys.exit("cache/tags.json missing: run fetch_tags.py first")
    names = {t["name"] for t in tags}
    translated = set(load_json(ROOT / "dist" / "dict.json").get("copyrights", {}))
    todo = targets(sorted(tags, key=lambda x: -x["count"]), translated, a.all)
    if a.limit is not None:
        todo = todo[: a.limit]
    path = ROOT / "cache" / "cooccur.json"
    out = load_json(path)

    def fetch(url):
        return cached(ROOT / "cache" / "cooccur", url, lambda: http_json(url), sleep=a.sleep)

    print(f"{len(todo)} series tags")
    try:
        run(todo, names, fetch, on_progress=lambda d: save_json(path, d), out=out)
    finally:
        save_json(path, out)
    print(f"cooccur: {len(out)} series tags in {path}")


if __name__ == "__main__":
    main()
