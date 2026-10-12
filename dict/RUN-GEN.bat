@echo off
rem Resume dictionary generation (safe to re-run: finished tags are cached).
rem 1) copyrights via an external database (about 30 requests/min allowed)
rem 2) artists via Wikidata, then an external database staff fallback for the misses
rem 3) build dist/dict.json
cd /d "%~dp0"
set PYTHONUTF8=1
echo [1/4] copyrights (an external database) ...
py -3 scripts\gen_copyrights.py --sleep 2.1
echo [2/4] artists (Wikidata only) ...
py -3 scripts\gen_artists.py --no-staff
echo [3/4] artists misses (an external database staff) ...
py -3 scripts\gen_artists.py --retry-misses
echo [4/4] build ...
py -3 scripts\build.py
echo.
echo Done. Review COVERAGE.md and REVIEW.md, then commit and push:
echo   git add data dist COVERAGE.md REVIEW.md
echo   git commit -m "data: regenerate"
echo   git push
pause
