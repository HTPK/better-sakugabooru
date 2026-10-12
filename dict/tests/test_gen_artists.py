import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import gen_artists as g  # noqa: E402


@pytest.mark.parametrize("tag,expected", [
    ("shuu_sugita", ["Shuu Sugita", "Shu Sugita", "Sugita Shuu", "Shū Sugita"]),
    ("yoshinori_kanada", ["Yoshinori Kanada", "Kanada Yoshinori"]),
    ("ohtsuka_x", ["Ohtsuka X", "X Ohtsuka", "Ōtsuka X", "Otsuka X"]),
    ("shigeru_ohno_(animator)", ["Shigeru Ohno", "Ohno Shigeru", "Shigeru Ōno", "Shigeru Ono"]),
    ("artist_unknown", []),
    ("madoka2_x", []),
    ("sakuga", []),
    ("yoh_yoshinari", ["Yoh Yoshinari", "Yoshinari Yoh", "Yō Yoshinari", "Yo Yoshinari"]),
    ("tatsuo_ootsuka", ["Tatsuo Ootsuka", "Tatsuo Otsuka", "Ootsuka Tatsuo", "Tatsuo Ōtsuka"]),
])
def test_tag_to_queries(tag, expected):
    assert g.tag_to_queries(tag) == expected


def ent(ja="日本", p106=("Q266569",), desc="Japanese animator", kana_claim=None, aliases=None,
        en=None, en_aliases=None):
    claims = {"P106": [{"mainsnak": {"datavalue": {"value": {"id": q}}}} for q in p106]}
    if kana_claim:
        claims["P1814"] = [{"mainsnak": {"datavalue": {"value": kana_claim}}}]
    e = {"claims": claims, "descriptions": {"en": {"value": desc}}, "labels": {}, "aliases": {}}
    if ja:
        e["labels"]["ja"] = {"value": ja}
    if en:
        e["labels"]["en"] = {"value": en}
    if aliases:
        e["aliases"]["ja"] = [{"value": a} for a in aliases]
    if en_aliases:
        e["aliases"]["en"] = [{"value": a} for a in en_aliases]
    return e


def test_decide_one():
    r = g.decide({"Q1": ent("杉田秀", kana_claim="すぎた しゅう", en="Shuu Sugita"),
                  "Q2": ent(None), "Q3": ent("x", p106=("Q82955",))},
                 names=["Shuu Sugita"])
    assert r == {"ja": "杉田秀", "kana": "すぎた しゅう", "src": "wikidata:Q1",
                 "needs_review": False}


def test_same_name_film_director_needs_review():
    r = g.decide({"Q1": ent("杉田秀", p106=("Q2526255",), desc="Japanese film director",
                            en="Shuu Sugita")}, names=["Shuu Sugita"])
    assert r["src"] == "wikidata:Q1" and r["needs_review"] is True


def test_animator_with_matching_name_in_either_order_or_alias():
    r = g.decide({"Q1": ent("杉田秀", en="Sugita Shuu")}, names=["Shuu Sugita"])
    assert r["needs_review"] is False
    r = g.decide({"Q1": ent("杉田秀", en="S. Sugita", en_aliases=["Shū Sugita"])},
                 names=["Shu Sugita"])
    assert r["needs_review"] is False


def test_animator_with_non_matching_name_needs_review():
    r = g.decide({"Q1": ent("別人", en="Taro Yamada")}, names=["Shuu Sugita"])
    assert r["src"] == "wikidata:Q1" and r["needs_review"] is True


def test_anim_description_counts_as_animator():
    r = g.decide({"Q1": ent("杉田秀", p106=(), desc="Japanese animation director",
                            en="Shuu Sugita")}, names=["Shuu Sugita"])
    assert r["needs_review"] is False


def test_two_name_matching_hits_need_review():
    r = g.decide({"Q1": ent("A", en="Shuu Sugita"), "Q2": ent("B", en="Shuu Sugita")},
                 names=["Shuu Sugita"])
    assert r["needs_review"] is True


def test_kana_katakana_normalised_to_hiragana():
    r = g.decide({"Q1": ent("杉田秀", kana_claim="スギタ　シュウ")})
    assert r["kana"] == "すぎた しゅう"
    r = g.decide({"Q1": ent("杉田秀", aliases=["スギタ  シュウ "])})
    assert r["kana"] == "すぎた しゅう"


def test_decide_two_prefers_animator_desc():
    r = g.decide({"Q1": ent("A", desc="Japanese writer", p106=("Q3455803",)),
                  "Q2": ent("B", desc="Japanese animator")}, order=["Q1", "Q2"])
    assert r["src"] == "wikidata:Q2"
    assert r["needs_review"] is True


def test_decide_none():
    # no ja label / producer-only without an /anim/ description -> not a candidate
    assert g.decide({"Q1": ent(None),
                     "Q2": ent("x", p106=("Q3282637",), desc="Japanese film producer")}) is None


def test_kana_from_alias():
    r = g.decide({"Q1": ent("大塚", aliases=["Otsuka", "おおつか"])})
    assert r["kana"] == "おおつか"


def test_run_stops_at_first_query_with_hit_and_skips_existing():
    urls = []

    def fake(url):
        urls.append(url)
        if "wbsearchentities" in url:
            if "search=Shuu+Sugita" in url:
                return {"search": []}
            return {"search": [{"id": "Q1"}]}
        return {"entities": {"Q1": ent("杉田秀")}}

    tags = [{"name": "shuu_sugita", "count": 50}, {"name": "old_one", "count": 40},
            {"name": "tiny_tag", "count": 2}]
    data = {"old_one": {"ja": "古", "src": "manual"}}
    res = g.run(tags, data, fake, limit=None)
    assert res["shuu_sugita"]["src"] == "wikidata:Q1"
    assert res["shuu_sugita"]["count"] == 50
    assert res["old_one"] == {"ja": "古", "src": "manual"}
    assert "tiny_tag" not in res
    assert sum("wbsearchentities" in u for u in urls) == 2  # 2nd query hit; 3rd not tried


def test_run_skips_tag_whose_lookup_raises(capsys):
    def fake(url):
        if "Bad" in url:
            raise TimeoutError("down")
        if "wbsearchentities" in url:
            return {"search": [{"id": "Q1"}]}
        return {"entities": {"Q1": ent("杉田秀")}}

    tags = [{"name": "bad_tag", "count": 90}, {"name": "shuu_sugita", "count": 50}]
    res = g.run(tags, {}, fake)
    assert "bad_tag" not in res
    assert res["shuu_sugita"]["src"] == "wikidata:Q1"
    err = capsys.readouterr().err
    assert "bad_tag" in err and "TimeoutError" in err


def test_run_records_checked_no_match():
    def fake(url):
        return {"search": []}

    res = g.run([{"name": "no_body", "count": 9}], {}, fake)
    assert res["no_body"] == {"ja": None, "needs_review": True, "src": "wikidata:none"}
    calls = []
    g.run([{"name": "no_body", "count": 9}], res, lambda u: calls.append(u) or {"search": []})
    assert calls == []  # rerun skips it


def test_lookup_raises_on_api_error():
    with pytest.raises(RuntimeError):
        g.lookup("A B", lambda u: {"error": {"code": "maxlag"}})


def test_queries_capped_at_8():
    assert len(g.tag_to_queries("youji_ohuu_ouuu")) <= 8


def test_lookup_uses_limit_50_type_item_and_ranks_anim_first():
    urls = []
    hits = [{"id": f"Q{i}", "description": "researcher"} for i in range(1, 13)]
    hits[-1]["description"] = "Japanese animator"

    def fake(url):
        urls.append(url)
        if "wbsearchentities" in url:
            return {"search": hits}
        return {"entities": {f"Q{i}": ent("x", p106=(), desc="researcher") for i in range(1, 12)}
                | {"Q12": ent("中村豊", en="Yutaka Nakamura")}}

    r = g.lookup("Yutaka Nakamura", fake)
    assert "limit=50" in urls[0] and "type=item" in urls[0]
    assert r["src"] == "wikidata:Q12"
    ids = urls[1].split("ids=")[1].split("&")[0].split("%7C")
    assert ids[0] == "Q12" and len(ids) == 12


def test_lookup_batches_entity_fetch_by_50():
    hits = [{"id": f"Q{i}"} for i in range(1, 61)]
    calls = []

    def fake(url):
        if "wbsearchentities" in url:
            return {"search": hits}
        calls.append(url)
        return {"entities": {}}

    g.lookup("A B", fake)
    assert len(calls) == 2


def test_run_only_filter_forces():
    calls = []

    def fake(url):
        calls.append(url)
        return {"search": []}

    data = {"a_b": {"ja": "古", "src": "manual"}, "c_d": {"ja": "古", "src": "manual"}}
    res = g.run([{"name": "a_b", "count": 9}, {"name": "c_d", "count": 9}], data, fake,
                force=True, only={"a_b"})
    assert res["a_b"]["src"] == "wikidata:none" and res["c_d"]["src"] == "manual"


@pytest.mark.parametrize("raw,expected", [
    ("中村豊 (アニメーター)", "中村豊"),
    ("中村豊（アニメーター）", "中村豊"),
    ("中村豊(アニメーター)", "中村豊"),
    ("中村豊", "中村豊"),
])
def test_strip_suffix(raw, expected):
    assert g.strip_label_suffix(raw) == expected


def test_decide_strips_label_suffix():
    r = g.decide({"Q1": ent("中村豊 (アニメーター)", en="Yutaka Nakamura")},
                 names=["Yutaka Nakamura"])
    assert r["ja"] == "中村豊"


def staff(i, full, native, alt=()):
    return {"id": i, "name": {"full": full, "native": native, "alternative": list(alt)},
            "primaryOccupations": []}


def fake_post(staffs):
    return lambda payload: {"data": {"Page": {"staff": staffs}}}


def test_staff_single_match():
    r = g.staff_lookup(["Hironori Tanaka", "Tanaka Hironori"],
                       fake_post([staff(1, "Tanaka Hironori", "田中宏紀"),
                                  staff(2, "Other Person", "他人")]))
    assert r == {"ja": "田中宏紀", "src": "an external database-staff:1", "needs_review": False}


def test_staff_two_matches_need_review():
    r = g.staff_lookup(["Satoshi Sakai"],
                       fake_post([staff(5, "Satoshi Sakai", "酒井智史"),
                                  staff(6, "Sakai Satoshi", "酒井聡")]))
    assert r["ja"] == "酒井智史" and r["src"] == "an external database-staff:5"
    assert r["needs_review"] is True


def test_staff_no_cjk_native_rejected():
    assert g.staff_lookup(["Satoshi Sakai"],
                          fake_post([staff(5, "Satoshi Sakai", "Satoshi Sakai"),
                                     staff(6, "Satoshi Sakai", None)])) is None


def test_run_uses_staff_fallback_and_none_src():
    def wd(url):
        return {"search": []}

    tags = [{"name": "nozomu_abe", "count": 20}, {"name": "no_body", "count": 9}]

    def post(payload):
        if "Nozomu" in payload["variables"]["q"]:
            return {"data": {"Page": {"staff": [staff(7, "Nozomu Abe", "阿部望")]}}}
        return {"data": {"Page": {"staff": []}}}

    res = g.run(tags, {}, wd, post=post)
    assert res["nozomu_abe"] == {"ja": "阿部望", "src": "an external database-staff:7",
                                 "needs_review": False, "count": 20}
    assert res["no_body"] == {"ja": None, "needs_review": True, "src": "none"}
