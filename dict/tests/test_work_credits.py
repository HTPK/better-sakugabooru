import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from fetch_work_credits import aggregate, merge, norm_title, parse_credits, strip_suffix  # noqa: E402

PAGE = """<html><head><title>ワンパンマン - アニメスタッフデータベース</title></head><body>
<div id="menu"><a href="/w/radioi_34/d/x">トップページ</a></div>
<div id="wikibody"><div class="box">
オープニングアニメーションスタッフ<br>
絵コンテ・演出：夏目真悟<br>
作画監督<br>久保田誓<br>
原画：石橋翔祐　今井有文<br>今村大樹　小笠原真<br>
動画：マッドハウス<br>甲斐順子　竹内帆波美<br>
動画検査<br>坂詰かよ<br>
■今井有文<br>歌詞のあたり（憶測）<br>
-<br>
#01「最強の男」<br>
脚本：鈴木智尋<br>
絵コンテ<br>夏目真悟<br>
総作画監督<br>久保田誓<br>
原画<br>小田剛生　亀田祥倫<br>金世俊　　久貝典史（1話-12話）<br>今村大樹<br>
第二原画<br>高橋成実<br>DRMOVIE<br>
動画検査<br>坂詰かよ<br>
音楽：宮崎誠<br>
#02「孤高のサイボーグ」<br>
原画<br>今村大樹、佐藤利幸<br>
</div></div></body></html>"""


def test_parse_credits_blocks_and_roles():
    blocks = parse_credits(PAGE)
    assert [b["ep"] for b in blocks] == ["オープニングアニメーションスタッフ", "#01「最強の男」", "#02「孤高のサイボーグ」"]
    op = blocks[0]["roles"]
    assert op["絵コンテ・演出"] == ["夏目真悟"]
    assert op["原画"] == ["石橋翔祐", "今井有文", "今村大樹", "小笠原真"]  # inline + continuation line
    assert "動画" not in op and "甲斐順子" not in sum(op.values(), [])  # 動画 staff are skipped
    assert "歌詞のあたり" not in sum(op.values(), [])  # ■ annotation lines are not names
    ep1 = blocks[1]["roles"]
    assert ep1["原画"] == ["小田剛生", "亀田祥倫", "金世俊", "久貝典史", "今村大樹"]  # parenthetical dropped
    assert ep1["第二原画"] == ["高橋成実", "DRMOVIE"]
    assert "脚本" not in ep1 and "音楽" not in ep1 and "宮崎誠" not in sum(ep1.values(), [])
    assert blocks[2]["roles"]["原画"] == ["今村大樹", "佐藤利幸"]  # 、 separator


def test_aggregate_counts_distinct_blocks():
    ag = aggregate(parse_credits(PAGE))
    assert ag["今村大樹"] == {"eps": 3, "roles": {"原画": 3}}
    assert ag["久保田誓"]["eps"] == 2
    assert ag["久保田誓"]["roles"] == {"作画監督": 1, "総作画監督": 1}
    assert ag["坂詰かよ"]["roles"] == {"動画検査": 2}


def test_merge_sums_pages():
    a = {"今村大樹": {"eps": 3, "roles": {"原画": 3}}}
    b = {"今村大樹": {"eps": 2, "roles": {"原画": 1, "作画監督": 1}}, "坂詰かよ": {"eps": 1, "roles": {"動画検査": 1}}}
    m = merge([a, b])
    assert m["今村大樹"] == {"eps": 5, "roles": {"原画": 4, "作画監督": 1}}
    assert m["坂詰かよ"]["eps"] == 1


def test_strip_suffix_and_norm_title():
    assert strip_suffix("AKIRA（東京ムービー新社.1988）") == "AKIRA"
    assert strip_suffix("名探偵コナン（2026年）") == "名探偵コナン"
    assert strip_suffix("夜桜さんちの大作戦（第2期）") == "夜桜さんちの大作戦"
    assert strip_suffix("らんま1/2（2024年版）") == "らんま1/2"
    assert strip_suffix("イノセンス") == "イノセンス"
    assert norm_title("Fate/stay night [Unlimited Blade Works]") == norm_title("Ｆａｔｅ／ｓｔａｙ　ｎｉｇｈｔ［Unlimited Blade Works］")
    assert norm_title("ぼっち・ざ・ろっく！") == norm_title("ぼっち ざ ろっく!")
