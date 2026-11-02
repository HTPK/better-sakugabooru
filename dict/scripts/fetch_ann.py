"""Look up work tags in the Anime News Network encyclopedia API (titles only).

For each tag the main-title substring search (`api.xml?title=~<words>`) is fetched once
(cached in cache/ann/search), every returned anime is parsed to {id, type, name,
titles (all alternative titles), ja (Japanese-script titles), vintage}, and the tag is
compared with every title after romaji normalisation (macrons, long vowels, particles,
punctuation).  Output cache/ann/matches.json:

    {tag: {"q": "...", "hits": [...], "exact": [ids whose title equals the tag]}}

ANN terms: free API, 1 request/s, credit ANN as the source (src: "ann:<id>").
Two searches at most per tag (longest punctuation-free word run, then the longest
distinctive word); results are capped by ANN (~50), so queries stay specific.
Usage: py -3 fetch_ann.py --tags <json [[tag, count], ...] or [tag, ...]>
                          [--out cache/ann/matches.json] [--sleep 1] [--limit N]
"""
import argparse
import html
import json
import re
import sys
import unicodedata
import urllib.parse
import urllib.request
from pathlib import Path

from common import ROOT, USER_AGENT, cached, load_json, save_json

API = "https://cdn.animenewsnetwork.com/encyclopedia/api.xml?"
CACHE = ROOT / "cache" / "ann" / "search"
_QUAL = re.compile(r"_\((tv|movie|film|ova|oav|ona|mv|music_video|video_game|game|\d{4}|series|cm)\)$")
_ANIME = re.compile(r'<anime id="(\d+)"[^>]*?type="([^"]*)" name="([^"]*)"(.*?)</anime>', re.S)
_INFO = re.compile(r'<info gid="\d+" type="(Main title|Alternative title)"(?: lang="([A-Z]*)")?>([^<]*)</info>')
_VIN = re.compile(r'type="Vintage">([^<]*)<')
_CJK = re.compile(r"[぀-ヿ一-鿿]")


def unescape(s):
    return html.unescape(s)


STOP = {"season", "movie", "series", "part", "episode", "special", "final", "chapter", "story",
        "arc", "version", "remaster", "the", "and", "of", "no", "wo", "ni", "to", "ga", "wa", "de",
        "hen", "edition", "film", "anime", "music", "videos", "video", "game", "cm", "tv", "ova"}


def segments(tag):
    """Punctuation-free word runs of a tag (longest first), qualifier dropped."""
    t = _QUAL.sub("", tag).replace("_", " ")
    segs = [re.sub(r"\s+", " ", x).strip() for x in re.split(r"[^\w\s'.-]+", t)]
    segs = [x for x in segs if x]
    return sorted(segs, key=lambda x: (-len(x.split()), -len(x)))


def queries_of(tag):
    """Up to two ANN search strings: the longest word run, then the longest distinctive word."""
    segs = segments(tag)
    out = []
    if segs:
        out.append(segs[0])
    first = set(out[0].lower().split()) if out else set()
    words = sorted((w for w in re.findall(r"[A-Za-z][A-Za-z0-9']*", _QUAL.sub("", tag).replace("_", " "))
                    if w.lower() not in STOP and len(w) >= 5 and (len(first) > 1 or w.lower() not in first)),
                   key=lambda w: -len(w))
    if words:
        out.append(words[0])
    return out[:2]


def query_of(tag):
    qs = queries_of(tag)
    return qs[0] if qs else ""


def norm(s):
    """Romaji-insensitive key: strip accents/macrons, punctuation, long vowels, particles."""
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    s = s.replace("&", "and")
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    words = [("o" if w in ("wo", "o") else "e" if w in ("he", "e") else "wa" if w in ("ha", "wa") else w)
             for w in s.split()]
    s = "".join(words)
    s = re.sub(r"ou|oo|oh(?![aeiou])", "o", s)
    s = re.sub(r"uu", "u", s)
    return s


def parse(xml):
    out = []
    for m in _ANIME.finditer(xml):
        body = m.group(4)
        titles, ja = [], []
        for kind, lang, text in _INFO.findall(body):
            text = unescape(text)
            titles.append(text)
            if lang == "JA" and _CJK.search(text):
                ja.append(text)
        vin = _VIN.findall(body)
        out.append({"id": m.group(1), "type": m.group(2), "name": unescape(m.group(3)),
                    "titles": titles, "ja": ja, "vintage": vin[0] if vin else ""})
    return out


def fetch_search(q, sleep):
    url = API + urllib.parse.urlencode({"title": "~" + q})

    def producer():
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=60) as r:
            return {"xml": r.read().decode("utf-8")}

    return cached(CACHE, url, producer, sleep=sleep)


def match(tag, hits):
    key = norm(_QUAL.sub("", tag))
    return [h["id"] for h in hits if key and any(norm(t) == key for t in [h["name"]] + h["titles"])]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tags", required=True)
    ap.add_argument("--out", default=str(ROOT / "cache" / "ann" / "matches.json"))
    ap.add_argument("--sleep", type=float, default=1.0)
    ap.add_argument("--limit", type=int, default=0)
    a = ap.parse_args()
    rows = load_json(a.tags, [])
    tags = [r[0] if isinstance(r, list) else r.get("tag") or r["name"] if isinstance(r, dict) else r
            for r in rows]
    if a.limit:
        tags = tags[: a.limit]
    out = load_json(a.out, {})
    n_exact = 0
    for i, tag in enumerate(tags):
        qs = queries_of(tag)
        if not qs:
            continue
        hits, used = [], []
        seen = set()
        for q in qs:
            try:
                xml = fetch_search(q, a.sleep)["xml"]
            except Exception as e:  # noqa: BLE001
                print(f"ERR {tag} [{q}]: {e}", file=sys.stderr)
                continue
            used.append(q)
            for h in parse(xml):
                if h["id"] not in seen:
                    seen.add(h["id"])
                    hits.append(h)
            if match(tag, hits):
                break
        exact = match(tag, hits)
        out[tag] = {"q": used, "hits": hits[:40], "n_hits": len(hits), "exact": exact}
        n_exact += bool(exact)
        if (i + 1) % 50 == 0:
            save_json(a.out, out)
            print(f"{i + 1}/{len(tags)} exact so far {n_exact}", flush=True)
    save_json(a.out, out)
    print(f"done {len(tags)} tags, exact {n_exact}, with hits {sum(1 for t in tags if out.get(t, {}).get('hits'))}")


if __name__ == "__main__":
    main()
