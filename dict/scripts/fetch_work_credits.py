"""Staff credits of anime works (per-episode 原画 / 作画監督 / ... name lists) from
wiki work pages, keyed by Sakugabooru copyright tag.

Sources:
  staffdb  アニメスタッフデータベース (seesaawiki.jp/w/radioi_34, EUC-JP). Titles come
           from its 五十音 index (cache/staffdb/index.json = {title: url path}).
  atwiki   作画@wiki work pages (cache/atwiki/pages-all.json = {id: title}).
A dictionary title matches a page title exactly (normalized) or with the page
title's trailing （2008年）/（第2期） dropped; several pages per tag are merged.

Output `cache/<source>/work_credits.json`:
  {copyright_tag: {"pages": [url], "titles": [str], "episodes": n,
                   "names": {name: {"eps": n, "roles": {role: n}}}}}
Stdlib only, every fetch cached, 1 s between requests.
"""
import argparse
import html as htmllib
import re
import sys
import unicodedata
import urllib.error
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import ROOT, USER_AGENT, cached, load_json, save_json  # noqa: E402
from fetch_atwiki_index import _TAG, body_of, clean  # noqa: E402
from verify_atwiki import load_dict_ja  # noqa: E402

SOURCES = {
    "staffdb": {"dir": ROOT / "cache" / "staffdb", "base": "https://seesaawiki.jp/w/radioi_34/d/",
                "encoding": "euc-jp"},
    "atwiki": {"dir": ROOT / "cache" / "atwiki" / "works", "base": "https://w.atwiki.jp/sakuga/pages/",
               "encoding": "utf-8"},
}

ROLES = ("原画", "第二原画", "作画監督", "総作画監督", "作画監督補佐", "作画監督補", "アクション作画監督",
         "メカ作画監督", "エフェクト作画監督", "動画検査", "動画", "作画", "絵コンテ", "演出", "絵コンテ・演出",
         "キャラクターデザイン", "レイアウト", "作画監督協力", "原画協力", "プロップデザイン", "美術", "撮影",
         "3DCG", "CG", "制作進行", "脚本", "シリーズ構成", "監督", "副監督", "色彩設計", "編集", "音楽", "音響監督",
         "キャラクター作画監督", "メカ作監", "ゲスト原画", "総作画監督補佐", "作画協力", "動画協力", "第二原画協力",
         "作画監督補助", "作監補佐", "作監補", "プロップ作画監督", "原画・作画監督", "動画チェック", "仕上げ", "色指定",
         "背景", "特殊効果", "色指定・仕上げ検査", "仕上げ検査", "美術監督", "撮影監督", "3DCG監督", "CG監督",
         "音響効果", "録音", "編集助手", "制作デスク", "設定制作", "助監督", "演出助手", "メインアニメーター",
         "総作画監督・作画監督", "作画監督・原画", "エフェクト作監", "アクション作監", "メカニック作画監督", "動画検査・動画")
NAME_ROLES = {"原画", "第二原画", "作画監督", "総作画監督", "作画監督補佐", "作画監督補", "アクション作画監督",
              "メカ作画監督", "エフェクト作画監督", "動画検査", "作画", "レイアウト", "作画監督協力", "原画協力",
              "キャラクター作画監督", "メカ作監", "ゲスト原画", "キャラクターデザイン", "絵コンテ", "演出",
              "絵コンテ・演出", "監督", "総作画監督補佐", "作画協力", "作画監督補助", "作監補佐", "作監補",
              "プロップ作画監督", "原画・作画監督", "動画チェック", "メインアニメーター", "総作画監督・作画監督",
              "作画監督・原画", "エフェクト作監", "アクション作監", "メカニック作画監督", "動画検査・動画"}
_EP = re.compile(r"^(?:#|第|＃)?\s*\d+\s*(?:話|「|話「|\s)|^(?:OP|ED|オープニング|エンディング|PV|CM|最終話|第\d+話)")
_ROLE_INLINE = re.compile(r"^([^：:　 ]{1,16})[：:]\s*(.*)$")
_PAREN = re.compile(r"[（(][^（）()]*[）)]")
_SPLIT = re.compile(r"[　\s、,，/／]+")
_NOTE = re.compile(r"^[■□◆●・※＊*]")
_SKIP = {"ページを更新", "登録/ログイン", "操作ガイド", "コメント", "名前", "名前:", "コメント:", "-", "―", "－"}
_NAME_OK = re.compile(r"^[ぁ-んァ-ヶー一-鿿々〆〇A-Za-zＡ-Ｚａ-ｚ0-9\.\-]{2,16}$")
_TITLE = re.compile(r"<title[^>]*>(.*?)</title", re.S | re.I)
_LINK = re.compile(r'<a\b[^>]*?\bhref="([^"]*)"[^>]*>(.*?)</a\s*>', re.S | re.I)


def norm_title(s):
    s = unicodedata.normalize("NFKC", s)
    s = re.sub(r"[\s・!?:~\-—–‐,、。「」『』【】()\[\]\"'’]", "", s)
    return s.lower()


def strip_suffix(title):
    """'名探偵コナン（2026年）' / 'AKIRA（東京ムービー新社.1988）' / '夜桜さんちの大作戦（第2期）' -> base title."""
    return re.sub(r"\s*[（(][^（）()]*[）)]$", "", title).strip()


def body_lines(html_text):
    t = clean(body_of(html_text))
    t = re.sub(r"<br\s*/?>", "\n", t, flags=re.I)
    t = re.sub(r"</(?:p|div|li|tr|h\d|td|th)\s*>", "\n", t, flags=re.I)
    t = _TAG.sub("", t)
    t = htmllib.unescape(t).replace("\xa0", " ")
    return [ln.strip() for ln in t.split("\n") if ln.strip()]


def _names(text):
    out = []
    for tok in _SPLIT.split(_PAREN.sub("", text)):
        tok = tok.strip(" 　・:：")
        if tok and tok not in _SKIP and _NAME_OK.match(tok):
            out.append(tok)
    return out


def parse_credits(html_text):
    """[{"ep": header or None, "roles": {role: [names]}}] in page order.

    A role starts with a line equal to a known role (names on the following
    lines) or `役職：名前　名前` inline (names continue on following lines).
    Any other `役職：...` line, a `■` annotation, a separator or an episode
    header ends the current name list.
    """
    blocks = [{"ep": None, "roles": defaultdict(list)}]
    role = None
    for ln in body_lines(html_text):
        if ln in _SKIP:
            role = None
            continue
        if _EP.match(ln) and len(ln) <= 60:
            blocks.append({"ep": ln, "roles": defaultdict(list)})
            role = None
            continue
        if _NOTE.match(ln):
            role = None
            continue
        if ln in ROLES:
            role = ln if ln in NAME_ROLES else "_skip"
            continue
        m = _ROLE_INLINE.match(ln)
        if m and m.group(1) in ROLES:
            role = m.group(1) if m.group(1) in NAME_ROLES else "_skip"
            if role != "_skip":
                blocks[-1]["roles"][role].extend(_names(m.group(2)))
            continue
        if m and not _NAME_OK.match(ln):
            role = None  # some other 役職：... line
            continue
        if role and role != "_skip":
            blocks[-1]["roles"][role].extend(_names(ln))
    return [{"ep": b["ep"], "roles": dict(b["roles"])} for b in blocks if b["roles"]]


def aggregate(blocks):
    """{name: {"eps": distinct blocks, "roles": {role: n}}}"""
    names = {}
    for b in blocks:
        seen = set()
        for role, ns in b["roles"].items():
            for n in ns:
                e = names.setdefault(n, {"eps": 0, "roles": Counter()})
                e["roles"][role] += 1
                if n not in seen:
                    e["eps"] += 1
                    seen.add(n)
    return {n: {"eps": e["eps"], "roles": dict(e["roles"])} for n, e in names.items()}


def merge(aggs):
    out = {}
    for ag in aggs:
        for n, e in ag.items():
            o = out.setdefault(n, {"eps": 0, "roles": Counter()})
            o["eps"] += e["eps"]
            o["roles"].update(e["roles"])
    return {n: {"eps": e["eps"], "roles": dict(e["roles"])} for n, e in out.items()}


def page_title(html_text):
    m = _TITLE.search(html_text)
    return " ".join(htmllib.unescape(m.group(1)).split()) if m else ""


def title_index(source):
    """{normalized title: [(page title, url)]}; a title maps under its full and suffix-stripped forms."""
    cfg = SOURCES[source]
    pairs = []
    if source == "staffdb":
        for title, path in (load_json(cfg["dir"] / "index.json", default={}) or {}).items():
            pairs.append((title, cfg["base"] + path))
    else:
        animators = {str(n["id"]) for n in (load_json(ROOT / "cache" / "atwiki" / "index.json", default={}) or {}).get("names", [])}
        for pid, title in (load_json(ROOT / "cache" / "atwiki" / "pages-all.json", default={}) or {}).items():
            if pid not in animators:
                pairs.append((title, cfg["base"] + f"{pid}.html"))
    idx = defaultdict(list)
    for title, url in pairs:
        for form in {title, strip_suffix(title)}:
            n = norm_title(form)
            if n and (title, url) not in idx[n]:
                idx[n].append((title, url))
    return idx


def fetch_page(url, encoding, sleep=1.0, cache_dir=None):
    """{"url", "html"} or {"missing": true}; cached by url."""
    def producer():
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return {"url": r.geturl(), "html": r.read().decode(encoding, "replace")}
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return {"missing": True}
            raise
    return cached(cache_dir, url, producer, sleep=sleep)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", choices=sorted(SOURCES), default="staffdb")
    ap.add_argument("--works", required=True, help="JSON list of copyright tags")
    ap.add_argument("--out", default=None)
    ap.add_argument("--sleep", type=float, default=1.0)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--max-pages", type=int, default=4, help="pages merged per tag (yearly pages etc.)")
    a = ap.parse_args()
    cfg = SOURCES[a.source]
    out_path = Path(a.out) if a.out else cfg["dir"] / "work_credits.json"
    tags = load_json(a.works, default=[])
    if a.limit:
        tags = tags[: a.limit]
    dict_ja = load_dict_ja()
    idx = title_index(a.source)
    out = load_json(out_path, default={}) or {}
    n_missing = 0
    for i, tag in enumerate(tags, 1):
        ja = dict_ja.get(tag)
        if not ja or tag in out:
            continue
        hits = idx.get(norm_title(ja), [])[: a.max_pages]
        if not hits:
            out[tag] = {"pages": [], "titles": [ja]}
            n_missing += 1
            continue
        aggs, pages, titles, eps = [], [], [], 0
        for title, url in hits:
            page = fetch_page(url, cfg["encoding"], sleep=a.sleep, cache_dir=cfg["dir"] / "html")
            if page.get("missing"):
                continue
            blocks = parse_credits(page["html"])
            aggs.append(aggregate(blocks))
            pages.append(page["url"])
            titles.append(title)
            eps += len(blocks)
        out[tag] = {"pages": pages, "titles": titles, "episodes": eps, "names": merge(aggs)}
        if not pages:
            n_missing += 1
        if i % 50 == 0:
            save_json(out_path, out)
            print(f"{i}/{len(tags)} {tag} missing={n_missing}", flush=True)
    save_json(out_path, out)
    found = sum(1 for v in out.values() if v.get("pages"))
    print(f"done: {found} tags with pages, {len(out) - found} without -> {out_path}")


if __name__ == "__main__":
    main()
