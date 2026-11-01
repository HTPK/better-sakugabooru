"""Fetch the recent posts of artist tags (post.json, 30 per tag, cached) and
aggregate the copyright tags they co-occur with.

Input: a JSON list of {"tag": ..., "count": ...} (or plain tag strings).
Output: {tag: {"count": n, "works": {copyright_tag: posts}}} sorted by posts.
Same cache directory and URL as verify_atwiki.py, so verified tags cost nothing.
Stdlib only, 1 s between requests.
"""
import argparse
import sys
import urllib.parse
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import ROOT, cached, http_json, load_json, load_tags, save_json  # noqa: E402

POSTS_DIR = ROOT / "cache" / "atwiki" / "posts"
POSTS_URL = "https://www.sakugabooru.com/post.json?tags={}&limit=30"


def works_of(posts, copyright_tags):
    c = Counter()
    for p in posts if isinstance(posts, list) else []:
        for t in set((p.get("tags") or "").split()):
            if t in copyright_tags:
                c[t] += 1
    return dict(sorted(c.items(), key=lambda kv: (-kv[1], kv[0])))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tags", required=True, help="JSON list of tags or {tag,count} rows")
    ap.add_argument("--out", required=True)
    ap.add_argument("--sleep", type=float, default=1.0)
    ap.add_argument("--limit", type=int, default=0)
    a = ap.parse_args()
    rows = load_json(a.tags, default=[])
    rows = [r if isinstance(r, dict) else {"tag": r, "count": 0} for r in rows]
    if a.limit:
        rows = rows[: a.limit]
    copyright_tags = {t["name"] for t in load_tags(ROOT, "copyright")}
    out = load_json(a.out, default={}) or {}
    for i, r in enumerate(rows, 1):
        tag = r.get("tag") or r["name"]
        if tag in out:
            continue
        url = POSTS_URL.format(urllib.parse.quote(tag, safe=""))
        posts = cached(POSTS_DIR, url, lambda: http_json(url), sleep=a.sleep)
        out[tag] = {"count": r.get("count", 0), "posts": len(posts) if isinstance(posts, list) else 0,
                    "works": works_of(posts, copyright_tags)}
        if i % 50 == 0:
            save_json(a.out, out)
            print(f"{i}/{len(rows)} {tag}", flush=True)
    save_json(a.out, out)
    print(f"done {len(out)} tags -> {a.out}")


if __name__ == "__main__":
    main()
