@echo off
rem Resume dictionary generation (safe to re-run: finished tags are cached).
rem 1) artists via Wikidata
rem 2) build dist/dict.json
cd /d "%~dp0"
set PYTHONUTF8=1
echo [1/2] artists (Wikidata) ...
py -3 scripts\gen_artists.py
echo [2/2] build ...
py -3 scripts\build.py
echo.
echo Done. Review COVERAGE.md and REVIEW.md, then commit and push:
echo   git add data dist COVERAGE.md REVIEW.md
echo   git commit -m "data: regenerate"
echo   git push
pause
