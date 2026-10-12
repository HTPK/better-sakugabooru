"""Download all Sakugabooru tags (count >= 1) into cache/tags.json."""
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import ROOT, http_json, load_json, save_json  # noqa: E402

BASE = "https://www.sakugabooru.com/tag.json"
KINDS = [("artist", 1), ("copyright", 3), ("general", 0), ("character", 4)]
PAGE = 1000
MAX_PAGES = 50  # per type; guards against a runaway loop


def fetch_all(fetch_json, sleep=0.5, sleep_fn=time.sleep, on_type=None):
    """fetch_json(url) -> list of tag dicts. Returns {kind: [{name, count}]}.

    on_type(out) is called after each kind completes, so callers can persist
    partial results before a later kind fails.
    """
    out = {}
    for kind, type_id in KINDS:
        rows = []
        prev_first = None
        for page in range(1, MAX_PAGES + 1):
            url = f"{BASE}?type={type_id}&order=count&limit={PAGE}&page={page}"
            batch = fetch_json(url)
            first = batch[0]["name"] if batch else None
            if page > 1 and first is not None and first == prev_first:
                break  # server ignored `page` and returned the same page again
            prev_first = first
            rows.extend({"name": t["name"], "count": t["count"]}
                        for t in batch if t["count"] >= 1)
            if len(batch) < PAGE or batch[-1]["count"] < 1:
                break
            if sleep:
                sleep_fn(sleep)
        out[kind] = rows
        if on_type:
            on_type(out)
        if sleep:
            sleep_fn(sleep)
    return out


def main():
    path = ROOT / "cache" / "tags.json"
    merged = load_json(path)

    def save_partial(out):
        merged.update(out)
        save_json(path, merged)

    res = fetch_all(http_json, on_type=save_partial)
    print({k: len(v) for k, v in res.items()})


if __name__ == "__main__":
    main()
