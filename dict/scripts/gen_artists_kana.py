"""Fill untranslated artist tags by matching the kana reading of Wikidata persons.

gen_artists.py only matches English labels, so people who have just a Japanese
label (田中宏紀, すしお, ...) were missed. Here the reading (Wikidata P1814, else
the ふりがな / lead of the person's ja.wikipedia article) is transliterated to
Hepburn romaji and compared with the tag. Sources: Wikidata + jawiki only.
"""
import argparse
import re
import sys
import unicodedata
import urllib.parse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import ROOT, cached, http_json, load_json, load_tags, save_json  # noqa: E402
from gen_artists import (DIRECTOR_OCCUPATIONS, MIN_COUNT, STRONG_OCCUPATIONS,  # noqa: E402,F401
                         normalize_kana, strip_label_suffix)

SPARQL = "https://query.wikidata.org/sparql"
JAWIKI_API = "https://ja.wikipedia.org/w/api.php"
STRONG = set(STRONG_OCCUPATIONS) | {"Q1686939"}  # animator, character designer, anime director
WEAK = {"Q2526255", "Q3455803", "Q715301", "Q644687"}  # film dir., director, manga artist, illustrator
SPARQL_KEY = "sparql-v1"
READING_OK = re.compile(r"^[ぁ-ゖー・ ]+$")

# ---------------------------------------------------------------- kana -> romaji
_BASE = {}
for _k, _v in {
    "あいうえお": ["a", "i", "u", "e", "o"],
    "かきくけこ": ["ka", "ki", "ku", "ke", "ko"],
    "がぎぐげご": ["ga", "gi", "gu", "ge", "go"],
    "さしすせそ": ["sa", "shi", "su", "se", "so"],
    "ざじずぜぞ": ["za", "ji", "zu", "ze", "zo"],
    "たちつてと": ["ta", "chi", "tsu", "te", "to"],
    "だぢづでど": ["da", "ji", "zu", "de", "do"],
    "なにぬねの": ["na", "ni", "nu", "ne", "no"],
    "はひふへほ": ["ha", "hi", "fu", "he", "ho"],
    "ばびぶべぼ": ["ba", "bi", "bu", "be", "bo"],
    "ぱぴぷぺぽ": ["pa", "pi", "pu", "pe", "po"],
    "まみむめも": ["ma", "mi", "mu", "me", "mo"],
    "やゆよ": ["ya", "yu", "yo"],
    "らりるれろ": ["ra", "ri", "ru", "re", "ro"],
    "わゐゑを": ["wa", "i", "e", "o"],
}.items():
    _BASE.update(zip(_k, _v))
_BASE.update({"ん": "n", "ゔ": "vu", "ゎ": "wa"})
_SMALL_Y = {"ゃ": "a", "ゅ": "u", "ょ": "o"}
_SMALL_V = {"ぁ": "a", "ぃ": "i", "ぅ": "u", "ぇ": "e", "ぉ": "o"}
_PALATAL = {"し": "sh", "ち": "ch", "じ": "j", "ぢ": "j"}  # + ゃゅょ -> sha, cha, ja ...


def _stem(ch):
    """Consonant part of a base syllable (`き` -> `k`, `し` -> `sh`, `う` -> `w`)."""
    if ch in _PALATAL:
        return _PALATAL[ch]
    if ch == "う":
        return "w"
    r = _BASE.get(ch, "")
    return r[:-1] if len(r) > 1 else ""


def kana_to_romaji(hira):
    """Hepburn romaji of a hiragana string (っ doubles; ん -> n; ー dropped; ・/space -> space).

    っ + ch gives `tch` (まっち -> `matchi`); norm_romaji maps `cch` to `tch` too.
    """
    out, i, geminate = [], 0, False
    while i < len(hira):
        c = hira[i]
        nxt = hira[i + 1] if i + 1 < len(hira) else ""
        if c == "っ":
            geminate = True
            i += 1
            continue
        if c in " 　・":
            out.append(" ")
            geminate = False
            i += 1
            continue
        if c == "ー":
            i += 1
            continue
        if c not in _BASE:
            i += 1
            continue
        if nxt in _SMALL_Y and c in _BASE:
            syl = (_PALATAL[c] if c in _PALATAL else _stem(c) + "y") + _SMALL_Y[nxt]
            i += 2
        elif nxt in _SMALL_V and c in "ふてでうしちじゔ":
            stem = {"て": "t", "で": "d", "ゔ": "v"}.get(c) or _stem(c) or "f"
            syl = stem + _SMALL_V[nxt]
            if c == "ふ":
                syl = "f" + _SMALL_V[nxt]
            i += 2
        else:
            syl = _BASE[c]
            i += 1
        if geminate and syl[0] not in "aiueon":
            out.append("t" if syl.startswith("ch") else syl[0])
        geminate = False
        out.append(syl)
    return "".join(out).strip()


_KUNREI = [
    (r"dzu|du", "zu"), (r"cch", "tch"),
    (r"jy([aiueo])", r"j\1"), (r"zy([aiueo])", r"j\1"),
    (r"ty([aiueo])", r"ch\1"), (r"sy([aiueo])", r"sh\1"),
    (r"(?<![sc])hu", "fu"), (r"si", "shi"), (r"ti", "chi"), (r"tu", "tsu"), (r"zi", "ji"),
]


def norm_romaji(s):
    """Comparison key: lowercase a-z, kunrei -> Hepburn, long vowels collapsed."""
    s = unicodedata.normalize("NFKD", s or "").lower()
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = re.sub(r"[^a-z]+", " ", s)
    for pat, rep in _KUNREI:
        s = re.sub(pat, rep, s)
    s = re.sub(r"oh(?=[^aeiouy]|$)", "o", s)
    s = s.replace(" ", "")
    prev = None
    while prev != s:
        prev = s
        s = re.sub(r"oo|ou", "o", s)
        s = s.replace("uu", "u").replace("aa", "a")
    s = re.sub(r"m(?=[bp])", "n", s)
    return re.sub(r"[^a-z]", "", s)


# ---------------------------------------------------------------- reading parsing
_LEAD_RE = re.compile(r"'''[^']+'''\s*[（(]\s*([ぁ-ゖー\s　・]+?)\s*[、,）)]")
_FURIGANA_RE = re.compile(r"^\s*\|\s*ふりがな\s*=\s*(.*)$", re.M)


def _clean_reading(raw):
    raw = re.sub(r"<[^>]*>|\[\[|\]\]|'''|''", " ", raw or "")
    raw = re.split(r"[、,（(/／]", raw)[0]
    r = normalize_kana(raw)
    return r if r and READING_OK.match(r) else None


def parse_reading(wikitext):
    """Reading (hiragana, one ASCII space between tokens) from a jawiki article, or None."""
    m = _FURIGANA_RE.search(wikitext or "")
    if m:
        r = _clean_reading(m.group(1))
        if r:
            return r
    m = _LEAD_RE.search((wikitext or "")[:3000])
    if m:
        return _clean_reading(m.group(1))
    return None


# ---------------------------------------------------------------- data fetching
def _sparql_query(occs):
    vals = " ".join(f"wd:{q}" for q in sorted(occs))
    return ("SELECT ?p ?jaLabel ?occ ?kana ?title WHERE { "
            f"VALUES ?occ {{ {vals} }} ?p wdt:P106 ?occ . "
            + ("?p wdt:P27 wd:Q17 . " if not set(occs) & STRONG else "")  # weak: Japanese only (else WDQS times out)
            +             "?p rdfs:label ?jaLabel . FILTER(LANG(?jaLabel) = \"ja\") "
            "OPTIONAL { ?p wdt:P1814 ?kana } "
            "OPTIONAL { ?art schema:about ?p ; "
            "schema:isPartOf <https://ja.wikipedia.org/> ; schema:name ?title } }")


def _sparql_url(occs):
    return SPARQL + "?" + urllib.parse.urlencode({"query": _sparql_query(occs), "format": "json"})


def aggregate_rows(bindings):
    items = {}
    for b in bindings:
        qid = b["p"]["value"].rsplit("/", 1)[-1]
        it = items.setdefault(qid, {"ja": b["jaLabel"]["value"], "kana": None, "title": None,
                                    "occs": set()})
        it["occs"].add(b["occ"]["value"].rsplit("/", 1)[-1])
        if not it["kana"] and "kana" in b:
            k = normalize_kana(b["kana"]["value"])
            if k and READING_OK.match(k):
                it["kana"] = k
        if not it["title"] and "title" in b:
            it["title"] = b["title"]["value"]
    return items


def fetch_items(fetch):
    """fetch(key, url) -> parsed JSON. One query per occupation (cached under sparql-v1:Qn)."""
    allocc = STRONG | WEAK
    # The combined query (all 7 occupations) always hits the WDQS 60 s limit, so
    # query per occupation; weak ones are limited to Japanese citizens.
    rows = []
    for q in sorted(allocc):
        try:
            rows += fetch(f"{SPARQL_KEY}:{q}", _sparql_url({q}))["results"]["bindings"]
        except Exception as e:  # keep the other occupations; rerun retries (failures are not cached)
            print(f"warning: SPARQL for {q} failed ({type(e).__name__}: {e})", file=sys.stderr)
    return aggregate_rows(rows)


def fetch_jawiki_readings(titles, fetch, batch=50, max_batches=None):
    """{title: reading} for jawiki titles; fetch(key, url) -> parsed JSON."""
    out, titles = {}, sorted(set(titles))
    for n, i in enumerate(range(0, len(titles), batch)):
        if max_batches is not None and n >= max_batches:
            break
        chunk = titles[i:i + batch]
        url = JAWIKI_API + "?" + urllib.parse.urlencode({
            "action": "query", "prop": "revisions", "rvprop": "content", "rvslots": "main",
            "format": "json", "formatversion": 2, "redirects": 1, "titles": "|".join(chunk)})
        resp = fetch("jawiki:" + "|".join(chunk), url)
        q = resp.get("query", {})
        back = {}  # normalized/redirected title -> requested title
        for rec in q.get("normalized", []):
            back[rec["to"]] = rec["from"]
        for rec in q.get("redirects", []):
            back[rec["to"]] = back.get(rec["from"], rec["from"])
        for page in q.get("pages", []):
            revs = page.get("revisions") or []
            if not revs:
                continue
            text = revs[0].get("slots", {}).get("main", {}).get("content", "")
            r = parse_reading(text)
            if r:
                out[back.get(page["title"], page["title"])] = r
    return out


# ---------------------------------------------------------------- matching
def forms_for_reading(kana):
    toks = [norm_romaji(kana_to_romaji(t)) for t in kana.split() if t]
    toks = [t for t in toks if t]
    if not toks:
        return set()
    return {"".join(toks), "".join(reversed(toks))}


def build_index(items):
    index = {}
    for qid, it in items.items():
        if it.get("kana"):
            for f in forms_for_reading(it["kana"]):
                index.setdefault(f, []).append(qid)
    return index


def tag_forms(tag):
    tag = re.sub(r"_\([^)]*\)$", "", tag)
    if tag == "artist_unknown" or any(c.isdigit() for c in tag):
        return set()
    toks = [t for t in tag.split("_") if t]
    if not 1 <= len(toks) <= 3:
        return set()
    forms = {norm_romaji("".join(toks)), norm_romaji("".join(reversed(toks)))}
    forms.discard("")
    if len(toks) == 1 and any(len(f) < 4 for f in forms):  # single-token tags: mononyms only
        return set()
    return forms


def decide(tag, index, items):
    forms = tag_forms(tag)
    cands = sorted({q for f in forms for q in index.get(f, [])})
    if not cands:
        return None
    strong = [q for q in cands if items[q]["occs"] & STRONG]
    best = sorted(cands, key=lambda q: (q not in strong, not items[q].get("title"),
                                        int(q[1:]) if q[1:].isdigit() else 0))[0]
    it = items[best]
    out = {"ja": strip_label_suffix(it["ja"]), "needs_review": not (len(strong) == 1),
           "src": f"wikidata:{best}"}
    if it.get("kana"):
        out["kana"] = it["kana"]
    return out


def untranslated(tags, data, overrides, min_count=MIN_COUNT):
    res = []
    for t in sorted(tags, key=lambda x: -x["count"]):
        n = t["name"]
        if t["count"] < min_count or n in overrides:
            continue
        if n in data and data[n].get("ja"):
            continue
        res.append(t)
    return res


def run(tags, data, items, index, limit=None, min_count=MIN_COUNT, overrides=None):
    """Returns (new_data, accepted, review, unmatched, examined). `data` is not modified."""
    data = dict(data)
    accepted, review, unmatched, examined = [], [], 0, 0
    for t in untranslated(tags, data, overrides or {}, min_count):
        if not tag_forms(t["name"]):
            continue
        if limit is not None and examined >= limit:
            break
        examined += 1
        res = decide(t["name"], index, items)
        if not res:
            unmatched += 1
            continue
        res["count"] = t["count"]
        data[t["name"]] = res
        (review if res["needs_review"] else accepted).append((t["name"], res))
    return data, accepted, review, unmatched, examined


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--limit", type=int, help="examine at most N tags (and ceil(N/10) jawiki batches)")
    ap.add_argument("--min-count", type=int, default=MIN_COUNT)
    a = ap.parse_args()
    tags = load_tags(ROOT, "artist")
    if not tags:
        sys.exit("cache/tags.json missing: run fetch_tags.py first")
    path = ROOT / "data" / "artists.json"
    data = load_json(path)
    overrides = load_json(ROOT / "data" / "overrides.json")

    def fetch_wd(key, url):
        return cached(ROOT / "cache" / "wikidata-kana", key, lambda: http_json(url), sleep=1.0)

    def fetch_wp(key, url):
        return cached(ROOT / "cache" / "jawiki", key, lambda: http_json(url), sleep=1.0)

    items = fetch_items(fetch_wd)
    from_wd = sum(1 for it in items.values() if it["kana"])
    need = [it["title"] for it in items.values() if it["title"] and not it["kana"]]
    mb = None if a.limit is None else max(1, -(-a.limit // 10))
    readings = fetch_jawiki_readings(need, fetch_wp, max_batches=mb)
    from_wp = 0
    for it in items.values():
        if not it["kana"] and it["title"] in readings:
            it["kana"] = readings[it["title"]]
            from_wp += 1
    index = build_index(items)
    new, acc, rev, unm, ex = run(tags, data, items, index, a.limit, a.min_count, overrides)
    print(f"items: {len(items)}; kana from Wikidata: {from_wd}; from jawiki: {from_wp} "
          f"(of {len(need)} titles tried)")
    print(f"tags examined: {ex}; accepted: {len(acc)}; review: {len(rev)}; unmatched: {unm}")
    print("top accepted:")
    for n, e in sorted(acc, key=lambda x: -x[1]["count"])[:20]:
        print(f"  {n} -> {e['ja']} ({e.get('kana', '')}) [{e['count']}]")
    if not a.dry_run:
        save_json(path, new)
        print(f"wrote {path}")


if __name__ == "__main__":
    main()
