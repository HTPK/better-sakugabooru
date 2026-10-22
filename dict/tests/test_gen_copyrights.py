import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import gen_copyrights as g  # noqa: E402

ANIME_TV = "Q63952888"
MANGA = "Q21198342"
FRANCHISE = "Q196600"
HUMAN = "Q5"
CHAPTER = "Q1980247"  # chapter (not a work class we accept)


def ent(ja="進撃の巨人", en="Attack on Titan", en_aliases=(), p31=(ANIME_TV,), years=(),
        japan=True):
    claims = {"P31": [{"mainsnak": {"datavalue": {"value": {"id": q}}}} for q in p31]}
    if years:
        claims["P577"] = [{"mainsnak": {"datavalue": {"value": {"time": f"+{y}-04-07T00:00:00Z"}}}}
                          for y in years]
    if japan:
        claims["P495"] = [{"mainsnak": {"datavalue": {"value": {"id": "Q17"}}}}]
    e = {"claims": claims, "labels": {}, "aliases": {}, "descriptions": {}}
    if ja:
        e["labels"]["ja"] = {"value": ja}
    if en:
        e["labels"]["en"] = {"value": en}
    if en_aliases:
        e["aliases"]["en"] = [{"value": a} for a in en_aliases]
    return e


def test_romaji_alias_match():
    r = g.decide({"Q1": ent(en_aliases=["Shingeki no Kyojin"])}, names=["shingeki no kyojin"])
    assert r == {"ja": "進撃の巨人", "src": "wikidata:Q1", "needs_review": False}


def test_name_mismatch_is_rejected():
    assert g.decide({"Q1": ent()}, names=["shingeki no kyojin"]) is None


@pytest.mark.parametrize("a,b", [
    ("yu-gi-oh!", "Yu-Gi-Oh!"), ("fate/grand order", "Fate/Grand Order"),
    ("pokemon", "Pokémon"), ("sousou no frieren", "Sōsō no Frieren"),
    ("boruto: naruto next generations", "Boruto: Naruto Next Generations"),
])
def test_normalisation(a, b):
    assert g._name_ok([b], g._keys([a]))


def test_parse_tag_year_and_qualifier():
    assert g.parse_tag("doraemon_(2005)") == ("doraemon", 2005, False)
    assert g.parse_tag("mob_(film)") == ("mob", None, True)
    assert g.parse_tag("ranma_1/2") == ("ranma 1/2", None, False)


def test_year_qualifier_prefers_matching_year():
    ents = {"Q1": ent("ドラえもん (1979年のテレビアニメ)", en="Doraemon", years=[1979]),
            "Q2": ent("ドラえもん (2005年のテレビアニメ)", en="Doraemon", years=[2005])}
    r = g.decide(ents, order=["Q1", "Q2"], names=["doraemon"], year=2005)
    assert r == {"ja": "ドラえもん (2005)", "src": "wikidata:Q2", "needs_review": False}


def test_year_qualifier_without_match_needs_review():
    r = g.decide({"Q1": ent("ドラえもん", en="Doraemon", years=[1979])},
                 names=["doraemon"], year=2005)
    assert r["src"] == "wikidata:Q1" and r["needs_review"] is True


def test_other_qualifier_needs_review():
    r = g.decide({"Q1": ent()}, names=["attack on titan"], other=True)
    assert r["needs_review"] is True


def test_series_skipped_when_base_tag_exists():
    assert g.tag_plan("fate_series", {"fate", "fate_series"}) is None
    p = g.tag_plan("fate_series", {"fate_series"})
    assert p["series"] and p["queries"][0] == "fate" and "fate series" in p["names"]


def test_series_prefers_franchise_and_requires_it():
    ents = {"Q1": ent("Fate/stay night", en="Fate", p31=(ANIME_TV,)),
            "Q2": ent("Fateシリーズ", en="Fate", p31=(FRANCHISE,))}
    r = g.decide(ents, order=["Q1", "Q2"], names=["fate", "fate series"], series=True)
    assert r["src"] == "wikidata:Q2" and r["needs_review"] is True  # labels differ
    r = g.decide({"Q1": ents["Q1"]}, names=["fate"], series=True)
    assert r["needs_review"] is True  # not a franchise


def test_single_word_title_needs_japan_origin():
    r = g.decide({"Q1": ent("アバター", en="Avatar", p31=(FRANCHISE,), japan=False)},
                 names=["avatar"])
    assert r["needs_review"] is True
    r = g.decide({"Q1": ent("銀魂", en="Gintama")}, names=["gintama"])
    assert r["needs_review"] is False


def test_conflicting_ja_labels_need_review():
    ents = {"Q1": ent("ONE PIECE", en="One Piece", p31=(MANGA,)),
            "Q2": ent("ワンピース", en="One Piece", p31=(ANIME_TV,))}
    r = g.decide(ents, order=["Q1", "Q2"], names=["one piece"])
    assert r["src"] == "wikidata:Q2"  # anime preferred over manga
    assert r["needs_review"] is True


def test_same_ja_label_after_strip_is_fine():
    ents = {"Q1": ent("ポケットモンスター", en="Pokémon", p31=(FRANCHISE,)),
            "Q2": ent("ポケットモンスター (アニメ)", en="Pokémon", p31=(ANIME_TV,))}
    r = g.decide(ents, order=["Q1", "Q2"], names=["pokemon"])
    assert r == {"ja": "ポケットモンスター", "src": "wikidata:Q2", "needs_review": False}


def test_p31_filter_rejects_non_works():
    ents = {"Q1": ent("ある人", en="Mob", p31=(HUMAN,)),
            "Q2": ent("第1話", en="Mob", p31=(CHAPTER,))}
    assert g.decide(ents, names=["mob"]) is None


@pytest.mark.parametrize("raw,expected", [
    ("ポケットモンスター (アニメ)", "ポケットモンスター"),
    ("ドラえもん（1979年のテレビアニメ）", "ドラえもん"),
    ("呪術廻戦 (第2期)", "呪術廻戦 (第2期)"),
    ("らんま1/2", "らんま1/2"),
])
def test_strip_suffix(raw, expected):
    assert g.strip_label_suffix(raw) == expected


def test_bad_ja_labels_rejected():
    assert g.decide({"Q1": ent("進撃‮の巨人", en_aliases=["Shingeki no Kyojin"])},
                    names=["shingeki no kyojin"]) is None
    assert g.decide({"Q1": ent("長" * 81, en_aliases=["Shingeki no Kyojin"])},
                    names=["shingeki no kyojin"]) is None


def test_lookup_prefilters_hits_and_raises_on_error():
    urls = []

    def fake(url):
        urls.append(url)
        if "wbsearchentities" in url:
            return {"search": [{"id": "Q1", "label": "Attack on Titan",
                                "match": {"text": "Shingeki no Kyojin"}},
                               {"id": "Q2", "label": "Something else"}]}
        return {"entities": {"Q1": ent(en_aliases=["Shingeki no Kyojin"])}}

    r = g.lookup("shingeki no kyojin", fake)
    assert r["src"] == "wikidata:Q1"
    assert "ids=Q1&" in urls[1]
    with pytest.raises(RuntimeError):
        g.lookup("x", lambda u: {"error": {"code": "maxlag"}})


def test_run_records_miss_skips_series_and_small():
    calls = []

    def fake(url):
        calls.append(url)
        return {"search": []}

    tags = [{"name": "no_such_show", "count": 9}, {"name": "foo", "count": 50},
            {"name": "foo_series", "count": 40}, {"name": "tiny", "count": 2}]
    data = {"foo": {"ja": "フー", "src": "manual"}}
    res = g.run(tags, data, fake)
    assert res["no_such_show"] == {"ja": None, "needs_review": True, "src": "wikidata:none"}
    assert "foo_series" not in res and "tiny" not in res
    assert res["foo"] == {"ja": "フー", "src": "manual"}
    calls.clear()
    g.run(tags, res, fake)
    assert calls == []  # rerun skips recorded miss


def test_run_sets_count_and_survives_errors(capsys):
    def fake(url):
        if "Bad" in url or "bad" in url:
            raise TimeoutError("down")
        if "wbsearchentities" in url:
            return {"search": [{"id": "Q1", "label": "Gintama"}]}
        return {"entities": {"Q1": ent("銀魂", en="Gintama")}}

    res = g.run([{"name": "bad_show", "count": 90}, {"name": "gintama", "count": 50}], {}, fake)
    assert "bad_show" not in res
    assert res["gintama"] == {"ja": "銀魂", "src": "wikidata:Q1", "needs_review": False,
                              "count": 50}
    assert "TimeoutError" in capsys.readouterr().err


def _series_ent(ja, en):
    return ent(ja, en=en, p31=(FRANCHISE,))


def _work(ja, en, series_ids):
    e = ent(ja, en=en)
    e["claims"]["P179"] = [{"mainsnak": {"datavalue": {"value": {"id": s}}}} for s in series_ids]
    return e


def _fetch_entities(ents):
    return lambda ids: {q: ents[q] for q in ids if q in ents}


def test_series_from_cooccur_named_winner_auto_accept():
    data = {"genso_suikoden": {"ja": "幻想水滸伝", "src": "wikidata:Q1", "needs_review": False},
            "suikoden_3": {"ja": "幻想水滸伝III", "src": "wikidata:Q2", "needs_review": False},
            "unsettled": {"ja": "x", "src": "wikidata:Q3", "needs_review": True}}
    ents = {"Q1": _work("幻想水滸伝", "Suikoden", ["Q9"]), "Q2": _work("幻想水滸伝III", "Suikoden III", ["Q9"]),
            "Q3": _work("x", "x", ["Q8"]), "Q9": _series_ent("幻想水滸伝シリーズ", "Suikoden")}
    r = g.series_from_cooccur("suikoden_series", {"genso_suikoden": 5, "suikoden_3": 2, "unsettled": 9},
                              data, None, fetch_entities=_fetch_entities(ents))
    assert r == {"ja": "幻想水滸伝シリーズ", "src": "wikidata:Q9", "needs_review": False,
                 "via": ["genso_suikoden", "suikoden_3"]}


def test_series_from_cooccur_parent_franchise_needs_review():
    # every Gundam Build work is part of the Gundam franchise, but the tag is not
    data = {"a": {"ja": "A", "src": "wikidata:Q1", "needs_review": False},
            "b": {"ja": "B", "src": "wikidata:Q2", "needs_review": False}}
    ents = {"Q1": _work("A", "A", ["Q8"]), "Q2": _work("B", "B", ["Q8"]),
            "Q8": _series_ent("ガンダムシリーズ", "Gundam")}
    r = g.series_from_cooccur("gundam_build_series", {"a": 1, "b": 1}, data, None,
                              fetch_entities=_fetch_entities(ents))
    assert r["src"] == "wikidata:Q8" and r["needs_review"] is True


def test_series_from_cooccur_single_work_needs_review_and_adds_suffix():
    data = {"eva": {"ja": "新世紀エヴァンゲリオン", "src": "wikidata:Q1", "needs_review": False}}
    ents = {"Q1": _work("新世紀エヴァンゲリオン", "Neon Genesis Evangelion", ["Q9"]),
            "Q9": _series_ent("エヴァンゲリオン", "Evangelion")}
    r = g.series_from_cooccur("x_series", {"eva": 3}, data, None, fetch_entities=_fetch_entities(ents))
    assert r["ja"] == "エヴァンゲリオン シリーズ" and r["needs_review"] is True


def test_series_from_cooccur_title_prefix_fallback():
    data = {"yyh": {"ja": "幽☆遊☆白書", "src": "wikidata:Q1", "needs_review": False},
            "yyh_movie": {"ja": "幽☆遊☆白書 冥界死闘篇 炎の絆", "src": "wikidata:Q2", "needs_review": False}}
    ents = {"Q1": _work("幽☆遊☆白書", "Yu Yu Hakusho", []), "Q2": _work("幽☆遊☆白書 冥界死闘篇 炎の絆", "Yu Yu Hakusho the Movie", [])}
    r = g.series_from_cooccur("yu_yu_hakusho_series", {"yyh_movie": 9, "yyh": 5}, data, None,
                              fetch_entities=_fetch_entities(ents))
    assert r == {"ja": "幽☆遊☆白書 シリーズ", "src": "wikidata:Q1", "needs_review": True, "via": ["yyh"]}
    data2 = {"a": {"ja": "ブレイブ", "src": "wikidata:Q1", "needs_review": False},
             "b": {"ja": "ゾロ", "src": "wikidata:Q2", "needs_review": False}}
    assert g.series_from_cooccur("x_series", {"a": 1, "b": 1}, data2, None,
                                 fetch_entities=_fetch_entities({"Q1": _work("ブレイブ", "a", []), "Q2": _work("ゾロ", "b", [])})) is None


def test_series_from_cooccur_name_match_beats_votes():
    data = {"a": {"ja": "A", "src": "wikidata:Q1", "needs_review": False},
            "b": {"ja": "B", "src": "wikidata:Q2", "needs_review": False},
            "c": {"ja": "C", "src": "wikidata:Q3", "needs_review": False}}
    ents = {"Q1": _work("A", "A", ["Q8", "Q9"]), "Q2": _work("B", "B", ["Q8", "Q9"]),
            "Q3": _work("C", "C", ["Q8"]),
            "Q8": _series_ent("ガンダムシリーズ", "Gundam"),
            "Q9": _series_ent("ガンダムビルドシリーズ", "Gundam Build series")}
    r = g.series_from_cooccur("gundam_build_series", {"a": 1, "b": 1, "c": 1}, data, None,
                              fetch_entities=_fetch_entities(ents))
    assert r["src"] == "wikidata:Q9" and r["needs_review"] is False


def test_series_from_cooccur_nothing_to_derive():
    data = {"a": {"ja": "A", "src": "manual"}, "b": {"ja": "B", "src": "wikidata:Q2", "needs_review": False}}
    ents = {"Q2": _work("B", "B", [])}
    assert g.series_from_cooccur("x_series", {"a": 3}, data, None, fetch_entities=_fetch_entities(ents)) is None
    assert g.series_from_cooccur("x_series", {"b": 3}, data, None, fetch_entities=_fetch_entities(ents)) is None  # 1-char title
    assert g.series_from_cooccur("x_series", {}, data, None) is None


def test_run_uses_cooccur_before_name_lookup():
    def fake(url):
        if "wbsearchentities" in url:
            raise AssertionError("name lookup must not run when cooccur settles the tag")
        return {"entities": {"Q1": _work("A", "A", ["Q9"]), "Q2": _work("B", "B", ["Q9"]),
                             "Q9": _series_ent("Xシリーズ", "X")}}

    tags = [{"name": "x_series", "count": 40}, {"name": "a", "count": 9}, {"name": "b", "count": 9}]
    data = {"a": {"ja": "A", "src": "wikidata:Q1", "needs_review": False},
            "b": {"ja": "B", "src": "wikidata:Q2", "needs_review": False}}
    res = g.run(tags, data, fake, cooccur={"x_series": {"a": 4, "b": 2}})
    assert res["x_series"]["src"] == "wikidata:Q9" and res["x_series"]["count"] == 40
