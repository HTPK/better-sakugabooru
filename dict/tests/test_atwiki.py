import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import fetch_atwiki_index as fa  # noqa: E402
import verify_atwiki as va  # noqa: E402

NAV = '<a href="//www18.atwiki.jp/sakuga/pages/72.html">★更新履歴</a>'
INDEX = (NAV + '<a href="//w.atwiki.jp/sakuga/pages/2128.html">す～そ</a>'
         '<div id="wikibody">'
         '<a href="//www18.atwiki.jp/sakuga/pages/1017.html">あ行</a>'
         '<a href="//www18.atwiki.jp/sakuga/pages/1025.html">わ行</a>'
         '<a href="//www18.atwiki.jp/sakuga/pages/1025.html">他</a>'
         '<a href="/sakuga/pages/167.html">ページを更新</a></div>')
ROW = (NAV + '<script>var a = "<a href=\'//www18.atwiki.jp/sakuga/pages/5.html\'>x</a>";</script>'
       '<div id="wikibody">'
       '<a href="//www18.atwiki.jp/sakuga/pages/1411.html">愛敬由紀子</a>'
       '<a href="//w.atwiki.jp/sakuga/pages/2052.html"><font size="3">青木&amp;健一郎</font></a>'
       '<a href="//www18.atwiki.jp/sakuga/pages/1411.html">愛敬由紀子</a>'
       '<a href="//www18.atwiki.jp/sakuga/pages/72.html">★更新履歴</a>'
       '<a href="//www18.atwiki.jp/sakuga/pages/9.html"></a>'
       '<a href="/sakuga/pages/1017.html">ページを更新</a></div>')


def test_parse_index_rows_only_from_body():
    assert fa.parse_index(INDEX) == {"あ行": 1017, "わ行": 1025, "他": 1025}


def test_parse_row_dedupes_and_drops_nav_script_junk():
    assert fa.parse_row(ROW, exclude={72}) == [(1411, "愛敬由紀子"), (2052, "青木&健一郎")]


def test_build_with_fake_fetch_groups_shared_page():
    pages = {167: INDEX, 1017: ROW, 1025: '<div id="wikibody"><a href="//www18.atwiki.jp/sakuga/pages/7.html">和田</a>'}
    out, counts = fa.build(lambda pid: pages[pid])
    assert [n["id"] for n in out["names"]] == [1411, 2052, 7]
    assert out["names"][2]["row"] == "わ行" and counts == {"あ行": 2, "わ行": 1}
    out1, _ = fa.build(lambda pid: pages[pid], limit_rows=1)
    assert len(out1["names"]) == 2


def test_fetch_html_uses_cache(tmp_path):
    (tmp_path / "5.html").write_text("cached", encoding="utf-8")
    assert fa.fetch_html(5, tmp_path, sleep=0, opener=lambda *a, **k: 1 / 0) == "cached"


PAGE = ('<html><head><title>田中宏紀 - 作画@wiki - atwiki</title><script>x="MHA"</script></head><body>'
        '<a href="//www18.atwiki.jp/sakuga/pages/1.html">トップ</a><div id="wikibody">'
        '<p>僕のヒーローアカデミア&nbsp;と my Hero  Academia, Naruto</p></div></body></html>')


def test_page_title_and_text():
    assert va.page_title(PAGE) == "田中宏紀 - 作画@wiki - atwiki"
    t = va.page_text(PAGE)
    assert "僕のヒーローアカデミア と my Hero Academia" in t and "トップ" not in t and "MHA" not in t


def test_works_of_posts_counts_once_and_needs_ja():
    posts = [{"tags": "a w1 w1 w2"}, {"tags": "w1 w3"}, {"tags": ""}]
    assert va.works_of_posts(posts, {"w1": "一", "w2": "二", "w3": None}) == {"w1": 2, "w2": 1}
    assert va.works_of_posts({"bad": 1}, {"w1": "一"}) == {}


def test_judge():
    assert va.judge(2, 9, True) == "accept"
    assert va.judge(1, 3, True) == "accept"
    assert va.judge(1, 4, True) == "review"
    assert va.judge(0, 0, True) == "review"
    assert va.judge(5, 5, False) == "reject"


def test_verify_row_accept_review_reject_and_error():
    d = {"boku_no_hero_academia": "僕のヒーローアカデミア", "naruto": "ナルト", "xx": "別作品"}
    posts = [{"tags": "boku_no_hero_academia naruto xx"}, {"tags": "boku_no_hero_academia"}]
    row = {"tag": "hironori_tanaka", "ja": "田中宏紀", "atwiki_id": 1}
    ok = va.verify_row(row, lambda i: PAGE, lambda t: posts, d)
    assert ok["verdict"] == "accept" and ok["matched"] == 2 and ok["total"] == 3
    # one match among four works -> review
    d["yy"] = "もう一つ"
    posts2 = posts + [{"tags": "yy"}]
    page1 = PAGE.replace(", Naruto", "")
    r = va.verify_row(row, lambda i: page1, lambda t: posts2, d)
    assert r["verdict"] == "review" and r["matched"] == 1 and r["total"] == 4
    bad = va.verify_row(dict(row, ja="田中宏"), lambda i: PAGE.replace("田中宏紀", "山田"), lambda t: posts, d)
    assert bad["verdict"] == "reject" and "title mismatch" in bad["evidence"]
    err = va.verify_row(row, lambda i: PAGE, lambda t: 1 / 0, d)
    assert err["verdict"] == "review"
    assert va.verify_row({"tag": "x"}, None, None, d)["verdict"] == "review"


def test_match_works_english_needs_word_boundary():
    hits, top5 = va.match_works({"my_hero_academia": 3, "one": 1}, {}, "see My Hero Academia and someone")
    assert [h[0] for h in hits] == ["my_hero_academia"] and top5 == 1
