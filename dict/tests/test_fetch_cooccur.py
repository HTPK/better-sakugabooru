import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import fetch_cooccur as fc  # noqa: E402


def test_cooccurring_counts_copyright_tags_once_per_post():
    posts = [{"tags": "suikoden_series genso_suikoden genso_suikoden some_artist"},
             {"tags": "suikoden_series suikoden_3"}, {"tags": "suikoden_series genso_suikoden"}]
    names = {"suikoden_series", "genso_suikoden", "suikoden_3"}
    assert fc.cooccurring(posts, "suikoden_series", names) == {"genso_suikoden": 2, "suikoden_3": 1}


def test_targets_only_untranslated_series_tags():
    tags = [{"name": "a_series", "count": 9}, {"name": "b_series", "count": 9},
            {"name": "c_series", "count": 2}, {"name": "d", "count": 50}]
    assert fc.targets(tags, {"a_series"}) == ["b_series"]
    assert fc.targets(tags, {"a_series"}, all_tags=True) == ["a_series", "b_series"]


def test_run_survives_errors_and_bad_bodies(capsys):
    def fake(url):
        if "bad" in url:
            raise TimeoutError("down")
        if "odd" in url:
            return {"error": "x"}
        return [{"tags": "ok_series w1"}]

    out = fc.run(["bad_series", "odd_series", "ok_series"], {"w1", "ok_series"}, fake)
    assert out == {"odd_series": {}, "ok_series": {"w1": 1}}
    assert "TimeoutError" in capsys.readouterr().err


def test_post_url_quotes_the_tag():
    assert fc.post_url("wagamama☆fairy_series") == (
        "https://www.sakugabooru.com/post.json?tags=wagamama%E2%98%86fairy_series&limit=100")
