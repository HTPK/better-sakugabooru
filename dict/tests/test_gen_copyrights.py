import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import gen_copyrights as g  # noqa: E402


def media(id_, romaji, native="日本語", english=None, synonyms=()):
    return {"id": id_, "title": {"romaji": romaji, "english": english, "native": native},
            "synonyms": list(synonyms), "format": "TV", "seasonYear": 2000}


def test_tag_to_query():
    assert g.tag_to_query("re:zero_kara_hajimeru_isekai_seikatsu") == \
        "re zero kara hajimeru isekai seikatsu"
    assert g.tag_to_query("fate/stay_night_(2006)") == "fate stay night 2006"


def test_match_exact_romaji():
    r = g.match("neon genesis evangelion", [media(1, "Neon Genesis Evangelion", "新世紀エヴァンゲリオン")])
    assert r == {"ja": "新世紀エヴァンゲリオン", "src": "an external database:1", "needs_review": False}


def test_match_english_and_synonym():
    assert g.match("fullmetal alchemist", [media(2, "Hagane no Renkinjutsushi", "鋼の錬金術師",
                                                 english="Fullmetal Alchemist")])["src"] == "an external database:2"
    assert g.match("evangelion", [media(3, "Shinseiki", "新", synonyms=["Evangelion"])])["src"] == "an external database:3"


def test_match_fuzzy_needs_review():
    r = g.match("mobile suit gundam seed", [media(4, "Mobile Suit Gundam SEED:", "機動戦士ガンダムSEED")])
    # normalised equal -> exact
    assert r["needs_review"] is False
    r = g.match("mobile suit gundam sed", [media(4, "Mobile Suit Gundam SEED", "機動戦士ガンダムSEED")])
    assert r["needs_review"] is True


def test_no_match_or_no_native():
    assert g.match("zzz", [media(5, "Something Else Entirely", "別")]) is None
    assert g.match("same", [media(6, "Same", None)]) is None


def test_run_with_fake_post_and_series_skipped():
    calls = []

    def post(payload):
        calls.append(payload)
        return {"data": {"Page": {"media": [media(7, "Cowboy Bebop", "カウボーイビバップ")]}}}

    tags = [{"name": "cowboy_bebop", "count": 40}, {"name": "foo_series", "count": 30},
            {"name": "tiny", "count": 1}]
    res = g.run(tags, {}, post, limit=None)
    assert res["cowboy_bebop"]["ja"] == "カウボーイビバップ"
    assert res["cowboy_bebop"]["count"] == 40
    assert set(res) == {"cowboy_bebop"}
    assert len(calls) == 1 and calls[0]["variables"] == {"q": "cowboy bebop"}


def test_run_skips_tag_whose_post_raises(capsys):
    def post(payload):
        if payload["variables"]["q"] == "bad":
            raise ConnectionResetError()
        return {"data": {"Page": {"media": [media(7, "Cowboy Bebop", "カウボーイビバップ")]}}}

    tags = [{"name": "bad", "count": 90}, {"name": "cowboy_bebop", "count": 40}]
    res = g.run(tags, {}, post)
    assert set(res) == {"cowboy_bebop"}
    err = capsys.readouterr().err
    assert "bad" in err and "ConnectionResetError" in err


def test_synonym_only_hit_needs_review():
    r = g.match("gundam", [media(95, "Turn A Gundam", "∀ガンダム", synonyms=["Gundam"])])
    assert r["src"] == "an external database:95" and r["needs_review"] is True


def test_romaji_exact_not_review_and_earliest_year_wins():
    later = media(10, "Gundam", "後発")
    later["seasonYear"] = 2010
    early = media(11, "Gundam", "元祖")
    early["seasonYear"] = 1979
    unknown = media(12, "Gundam", "不明")
    unknown["seasonYear"] = None
    r = g.match("gundam", [later, unknown, early])
    assert r == {"ja": "元祖", "src": "an external database:11", "needs_review": False}


def test_exact_title_beats_synonym_hit():
    syn = media(20, "Other", "別名", synonyms=["Foo"])
    syn["seasonYear"] = 1970
    exact = media(21, "Foo", "本家")
    assert g.match("foo", [syn, exact])["src"] == "an external database:21"
