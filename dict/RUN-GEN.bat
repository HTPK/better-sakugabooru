@echo off
rem Resume dictionary generation (safe to re-run: finished tags are cached).
rem 1) copyrights (work titles) via Wikidata
rem 2) *_series titles from the works that share their posts
rem 3) artists via Wikidata
rem 4) build dist/dict.json
cd /d "%~dp0"
set PYTHONUTF8=1
echo [1/4] copyrights (Wikidata) ...
py -3 scripts\gen_copyrights.py
echo [2/4] series tags (post co-occurrence + Wikidata) ...
py -3 scripts\fetch_cooccur.py
py -3 scripts\gen_copyrights.py --series
echo [3/4] artists (Wikidata) ...
py -3 scripts\gen_artists.py
echo [4/4] build ...
py -3 scripts\build.py
echo.
echo Done. Review COVERAGE.md and REVIEW.md, then commit and push:
echo   git add data dist COVERAGE.md REVIEW.md
echo   git commit -m "data: regenerate"
echo   git push
pause
