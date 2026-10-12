import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import fetch_tags  # noqa: E402


def test_paginates_until_short_page_and_filters_count():
    pages = {
        ("1", 1): [{"name": f"a{i}", "count": 5000 - i} for i in range(1000)],
        ("1", 2): [{"name": "z", "count": 3}, {"name": "zero", "count": 0}],
    }
    calls = []

    def fake(url):
        calls.append(url)
        t = url.split("type=")[1].split("&")[0]
        p = int(url.split("page=")[1])
        return pages.get((t, p), [])

    res = fetch_tags.fetch_all(fake, sleep=0)
    assert set(res) == {"artist", "copyright", "general", "character"}
    assert len(res["artist"]) == 1001  # 1000 + z; zero (count 0) dropped
    assert res["artist"][-1] == {"name": "z", "count": 3}
    assert res["copyright"] == []
    assert sum("type=1&" in u for u in calls) == 2


def test_stops_when_last_count_below_one():
    full = [{"name": f"b{i}", "count": 1 if i < 999 else 0} for i in range(1000)]
    calls = []

    def fake(url):
        calls.append(url)
        return full if "page=1" in url and "type=1&" in url else []

    res = fetch_tags.fetch_all(fake, sleep=0)
    assert len(res["artist"]) == 999
    assert sum("type=1&" in u for u in calls) == 1


def test_stops_when_server_ignores_page():
    full = [{"name": f"c{i}", "count": 10} for i in range(1000)]
    calls = []

    def fake(url):
        calls.append(url)
        return full if "type=1&" in url else []

    res = fetch_tags.fetch_all(fake, sleep=0)
    assert sum("type=1&" in u for u in calls) == 2  # page 2 repeats page 1 -> stop
    assert len(res["artist"]) == 1000  # duplicate page not appended


def test_page_cap(monkeypatch):
    monkeypatch.setattr(fetch_tags, "MAX_PAGES", 3)
    calls = []

    def fake(url):
        calls.append(url)
        if "type=1&" not in url:
            return []
        p = int(url.split("page=")[1])
        return [{"name": f"p{p}_{i}", "count": 10} for i in range(1000)]

    res = fetch_tags.fetch_all(fake, sleep=0)
    assert sum("type=1&" in u for u in calls) == 3
    assert len(res["artist"]) == 3000


def test_on_type_callback_gets_partial_results():
    seen = []

    def fake(url):
        if "type=3&" in url:
            raise RuntimeError("boom")
        return [{"name": "a", "count": 5}]

    try:
        fetch_tags.fetch_all(fake, sleep=0, on_type=lambda out: seen.append(dict(out)))
    except RuntimeError:
        pass
    assert seen == [{"artist": [{"name": "a", "count": 5}]}]
