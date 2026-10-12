import json
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import build  # noqa: E402


def mk(tmp_path, artists=None, copyrights=None, general=None, overrides=None, tags=None):
    d = tmp_path / "data"
    d.mkdir()
    for name, obj in [("artists", artists), ("copyrights", copyrights),
                      ("general", general), ("overrides", overrides)]:
        (d / f"{name}.json").write_text(json.dumps(obj or {}), encoding="utf-8")
    if tags is not None:
        (tmp_path / "cache").mkdir()
        (tmp_path / "cache" / "tags.json").write_text(json.dumps(tags), encoding="utf-8")
    return tmp_path


def out(tmp_path):
    return json.loads((tmp_path / "dist" / "dict.json").read_text(encoding="utf-8"))


def test_override_wins(tmp_path):
    mk(tmp_path,
       artists={"a_b": {"ja": "古い", "src": "wikidata:Q1", "count": 9, "needs_review": False}},
       overrides={"a_b": {"ja": "新しい", "src": "manual"}})
    build.build(tmp_path)
    d = out(tmp_path)
    assert d["artists"]["a_b"]["ja"] == "新しい"


def test_override_unknown_type_defaults_general_or_type_field(tmp_path):
    mk(tmp_path, overrides={"x": {"ja": "エックス"},
                            "y": {"ja": "ワイ", "type": "copyrights"}})
    build.build(tmp_path)
    d = out(tmp_path)
    assert d["general"]["x"]["ja"] == "エックス"
    assert d["copyrights"]["y"]["ja"] == "ワイ"


def test_needs_review_excluded_but_override_kept(tmp_path):
    mk(tmp_path,
       artists={"p": {"ja": "ぴ", "count": 10, "needs_review": True},
                "q": {"ja": "く", "count": 10, "needs_review": False}},
       overrides={"r": {"ja": "あ", "needs_review": True, "type": "artists"}})
    build.build(tmp_path)
    d = out(tmp_path)
    assert "p" not in d["artists"]
    assert "q" in d["artists"]
    assert "r" in d["artists"]
    assert (tmp_path / "REVIEW.md").read_text(encoding="utf-8").count("| p |") == 1


def test_override_type_from_tags_cache(tmp_path):
    mk(tmp_path, overrides={"x_y": {"ja": "某"}, "show": {"ja": "番組"},
                            "z": {"ja": "ゼット"}, "w": {"ja": "ダブ", "type": "general"}},
       tags={"artist": [{"name": "x_y", "count": 9}, {"name": "w", "count": 9}],
             "copyright": [{"name": "show", "count": 9}]})
    build.build(tmp_path)
    d = out(tmp_path)
    assert "x_y" in d["artists"]
    assert "show" in d["copyrights"]
    assert "z" in d["general"]
    assert "w" in d["general"]  # explicit type field wins over the cache


def test_counts_collision_keeps_larger(tmp_path):
    mk(tmp_path, artists={"dup": {"ja": "人", "count": 7}},
       general={"dup": {"ja": "一般", "count": 300}},
       tags={"artist": [{"name": "dup", "count": 7}],
             "general": [{"name": "dup", "count": 300}]})
    build.build(tmp_path)
    assert out(tmp_path)["counts"]["dup"] == 300
    mk2 = tmp_path / "b"
    mk2.mkdir()
    mk(mk2, artists={"dup": {"ja": "人", "count": 900}},
       general={"dup": {"ja": "一般", "count": 3}})
    build.build(mk2)
    assert out(mk2)["counts"]["dup"] == 900


def test_review_skips_overridden_tags(tmp_path):
    mk(tmp_path, artists={"p": {"ja": "ぴ", "count": 10, "needs_review": True},
                          "q": {"ja": "く", "count": 10, "needs_review": True}},
       overrides={"p": {"ja": "ピー"}})
    build.build(tmp_path)
    txt = (tmp_path / "REVIEW.md").read_text(encoding="utf-8")
    assert "| p |" not in txt
    assert "| q |" in txt


def test_no_match_entries_ignored(tmp_path):
    mk(tmp_path, artists={"n": {"ja": None, "needs_review": True, "src": "wikidata:none"}})
    build.build(tmp_path)
    assert "n" not in out(tmp_path)["artists"]
    assert "| n |" not in (tmp_path / "REVIEW.md").read_text(encoding="utf-8")


def test_series_fallback(tmp_path):
    mk(tmp_path, copyrights={
        "foo": {"ja": "フー", "kana": "ふー", "count": 50},
        "bar": {"ja": "バー", "count": 20},
        "bar_series": {"ja": "バー明示", "count": 7},
    }, tags={"copyright": [{"name": "foo_series", "count": 8}]})
    build.build(tmp_path)
    c = out(tmp_path)["copyrights"]
    assert c["foo_series"] == {"ja": "フー シリーズ"}
    assert c["bar_series"]["ja"] == "バー明示"


def test_series_fallback_not_when_base_missing(tmp_path):
    mk(tmp_path, copyrights={"zzz_series": {"ja": "x", "count": 5}})
    build.build(tmp_path)
    assert "zzz_series" in out(tmp_path)["copyrights"]
    mk_dir = tmp_path


def test_counts_only_for_translated(tmp_path):
    mk(tmp_path,
       artists={"a": {"ja": "あ", "count": 12}},
       tags={"artist": [{"name": "a", "count": 12}, {"name": "b", "count": 99}]})
    build.build(tmp_path)
    d = out(tmp_path)
    assert d["counts"] == {"a": 12}


def test_updated_is_today_and_sorted(tmp_path):
    mk(tmp_path, artists={"b": {"ja": "び", "count": 5}, "a": {"ja": "あ", "count": 5}})
    build.build(tmp_path)
    d = out(tmp_path)
    assert d["updated"] == date.today().isoformat()
    assert d["v"] == 1
    assert list(d["artists"]) == ["a", "b"]


def test_coverage(tmp_path):
    mk(tmp_path, artists={"a": {"ja": "あ", "count": 30}},
       tags={"artist": [{"name": "a", "count": 30}, {"name": "b", "count": 10},
                        {"name": "c", "count": 2}]})
    build.build(tmp_path)
    txt = (tmp_path / "COVERAGE.md").read_text(encoding="utf-8")
    assert "1 / 2" in txt  # unique, count>=5 only
    assert "30 / 40" in txt
