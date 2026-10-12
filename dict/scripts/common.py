"""Shared helpers for the dictionary generators (stdlib only)."""
import hashlib
import json
import os
import socket
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
USER_AGENT = "sakugabooru-ja-dict/0.1 (https://github.com/HTPK/sakugabooru-ja-dict/issues)"
# Transient failures retried with exponential backoff (socket.timeout is TimeoutError).
TRANSIENT = (urllib.error.URLError, TimeoutError, socket.timeout,
             ConnectionResetError, json.JSONDecodeError)


def load_json(path, default=None):
    path = Path(path)
    if not path.exists():
        return {} if default is None else default
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def save_json(path, obj):
    """Pretty-printed, key-sorted, UTF-8 (no BOM), trailing newline."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(obj, f, indent=2, ensure_ascii=False, sort_keys=True)
        f.write("\n")


def md5(text):
    return hashlib.md5(text.encode("utf-8")).hexdigest()


def http_json(url, data=None, headers=None, retries=3, sleep_fn=time.sleep):
    """GET (or POST when data is bytes) returning parsed JSON.

    Retries on 5xx, timeouts, connection resets and truncated/invalid JSON;
    on 429 waits Retry-After seconds (default 60).
    """
    hdrs = {"User-Agent": USER_AGENT, "Accept": "application/json"}
    if headers:
        hdrs.update(headers)
    for attempt in range(retries + 1):
        req = urllib.request.Request(url, data=data, headers=hdrs)
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if attempt >= retries:
                raise
            if e.code == 429:
                try:
                    wait = float(e.headers.get("Retry-After", "60"))
                except ValueError:
                    wait = 60.0
                sleep_fn(wait + 1)
            elif e.code >= 500:
                sleep_fn(2 ** attempt * 2)
            else:
                raise
        except TRANSIENT:  # HTTPError (a URLError subclass) is handled above
            if attempt >= retries:
                raise
            sleep_fn(2 ** attempt * 2)


def cached(cache_dir, key, producer, sleep=0.0, sleep_fn=time.sleep):
    """Return cached JSON for `key` (any str), else call producer() and store.

    A corrupt cache file is treated as a miss. Responses that are a dict with an
    "error" key (e.g. Wikidata maxlag/readonly) are returned but never stored.
    Writes go to a .tmp file first and are moved into place with os.replace.
    """
    cache_dir = Path(cache_dir)
    p = cache_dir / (md5(key) + ".json")
    if p.exists():
        try:
            return load_json(p)
        except (json.JSONDecodeError, UnicodeDecodeError):
            pass  # corrupt (e.g. interrupted write) -> re-fetch
    if sleep:
        sleep_fn(sleep)
    result = producer()
    if isinstance(result, dict) and "error" in result:
        return result
    cache_dir.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        json.dump(result, f, ensure_ascii=False)
    os.replace(tmp, p)
    return result


def load_tags(root, kind):
    """Tags of one kind (artist/copyright/general/character) from cache/tags.json."""
    return load_json(Path(root) / "cache" / "tags.json").get(kind, [])
