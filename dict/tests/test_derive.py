import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import build  # noqa: E402

SETTLED = {
    "jujutsu_kaisen": "呪術廻戦",
    "shingeki_no_kyojin": "進撃の巨人",
    "hunter_x_hunter": "HUNTER×HUNTER",
    "hibike!_euphonium": "響け!ユーフォニアム",
    "black_clover": "ブラッククローバー",
    "you're_under_arrest": "逮捕しちゃうぞ",
    "kono_subarashii_sekai_ni_shukufuku_wo!": "この素晴らしい世界に祝福を！",
    "foo_series": "フー シリーズ",
}


def derive(tag, count=10, settled=None, existing=None):
    counts = {tag: count}
    r = build.derive_variants(settled or SETTLED, counts, existing or set())
    return r.get(tag)


def ja(tag, **kw):
    r = derive(tag, **kw)
    return r["ja"] if r else None


def test_examples():
    assert ja("jujutsu_kaisen_season_2") == "呪術廻戦 第2期"
    assert ja("shingeki_no_kyojin_the_final_season") == "進撃の巨人 The Final Season"
    assert ja("shingeki_no_kyojin_final_season") == "進撃の巨人 The Final Season"
    assert ja("hunter_x_hunter_2011") == "HUNTER×HUNTER (2011)"
    assert ja("hibike!_euphonium_3") == "響け!ユーフォニアム 3"
    assert ja("black_clover_2nd_season") == "ブラッククローバー 第2期"
    assert ja("black_clover_3rd_season") == "ブラッククローバー 第3期"
    assert ja("you're_under_arrest_ova") == "逮捕しちゃうぞ (OVA)"
    assert ja("you're_under_arrest_ona") == "逮捕しちゃうぞ (ONA)"
    assert ja("you're_under_arrest_special") == "逮捕しちゃうぞ (スペシャル)"
    assert ja("you're_under_arrest_specials") == "逮捕しちゃうぞ (スペシャル)"
    assert ja("you're_under_arrest_recap") == "逮捕しちゃうぞ (総集編)"
    for suf in ("movie", "the_movie", "film"):
        assert (ja(f"kono_subarashii_sekai_ni_shukufuku_wo!_{suf}")
                == "劇場版 この素晴らしい世界に祝福を！")


def test_entry_shape():
    r = derive("black_clover_2nd_season")
    assert r == {"ja": "ブラッククローバー 第2期", "src": "derived:black_clover",
                 "needs_review": False}


def test_count_threshold():
    assert derive("black_clover_ova", count=4) is None
    assert derive("black_clover_ova", count=5) is not None
    assert build.derive_variants(SETTLED, {}, set()) == {}


def test_series_base_not_used():
    assert derive("foo_series_season_2") is None
    assert derive("foo_series_movie") is None


def test_unsettled_base_not_used():
    assert derive("unknown_show_season_2") is None


def test_existing_not_overwritten():
    assert derive("black_clover_ova", existing={"black_clover_ova"}) is None


def test_number_range_and_precedence():
    assert derive("black_clover_1") is None
    assert derive("black_clover_10") is None
    assert ja("black_clover_9") == "ブラッククローバー 9"
    assert ja("black_clover_season_10") == "ブラッククローバー 第10期"
    assert derive("black_clover_1800") is None  # not a year


def test_build_integration(tmp_path):
    d = tmp_path / "data"
    d.mkdir()
    cop = {"black_clover": {"ja": "ブラッククローバー", "src": "wikidata:Q1",
                            "count": 50, "needs_review": False},
           "black_clover_ova": {"ja": "仮", "src": "x", "count": 9, "needs_review": True},
           "black_clover_movie": {"ja": "手動", "src": "x", "count": 9, "needs_review": True}}
    for n, o in [("artists", {}), ("copyrights", cop), ("general", {}),
                 ("overrides", {"black_clover_movie": {"ja": "手動映画", "src": "manual"}})]:
        (d / f"{n}.json").write_text(json.dumps(o), encoding="utf-8")
    (tmp_path / "cache").mkdir()
    tags = {"copyright": [{"name": "black_clover", "count": 50},
                          {"name": "black_clover_season_2", "count": 7},
                          {"name": "black_clover_special", "count": 3},
                          {"name": "black_clover_ova", "count": 9},
                          {"name": "black_clover_movie", "count": 9}]}
    (tmp_path / "cache" / "tags.json").write_text(json.dumps(tags), encoding="utf-8")
    dist = build.build(tmp_path)
    c = dist["copyrights"]
    assert c["black_clover_season_2"] == {"ja": "ブラッククローバー 第2期"}
    assert c["black_clover_ova"] == {"ja": "ブラッククローバー (OVA)"}
    assert c["black_clover_movie"]["ja"] == "手動映画"
    assert "black_clover_special" not in c
    assert dist["counts"]["black_clover_season_2"] == 7
    review = (tmp_path / "REVIEW.md").read_text(encoding="utf-8")
    assert "black_clover_ova" not in review
    cov = (tmp_path / "COVERAGE.md").read_text(encoding="utf-8")
    assert "copyrights | 4 / 4" in cov
