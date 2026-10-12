"""Generate data/artists.json by matching artist tags to Wikidata entities."""
import argparse
import itertools
import json
import re
import sys
import time
import unicodedata
import urllib.parse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import ROOT, cached, http_json, load_json, load_tags, save_json  # noqa: E402

API = "https://www.wikidata.org/w/api.php"
MIN_COUNT = 5
MAX_QUERIES = 8
# P106 (occupation) values. Only STRONG ones (or an English description matching
# /anim/i) can be auto-accepted; DIRECTOR ones only make an entity a candidate
# for review (same-name live-action directors are common false positives).
STRONG_OCCUPATIONS = {
    "Q266569",   # animator
    "Q1114448",  # character designer
}
DIRECTOR_OCCUPATIONS = {
    "Q3455803",  # director
    "Q2526255",  # film director
    "Q1686939",  # anime director (verify on Wikidata; harmless if unused)
}  # Q3282637 (film producer) is deliberately NOT a candidate.
NO_MATCH = {"ja": None, "needs_review": True, "src": "wikidata:none"}
NO_MATCH_FINAL = {"ja": None, "needs_review": True, "src": "none"}
STAFF_URL = "https://graphql.an external database.co"
STAFF_QUERY = ("query ($q:String){ Page(perPage:10){ staff(search:$q){ id "
               "name{ full native alternative } primaryOccupations } } }")
CJK_RE = re.compile(r"[぀-ヿ㐀-鿿豈-﫿]")
SUFFIX_RE = re.compile(r"\s*[(（][^()（）]*[)）]\s*$")


def strip_label_suffix(s):
    """Drop a trailing disambiguation group: `中村豊 (アニメーター)` -> `中村豊`."""
    return SUFFIX_RE.sub("", s).strip()


def staff_lookup(names, post):
    """an external database staff fallback; returns entry dict or None."""
    forms = _name_forms(names)
    if not forms:
        return None
    hits = []
    for q in names[:1]:
        resp = post({"query": STAFF_QUERY, "variables": {"q": q}})
        staff = (((resp or {}).get("data") or {}).get("Page") or {}).get("staff") or []
        for st in staff:
            nm = st.get("name") or {}
            native = (nm.get("native") or "").strip()
            if native and CJK_RE.search(native) and _norm_name(nm.get("full")) in forms:
                hits.append((st["id"], native))
    if not hits:
        return None
    return {"ja": hits[0][1], "src": f"an external database-staff:{hits[0][0]}",
            "needs_review": len(hits) > 1}
KANA_RE =re.compile(r"^[぀-ゟ゠-ヿ　 ]+$")


def tag_to_queries(tag):
    tag = re.sub(r"_\([^)]*\)$", "", tag)
    if tag == "artist_unknown" or any(c.isdigit() for c in tag):
        return []
    tokens = [t for t in tag.split("_") if t]
    if len(tokens) < 2:
        return []
    cap = [t.capitalize() for t in tokens]
    out = [" ".join(cap)]
    short = [t.lower().replace("uu", "u").replace("oo", "o").replace("ou", "o").capitalize()
             for t in tokens]
    out.append(" ".join(short))
    out.append(" ".join(cap[-1:] + cap[:-1]))
    out += [" ".join(c) for c in itertools.product(*[_variants(t) for t in cap])]
    seen, res = set(), []
    for q in out:
        if q not in seen:
            seen.add(q)
            res.append(q)
    return res[:MAX_QUERIES]


def _variants(tok):
    """Token alternatives: as-is, macronised (oh/ou/oo -> o-macron, uu -> u-macron), macron-stripped."""
    mac = re.sub(r"oh|ou|oo", "ō", tok, flags=re.I)
    mac = re.sub(r"uu", "ū", mac, flags=re.I)
    plain = mac.replace("ō", "o").replace("ū", "u")
    return list(dict.fromkeys([tok, mac[:1].upper() + mac[1:], plain[:1].upper() + plain[1:]]))


def normalize_kana(s):
    """Katakana -> hiragana, whitespace runs (incl. U+3000) -> one ASCII space."""
    s = "".join(chr(ord(c) - 0x60) if "ァ" <= c <= "ヶ" else c for c in s)
    return re.sub(r"\s+", " ", s).strip()


def _kana(e):
    for c in e.get("claims", {}).get("P1814", []):
        v = c.get("mainsnak", {}).get("datavalue", {}).get("value")
        if isinstance(v, str) and v.strip():
            return normalize_kana(v)
    for a in e.get("aliases", {}).get("ja", []):
        if KANA_RE.match(a.get("value", "")):
            return normalize_kana(a["value"])
    return None


def _norm_name(s):
    """Lowercase ASCII letters only; accents folded (Ō -> o) before stripping."""
    s = unicodedata.normalize("NFKD", s or "").lower()
    return re.sub(r"[^a-z]", "", s)


def _name_forms(names):
    forms = set()
    for n in names or []:
        toks = n.split()
        forms.add(_norm_name(" ".join(toks)))
        forms.add(_norm_name(" ".join(reversed(toks))))
    forms.discard("")
    return forms


def _occupations(e):
    return {c.get("mainsnak", {}).get("datavalue", {}).get("value", {}).get("id")
            for c in e.get("claims", {}).get("P106", [])
            if isinstance(c.get("mainsnak", {}).get("datavalue", {}).get("value"), dict)}


def _desc(e):
    return e.get("descriptions", {}).get("en", {}).get("value", "")


def _strong(e):
    return bool(_occupations(e) & STRONG_OCCUPATIONS) or bool(re.search(r"anim", _desc(e), re.I))


def _candidate(e):
    return bool(e.get("labels", {}).get("ja")) and (
        _strong(e) or bool(_occupations(e) & DIRECTOR_OCCUPATIONS))


def _name_ok(e, forms):
    en = [e.get("labels", {}).get("en", {}).get("value", "")]
    en += [a.get("value", "") for a in e.get("aliases", {}).get("en", [])]
    return any(_norm_name(x) in forms for x in en)


def decide(entities, order=None, names=None):
    """entities: wbgetentities 'entities' dict; names: the query strings for the tag.

    Returns entry dict or None. Auto-accept (needs_review False) requires an
    animator/character-designer occupation (or /anim/i description), an English
    label/alias equal to a query name in either order, a ja label, and no other
    plausible (name-matching) candidate. Everything else is kept for review.
    """
    forms = _name_forms(names)
    qids = [q for q in (order or list(entities)) if q in entities]
    cands = [q for q in qids if _candidate(entities[q])]
    if not cands:
        return None
    name_ok = {q: _name_ok(entities[q], forms) for q in cands}
    accepted = {q: name_ok[q] and _strong(entities[q]) for q in cands}
    cands.sort(key=lambda q: (not accepted[q], not name_ok[q], not _strong(entities[q])))
    best = cands[0]
    plausible = [q for q in cands if name_ok[q]] if forms else cands
    e = entities[best]
    out = {"ja": strip_label_suffix(e["labels"]["ja"]["value"])}
    kana = _kana(e)
    if kana:
        out["kana"] = kana
    out["src"] = f"wikidata:{best}"
    out["needs_review"] = not accepted[best] or len(plausible) > 1
    return out


def _api(fetch_json, params):
    """Wikidata API call; an {"error": ...} body (maxlag/readonly) raises so the
    tag is retried on the next run instead of being recorded as "no match"."""
    resp = fetch_json(f"{API}?{urllib.parse.urlencode({**params, 'maxlag': 5})}")
    if isinstance(resp, dict) and "error" in resp:
        raise RuntimeError(f"wikidata error: {resp['error']}")
    return resp


def lookup(query, fetch_json, names=None):
    hits = _api(fetch_json, {"action": "wbsearchentities", "search": query, "type": "item",
                             "language": "en", "format": "json", "limit": 50}).get("search", [])
    if not hits:
        return None
    if len(hits) > 10:  # animator-looking descriptions first (stable)
        hits = sorted(hits, key=lambda h: not re.search(r"anim|アニメ", h.get("description", ""), re.I))
    ids = [h["id"] for h in hits]
    ents = {}
    for i in range(0, len(ids), 50):
        ents.update(_api(fetch_json, {"action": "wbgetentities", "ids": "|".join(ids[i:i + 50]),
                                      "props": "labels|aliases|claims|descriptions",
                                      "languages": "en|ja", "format": "json"}).get("entities", {}))
    return decide(ents, order=ids, names=names or [query])


def run(tags, data, fetch_json, limit=None, force=False, on_progress=None, inplace=False,
        only=None, post=None):
    if not inplace:
        data = dict(data)
    done = 0
    for t in sorted(tags, key=lambda x: -x["count"]):
        name = t["name"]
        if only is not None and name not in only:
            continue
        if t["count"] < MIN_COUNT or (name in data and not force):
            continue
        queries = tag_to_queries(name)
        if not queries:
            continue
        if limit is not None and done >= limit:
            break
        done += 1
        try:
            res = None
            for q in queries:
                res = lookup(q, fetch_json, names=queries)
                if res:
                    break
        except Exception as e:  # one bad tag must not abort the whole run
            print(f"warning: {name}: {type(e).__name__}: {e}", file=sys.stderr)
            continue
        if (not res or not res.get("ja")) and post is not None:
            try:
                res = staff_lookup(queries, post)
            except Exception as e:
                print(f"warning: {name}: staff {type(e).__name__}: {e}", file=sys.stderr)
                continue
            if res is None:
                data[name] = dict(NO_MATCH_FINAL)
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
    ap.add_argument("--no-staff", action="store_true",
                    help="skip the an external database staff fallback (Wikidata only)")
    ap.add_argument("--retry-misses", action="store_true",
                    help="re-process only tags recorded with ja=null (implies --force)")
    ap.add_argument("--staff-sleep", type=float, default=2.1,
                    help="seconds between an external database calls (an external database allows ~30/min)")
    a = ap.parse_args()
    path = ROOT / "data" / "artists.json"
    tags = load_tags(ROOT, "artist")
    if not tags:
        sys.exit("cache/tags.json missing: run fetch_tags.py first")

    def fetch(url):
        return cached(ROOT / "cache" / "wikidata", url, lambda: http_json(url), sleep=a.sleep)

    def post(payload):
        body = json.dumps(payload, sort_keys=True)

        def go():  # http_json waits Retry-After on HTTP 429 and retries
            return http_json(STAFF_URL, data=body.encode("utf-8"),
                             headers={"Content-Type": "application/json"})
        return cached(ROOT / "cache" / "an external database_staff", body, go, sleep=a.staff_sleep)

    data = load_json(path)
    before = len(data)
    try:  # inplace: `data` holds every finished tag even if run() is interrupted
        only = set(a.only.split(",")) if a.only else None
        if a.retry_misses:
            only = {k for k, v in data.items() if v.get("ja") is None}
            print(f"retrying {len(only)} misses")
        run(tags, data, fetch, limit=a.limit, force=a.force or only is not None, inplace=True,
            only=only, post=None if a.no_staff else post,
            on_progress=lambda d: save_json(path, d))
    finally:  # also on KeyboardInterrupt
        save_json(path, data)
    print(f"artists: {before} -> {len(data)} entries")


if __name__ == "__main__":
    main()
