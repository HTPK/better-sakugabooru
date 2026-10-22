"""Generate data/copyrights.json by matching copyright (work) tags to Wikidata items.

Conservative by design: a wrong title is worse than an untranslated one, so
anything ambiguous is kept with needs_review=True (build.py does not adopt it).
"""
import argparse
import re
import sys
import unicodedata
import urllib.parse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import ROOT, cached, http_json, load_json, load_tags, save_json  # noqa: E402

API = "https://www.wikidata.org/w/api.php"
MIN_COUNT = 5
MAX_JA_LEN = 80
SERIES_SUFFIX = "_series"
NO_MATCH = {"ja": None, "needs_review": True, "src": "wikidata:none"}

# P31 (instance of) -> preference tier (lower is preferred).
ANIME_WORKS = {
    "Q63952888",   # anime television series
    "Q20650540",   # anime film
    "Q220898",     # original video animation
    "Q1047299",    # original net animation
    "Q581714",     # animated series
    "Q117467246",  # animated television series
    "Q202866",     # animated film
    "Q17517379",   # animated short film
    "Q1107",       # anime
}
FRANCHISE = {"Q196600"}  # media franchise
OTHER_SCREEN = {
    "Q5398426",   # television series
    "Q11424",     # film
    "Q24862",     # short film
    "Q15416",     # television program
    "Q526877",    # web series
    "Q193977",    # music video
    "Q3464665",   # television series season
}
VIDEO_GAME = {"Q7889"}
MANGA = {"Q21198342"}  # manga series
TIERS = [ANIME_WORKS, FRANCHISE, OTHER_SCREEN, VIDEO_GAME, MANGA]
WORK_CLASSES = set().union(*TIERS)

YEAR_RE = re.compile(r"_\((\d{4})\)$")
QUAL_RE = re.compile(r"_\([^)]*\)$")
# Only parentheticals that are clearly a disambiguation note are stripped
# (`ドラえもん (1979年のテレビアニメ)`); `呪術廻戦 (第2期)` keeps its group.
SUFFIX_RE = re.compile(r"\s*[(（]([^()（）]*)[)）]\s*$")
DISAMBIG_RE = re.compile(r"アニメ|映画|漫画|マンガ|ゲーム|テレビ|ドラマ|作品|フランチャイズ|メディアミックス"
                         r"|小説|^\d{4}年?$|^OVA$|^ONA$")
BAD_CHARS_RE = re.compile(r"[\u0000-\u001f\u007f-\u009f​-‏‪-‮"
                          r"⁦-⁩﻿]")


def strip_label_suffix(s):
    """Drop a trailing disambiguation group: `ポケットモンスター (アニメ)` -> `ポケットモンスター`."""
    s = s.strip()
    m = SUFFIX_RE.search(s)
    if m and DISAMBIG_RE.search(m.group(1).strip()) and s[:m.start()].strip():
        return s[:m.start()].strip()
    return s


def ja_ok(s):
    return bool(s) and len(s) <= MAX_JA_LEN and not BAD_CHARS_RE.search(s)


def norm_key(s):
    """Casefold, fold accents/width, drop spaces and punctuation (`:!/・-'` etc.)."""
    s = unicodedata.normalize("NFKD", unicodedata.normalize("NFKC", s or ""))
    s = "".join(c for c in s if not unicodedata.combining(c)).casefold()
    return "".join(c for c in s if c.isalnum())


def romaji_key(s):
    """norm_key with long vowels folded (sousou / sōsō / soso all compare equal)."""
    return re.sub(r"ou|oo|oh(?![aeiou])", "o", norm_key(s)).replace("uu", "u")


def parse_tag(tag):
    """-> (query, year or None, has_other_qualifier)."""
    year, other = None, False
    m = YEAR_RE.search(tag)
    if m:
        year, tag = int(m.group(1)), tag[:m.start()]
    elif QUAL_RE.search(tag):
        other, tag = True, QUAL_RE.sub("", tag)
    return re.sub(r"\s+", " ", tag.replace("_", " ")).strip(), year, other


def _macron(q):
    m = re.sub(r"ou|oo", "ō", q)
    return re.sub(r"uu", "ū", m)


def tag_plan(tag, all_names):
    """Lookup plan for a tag, or None to skip.

    Returns dict(queries, names, year, other, series).
    """
    series = False
    if tag.endswith(SERIES_SUFFIX):
        base = tag[: -len(SERIES_SUFFIX)]
        if not base or base in all_names:
            return None  # build.py derives `<base ja> シリーズ`
        series, tag = True, base
    q, year, other = parse_tag(tag)
    if not q:
        return None
    queries = [q]
    if _macron(q) != q:
        queries.append(_macron(q))
    names = [q]
    if series:
        queries.append(f"{q} series")
        names += [f"{q} series", f"{q} franchise"]
    return {"queries": list(dict.fromkeys(queries)), "names": names, "year": year,
            "other": other, "series": series}


def _claim_ids(e, prop):
    out = []
    for c in e.get("claims", {}).get(prop, []):
        v = c.get("mainsnak", {}).get("datavalue", {}).get("value")
        if isinstance(v, dict) and v.get("id"):
            out.append(v["id"])
    return out


def _years(e):
    ys = set()
    for prop in ("P577", "P580"):
        for c in e.get("claims", {}).get(prop, []):
            v = c.get("mainsnak", {}).get("datavalue", {}).get("value")
            t = v.get("time") if isinstance(v, dict) else None
            m = re.match(r"^[+-]?0*(\d{1,4})-", t or "")
            if m:
                ys.add(int(m.group(1)))
    return ys


def _tier(e, series=False):
    p31 = set(_claim_ids(e, "P31"))
    if series and p31 & FRANCHISE:
        return -1
    for i, s in enumerate(TIERS):
        if p31 & s:
            return i
    return None


def _en_names(e):
    out = []
    for lang in ("en", "mul"):
        lab = e.get("labels", {}).get(lang, {}).get("value")
        if lab:
            out.append(lab)
        out += [a.get("value", "") for a in e.get("aliases", {}).get(lang, [])]
    return out


def _keys(names):
    ks = set()
    for n in names or []:
        ks |= {"n:" + norm_key(n), "r:" + romaji_key(n)}
    ks.discard("n:")
    ks.discard("r:")
    return ks


def _name_ok(names, keys):
    return bool(_keys(names) & keys)


def _single_word(names):
    first = (names or [""])[0]
    return len([t for t in re.split(r"[\W_]+", first) if t]) <= 1


def _ja(e):
    lab = e.get("labels", {}).get("ja", {}).get("value")
    if not lab:
        return None
    lab = strip_label_suffix(lab)
    return lab if ja_ok(lab) else None


def decide(entities, order=None, names=None, year=None, other=False, series=False):
    """Pick the best work-like, name-matching entity with a ja label.

    Auto-accept (needs_review False) only when every plausible candidate has the
    same ja label, the year qualifier (if any) matched, and there is no other
    unverified qualifier. Returns an entry dict or None.
    """
    keys = _keys(names)
    qids = [q for q in (order or list(entities)) if q in entities]
    cands = []
    for i, q in enumerate(qids):
        e = entities[q]
        tier = _tier(e, series)
        if tier is None or _ja(e) is None or not _name_ok(_en_names(e), keys):
            continue
        cands.append((tier, i, q))
    if not cands:
        return None
    review = other
    if year is not None:
        hit = [c for c in cands if year in _years(entities[c[2]])]
        if hit:
            cands = hit
        else:
            review = True
    cands.sort()
    best = cands[0][2]
    labels = {_ja(entities[q]) for _, _, q in cands}
    if len(labels) > 1:
        review = True
    if series and cands[0][0] != -1:
        review = True  # a `_series` tag should map to a franchise item
    # Bare one-word titles (`avatar`, `brave`) collide with unrelated works of the
    # same name; auto-accept those only for Japanese works (P495 = Japan).
    if (series or _single_word(names)) and "Q17" not in _claim_ids(entities[best], "P495"):
        review = True
    ja = _ja(entities[best])
    if year is not None and str(year) not in ja:
        ja = f"{ja} ({year})"
    return {"ja": ja, "src": f"wikidata:{best}", "needs_review": review}


SERIES_PROPS = ("P179", "P8345")  # part of the series / media franchise
SRC_RE = re.compile(r"^wikidata:(Q\d+)$")


def series_from_cooccur(tag, cooccur, data, fetch_json, fetch_entities=None):
    """Translate a `_series` tag from the works that share its posts.

    `cooccur` is {work_tag: posts} (fetch_cooccur.py). Each work already settled
    on a Wikidata item votes for the items it is "part of" (P179/P8345), one
    vote per work. Auto-accept only when the winner's English name is the tag's
    own (`gundam_build_series` must not become the whole Gundam franchise just
    because every Build work points there); otherwise needs_review with the
    winner as the suggestion. Works without any series link fall back to a
    review-only suggestion built from their shared Japanese title prefix.
    None when nothing can be derived.
    """
    works = []
    for wt, n in sorted(cooccur.items(), key=lambda kv: -kv[1]):
        e = data.get(wt) or {}
        m = SRC_RE.match(e.get("src") or "")
        if m and e.get("ja") and not e.get("needs_review"):
            works.append((wt, n, m.group(1)))
    if not works:
        return None
    get = fetch_entities or (lambda ids: _entities(fetch_json, ids))
    ents = get([q for _, _, q in works])
    votes, voters = {}, {}
    for wt, n, q in works:
        for s in set().union(*(_claim_ids(ents.get(q, {}), p) for p in SERIES_PROPS)):
            votes[s] = votes.get(s, 0) + 1
            voters.setdefault(s, []).append(wt)
    if not votes:
        return _series_from_titles(works, data)
    sents = get(sorted(votes))
    base = tag[: -len(SERIES_SUFFIX)].replace("_", " ")
    keys = _keys([base, f"{base} series", f"{base} franchise"])
    ranked = []
    for s, v in votes.items():
        e = sents.get(s, {})
        if _ja(e) is None:
            continue
        ranked.append((0 if _name_ok(_en_names(e), keys) else 1, -v, s))
    if not ranked:
        return _series_from_titles(works, data)
    ranked.sort()
    unnamed, _, best = ranked[0]
    return {"ja": _series_ja(_ja(sents[best])), "src": f"wikidata:{best}",
            "needs_review": bool(unnamed), "via": voters[best]}


def _series_ja(ja):
    return ja if "シリーズ" in ja else f"{ja} シリーズ"


def _series_from_titles(works, data):
    """Review-only suggestion: the Japanese title prefix the works share
    (`幽☆遊☆白書`, `幽☆遊☆白書 冥界死闘篇` -> `幽☆遊☆白書 シリーズ`)."""
    titles = [(data[wt]["ja"], q, wt) for wt, _, q in works]
    prefix = titles[0][0]
    for t, _, _ in titles[1:]:
        n = 0
        while n < min(len(prefix), len(t)) and prefix[n] == t[n]:
            n += 1
        prefix = prefix[:n]
    prefix = prefix.strip(" 　:：-−〜~/／・")
    if len(prefix) < 2:
        return None
    ja, q, wt = min(titles, key=lambda x: (not x[0].startswith(prefix), len(x[0])))
    return {"ja": _series_ja(prefix), "src": f"wikidata:{q}", "needs_review": True,
            "via": [wt]}


def _entities(fetch_json, ids):
    ents = {}
    for i in range(0, len(ids), 50):
        ents.update(_api(fetch_json, {"action": "wbgetentities", "ids": "|".join(ids[i:i + 50]),
                                      "props": "labels|aliases|claims|descriptions",
                                      "languages": "en|ja|mul", "format": "json"}
                         ).get("entities", {}))
    return ents


def _api(fetch_json, params):
    """Wikidata API call; an {"error": ...} body (maxlag/readonly) raises so the
    tag is retried on the next run instead of being recorded as "no match"."""
    resp = fetch_json(f"{API}?{urllib.parse.urlencode({**params, 'maxlag': 5})}")
    if isinstance(resp, dict) and "error" in resp:
        raise RuntimeError(f"wikidata error: {resp['error']}")
    return resp


def lookup(query, fetch_json, names=None, year=None, other=False, series=False):
    hits = _api(fetch_json, {"action": "wbsearchentities", "search": query, "type": "item",
                             "language": "en", "format": "json", "limit": 50}).get("search", [])
    keys = _keys(names or [query])
    # Only fetch hits whose label / matched term / alias could pass the name check.
    ids = [h["id"] for h in hits
           if _name_ok([h.get("label", ""), (h.get("match") or {}).get("text", "")]
                       + list(h.get("aliases") or []), keys)]
    if not ids:
        return None
    ents = _entities(fetch_json, ids)
    return decide(ents, order=ids, names=names or [query], year=year, other=other, series=series)


def run(tags, data, fetch_json, limit=None, force=False, on_progress=None, inplace=False,
        only=None, cooccur=None):
    """cooccur: {series_tag: {work_tag: posts}}; a series tag with co-occurrence data
    is derived from its works first and looked up by name only when that fails."""
    if not inplace:
        data = dict(data)
    all_names = {t["name"] for t in tags}
    done = 0
    for t in sorted(tags, key=lambda x: -x["count"]):
        name = t["name"]
        if only is not None and name not in only:
            continue
        if t["count"] < MIN_COUNT or (name in data and not force):
            continue
        plan = tag_plan(name, all_names)
        co = (cooccur or {}).get(name) if name.endswith(SERIES_SUFFIX) else None
        if not plan and not co:
            continue
        if limit is not None and done >= limit:
            break
        done += 1
        try:
            res = series_from_cooccur(name, co, data, fetch_json) if co else None
            for q in plan["queries"] if plan and not res else []:
                res = lookup(q, fetch_json, names=plan["names"], year=plan["year"],
                             other=plan["other"], series=plan["series"])
                if res:
                    break
        except Exception as e:  # one bad tag must not abort the whole run
            print(f"warning: {name}: {type(e).__name__}: {e}", file=sys.stderr)
            continue
        if res:
            res["count"] = t["count"]
            data[name] = res
        else:  # checked, no match: recorded so reruns skip it (build ignores ja=None)
            data[name] = dict(NO_MATCH)
        if on_progress and done % 25 == 0:
            on_progress(data)
    return data


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int)
    ap.add_argument("--sleep", type=float, default=1.0)
    ap.add_argument("--only", help="comma-separated tags; implies --force")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--retry-misses", action="store_true",
                    help="re-process only tags recorded with ja=null (implies --force)")
    ap.add_argument("--series", action="store_true",
                    help="re-process only `_series` tags not yet adopted, using cache/cooccur.json")
    a = ap.parse_args()
    path = ROOT / "data" / "copyrights.json"
    tags = load_tags(ROOT, "copyright")
    if not tags:
        sys.exit("cache/tags.json missing: run fetch_tags.py first")

    def fetch(url):
        return cached(ROOT / "cache" / "wikidata", url, lambda: http_json(url), sleep=a.sleep)

    data = load_json(path)
    before = len(data)
    try:  # inplace: `data` holds every finished tag even if run() is interrupted
        only = set(a.only.split(",")) if a.only else None
        if a.retry_misses:
            only = {k for k, v in data.items() if v.get("ja") is None}
            print(f"retrying {len(only)} misses")
        cooccur = load_json(ROOT / "cache" / "cooccur.json")
        if a.series:
            only = {t["name"] for t in tags if t["name"].endswith(SERIES_SUFFIX)
                    and t["count"] >= MIN_COUNT
                    and (t["name"] not in data or data[t["name"]].get("needs_review"))}
            print(f"series: {len(only)} tags, co-occurrence data for "
                  f"{len(only & set(cooccur))}")
        run(tags, data, fetch, limit=a.limit, force=a.force or only is not None, inplace=True,
            only=only, cooccur=cooccur,
            on_progress=lambda d: save_json(path, d))
    finally:  # also on KeyboardInterrupt
        save_json(path, data)
    print(f"copyrights: {before} -> {len(data)} entries")


if __name__ == "__main__":
    main()
