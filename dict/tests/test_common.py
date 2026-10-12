import io
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import common  # noqa: E402


class FakeResp(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def test_http_json_retries_on_timeout(monkeypatch):
    calls = []

    def fake_urlopen(req, timeout=None):
        calls.append(req)
        if len(calls) == 1:
            raise TimeoutError("slow")
        return FakeResp(b'{"ok": 1}')

    monkeypatch.setattr(common.urllib.request, "urlopen", fake_urlopen)
    sleeps = []
    assert common.http_json("http://x", sleep_fn=sleeps.append) == {"ok": 1}
    assert len(calls) == 2 and sleeps == [2]


def test_http_json_retries_on_reset_and_bad_json(monkeypatch):
    seq = [ConnectionResetError(), b"not json", b'{"ok": 2}']

    def fake_urlopen(req, timeout=None):
        x = seq.pop(0)
        if isinstance(x, Exception):
            raise x
        return FakeResp(x)

    monkeypatch.setattr(common.urllib.request, "urlopen", fake_urlopen)
    assert common.http_json("http://x", sleep_fn=lambda s: None) == {"ok": 2}


def test_user_agent_has_no_email():
    assert "@" not in common.USER_AGENT
    assert common.USER_AGENT.startswith("sakugabooru-ja-dict/0.1 ")


def test_cached_does_not_store_error_response(tmp_path):
    n = []

    def prod():
        n.append(1)
        return {"error": {"code": "maxlag"}}

    assert common.cached(tmp_path, "k", prod) == {"error": {"code": "maxlag"}}
    assert list(tmp_path.glob("*.json")) == []
    common.cached(tmp_path, "k", prod)
    assert len(n) == 2


def test_cached_writes_atomically_and_hits(tmp_path):
    n = []

    def prod():
        n.append(1)
        return {"v": "値"}

    assert common.cached(tmp_path, "k", prod) == {"v": "値"}
    assert common.cached(tmp_path, "k", prod) == {"v": "値"}
    assert len(n) == 1
    assert [p.suffix for p in tmp_path.iterdir()] == [".json"]  # no .tmp left behind


def test_cached_corrupt_file_is_a_miss(tmp_path):
    (tmp_path / (common.md5("k") + ".json")).write_text('{"trunc', encoding="utf-8")
    assert common.cached(tmp_path, "k", lambda: {"v": 1}) == {"v": 1}
    assert json.loads((tmp_path / (common.md5("k") + ".json")).read_text(encoding="utf-8")) == {"v": 1}
