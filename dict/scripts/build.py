"""Build dist/dict.json, REVIEW.md and COVERAGE.md from data/*.json."""
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import ROOT, load_json, save_json  # noqa: E402

TYPES = ["artists", "copyrights", "general"]
TAG_KIND = {"artists": "artist", "copyrights": "copyright", "general": "general"}
TYPE_ALIASES = {"artist": "artists", "copyright": "copyrights"}
MIN_COUNT = 5
SERIES_SUFFIX = "_series"


def _public(entry):
    out = {"ja": entry["ja"]}
    if entry.get("kana"):
        out["kana"] = entry["kana"]
    return out


def build(root=ROOT, today=None):
    root = Path(root)
    data = {t: load_json(root / "data" / f"{t}.json") for t in TYPES}
    overrides = load_json(root / "data" / "overrides.json")
    tags_cache = load_json(root / "cache" / "tags.json")
    have_cache = bool(tags_cache)

    result = {t: {} for t in TYPES}
    entry_counts = {t: {} for t in TYPES}
    review = []  # (tag, type, entry)

    for t in TYPES:
        for tag, e in data[t].items():
            if e.get("count") is not None:
                entry_counts[t][tag] = e["count"]
            if not e.get("ja"):
                continue
            if e.get("needs_review"):
                if tag not in overrides:  # already resolved by hand
                    review.append((tag, t, e))
                continue
            result[t][tag] = _public(e)

    for tag, e in overrides.items():
        if not e.get("ja"):
            continue
        typ = next((t for t in TYPES if tag in data[t]), None)
        if typ is None:
            typ = TYPE_ALIASES.get(e.get("type"), e.get("type"))
        if typ is None:  # no explicit type: ask the tag cache
            typ = next((TYPE_ALIASES[k] for k in ("artist", "copyright")
                        if any(x["name"] == tag for x in tags_cache.get(k, []))), None)
        if typ not in TYPES:
            typ = "general"
        if e.get("count") is not None:
            entry_counts[typ][tag] = e["count"]
        result[typ][tag] = _public(e)

    # tag -> count per type (cache preferred)
    totals = {}
    for t in TYPES:
        if have_cache:
            totals[t] = {x["name"]: x["count"] for x in tags_cache.get(TAG_KIND[t], [])
                         if x["count"] >= MIN_COUNT}
        else:
            totals[t] = {k: c for k, c in entry_counts[t].items() if c >= MIN_COUNT}
    cache_all = {t: {x["name"]: x["count"] for x in tags_cache.get(TAG_KIND[t], [])}
                 for t in TYPES}

    # _series fallback for copyrights
    cop = result["copyrights"]
    names = set(cop)
    if have_cache:
        names |= {n for n in cache_all["copyrights"]}
    for tag in sorted(names):
        if tag.endswith(SERIES_SUFFIX) and tag not in cop:
            base = tag[: -len(SERIES_SUFFIX)]
            if base in cop:
                cop[tag] = {"ja": cop[base]["ja"] + " シリーズ"}

    # counts is one flat {tag: n} map, but the same name can be translated in two
    # types (e.g. an artist and a general tag). Count each per its own type and,
    # on a collision, keep the larger count rather than whichever type came last.
    counts = {}
    for t in TYPES:
        for tag in result[t]:
            c = cache_all[t].get(tag, entry_counts[t].get(tag))
            if c is not None and c > counts.get(tag, -1):
                counts[tag] = c

    dist = {
        "v": 1,
        "updated": (today or date.today()).isoformat(),
        **{t: dict(sorted(result[t].items())) for t in TYPES},
        "counts": dict(sorted(counts.items())),
    }
    save_json(root / "dist" / "dict.json", dist)

    # REVIEW.md
    review.sort(key=lambda r: -(r[2].get("count") or 0))
    lines = ["# Review queue", "",
             "needs_review entries (excluded from dist). Fix via data/overrides.json.", "",
             "| tag | 候補 | 出典 | 投稿数 |", "|---|---|---|---|"]
    for tag, _t, e in review:
        lines.append(f"| {tag} | {e['ja']} | {e.get('src', '')} | {e.get('count', '')} |")
    (root / "REVIEW.md").write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")

    # COVERAGE.md
    lines = ["# Coverage", "", f"Updated {dist['updated']} (tags with count >= {MIN_COUNT})", "",
             "| type | translated / total | post-weighted |", "|---|---|---|"]
    for t in TYPES:
        tot = totals[t]
        done = [k for k in result[t] if k in tot]
        n_tot = len(tot)
        s_tot = sum(tot.values())
        s_done = sum(tot[k] for k in done)
        pct_n = 100 * len(done) / n_tot if n_tot else 0
        pct_s = 100 * s_done / s_tot if s_tot else 0
        lines.append(f"| {t} | {len(done)} / {n_tot} ({pct_n:.1f}%) | "
                     f"{s_done} / {s_tot} ({pct_s:.1f}%) |")
    (root / "COVERAGE.md").write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")
    return dist


if __name__ == "__main__":
    d = build()
    print({t: len(d[t]) for t in TYPES}, d["updated"])
