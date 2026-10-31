import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import gen_artists_kana as g  # noqa: E402


@pytest.mark.parametrize("hira,expected", [
    ("たなか ひろのり", "tanaka hironori"),
    ("すしお", "sushio"),
    ("いとう こうじ", "itou kouji"),
    ("きたむら しゅうへい", "kitamura shuuhei"),
    ("まっち", "matchi"),  # っ + ch -> tch (norm_romaji also maps cch -> tch)
    ("とおる", "tooru"),
    ("じゃっく", "jakku"),
    ("あーろん・ぶれいず", "aron bureizu"),  # ー dropped, ・ -> space
    ("ふぁいと", "faito"),
    ("しんいち", "shinichi"),
])
def test_kana_to_romaji(hira, expected):
    assert g.kana_to_romaji(hira) == expected


def test_norm_romaji_equivalences():
    a = g.norm_romaji("koji_ito")
    assert a == g.norm_romaji("kouji itou") == g.norm_romaji("kohji itoh") == "kojiito"
    assert g.norm_romaji("shinichi") == g.norm_romaji("sinichi")
    assert g.norm_romaji("shimbun") == "shinbun"
    assert g.norm_romaji("Ōtsuka") == g.norm_romaji("ohtsuka") == g.norm_romaji("otsuka")
    assert g.norm_romaji("yohei") == "yohei"  # oh before a vowel is kept
    assert g.norm_romaji("tyuu") == g.norm_romaji("chu")
    assert g.norm_romaji("cchi") == g.norm_romaji("tchi")


def test_parse_reading_infobox():
    wt = "{{Infobox 人物\n| 名前 = 田中 宏紀\n| ふりがな = たなか ひろのり\n| 生年 = 1970\n}}"
    assert g.parse_reading(wt) == "たなか ひろのり"
    assert g.parse_reading("| ふりがな = タナカ　ヒロノリ\n") == "たなか ひろのり"
    assert g.parse_reading("| ふりがな = [[田中]]\n") is None


def test_parse_reading_lead():
    wt = "{{Infobox}}\n'''田中 宏紀'''（たなか ひろのり、[[1970年]] - ）は、日本のアニメーター。"
    assert g.parse_reading(wt) == "たなか ひろのり"
    assert g.parse_reading("'''すしお'''（1980年 - ）は日本の人物。") is None
    assert g.parse_reading("") is None


def mk(ja, kana, occs, title=None):
    return {"ja": ja, "kana": kana, "title": title, "occs": set(occs)}


def setup(items):
    return items, g.build_index(items)


def test_decide_unique_strong_accepted():
    items, idx = setup({"Q1": mk("田中宏紀 (アニメーター)", "たなか ひろのり", ["Q266569"])})
    r = g.decide("hironori_tanaka", idx, items)
    assert r == {"ja": "田中宏紀", "kana": "たなか ひろのり", "src": "wikidata:Q1",
                 "needs_review": False}
    assert g.decide("tanaka_hironori", idx, items)["ja"] == "田中宏紀"


def test_decide_two_candidates_review():
    items, idx = setup({
        "Q1": mk("田中宏紀", "たなか ひろのり", ["Q266569"]),
        "Q2": mk("田中博紀", "たなか ひろのり", ["Q1114448"], title="田中博紀"),
    })
    r = g.decide("hironori_tanaka", idx, items)
    assert r["needs_review"] is True
    assert r["src"] == "wikidata:Q2"  # strong tie -> the one with a jawiki article


def test_decide_weak_only_review():
    items, idx = setup({"Q3": mk("山田太郎", "やまだ たろう", ["Q715301"])})
    r = g.decide("taro_yamada", idx, items)
    assert r["needs_review"] is True and r["ja"] == "山田太郎"


def test_decide_no_match_and_bad_tags():
    items, idx = setup({"Q1": mk("田中宏紀", "たなか ひろのり", ["Q266569"])})
    assert g.decide("someone_else", idx, items) is None
    assert g.decide("artist_unknown", idx, items) is None
    assert g.decide("a_b_c_d", idx, items) is None


def test_decide_qualifier_and_mononym():
    items, idx = setup({"Q1": mk("すしお", "すしお", ["Q266569"]),
                        "Q2": mk("伊藤浩二", "いとう こうじ", ["Q1686939"])})
    assert g.decide("foo_bar_(animator)", idx, items) is None
    assert g.decide("koji_ito_(animator)", idx, items)["ja"] == "伊藤浩二"
    assert g.decide("kouji_itou", idx, items)["ja"] == "伊藤浩二"
    assert g.decide("sushio", idx, items)["ja"] == "すしお"


def test_run_keeps_existing_and_overrides():
    items, idx = setup({"Q1": mk("田中宏紀", "たなか ひろのり", ["Q266569"]),
                        "Q2": mk("伊藤浩二", "いとう こうじ", ["Q266569"])})
    tags = [{"name": "hironori_tanaka", "count": 50}, {"name": "koji_ito", "count": 40},
            {"name": "ito_koji", "count": 30}, {"name": "small_x", "count": 2}]
    data = {"hironori_tanaka": {"ja": "手動", "src": "manual", "needs_review": False},
            "ito_koji": {"ja": None, "needs_review": True, "src": "wikidata:none"}}
    new, acc, rev, unm, ex = g.run(tags, data, items, idx, overrides={"koji_ito": {}})
    assert new["hironori_tanaka"]["ja"] == "手動"
    assert "koji_ito" not in new
    assert new["ito_koji"]["ja"] == "伊藤浩二" and new["ito_koji"]["count"] == 30
    assert (len(acc), len(rev), unm, ex) == (1, 0, 0, 1)
    assert data["ito_koji"]["ja"] is None  # input not mutated


def test_aggregate_rows_and_jawiki_fetch():
    def b(p, occ, kana=None, title=None):
        d = {"p": {"value": f"http://www.wikidata.org/entity/{p}"}, "jaLabel": {"value": "名"},
             "occ": {"value": f"http://www.wikidata.org/entity/{occ}"}}
        if kana:
            d["kana"] = {"value": kana}
        if title:
            d["title"] = {"value": title}
        return d
    items = g.aggregate_rows([b("Q1", "Q266569"), b("Q1", "Q715301", "タナカ ヒロ", "名"),
                              b("Q2", "Q715301", "kanji")])
    assert items["Q1"]["occs"] == {"Q266569", "Q715301"}
    assert items["Q1"]["kana"] == "たなか ひろ" and items["Q1"]["title"] == "名"
    assert items["Q2"]["kana"] is None

    def fake(key, url):
        return {"query": {"normalized": [{"from": "A_b", "to": "A b"}], "pages": [
            {"title": "A b", "revisions": [{"slots": {"main": {
                "content": "'''A b'''（えー びー、1970年）"}}}]},
            {"title": "Z", "missing": True}]}}
    assert g.fetch_jawiki_readings(["A_b", "Z"], fake) == {"A_b": "えー びー"}
