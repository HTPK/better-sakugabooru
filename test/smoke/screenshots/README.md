# Smoke-test screenshots

`pnpm build && pnpm smoke` writes captures here (gitignored). Page shots are 1280×800,
the size Chrome Web Store expects for listing screenshots; popup shots are 380 px wide.

| File | Content |
| --- | --- |
| `list-light.png` / `list-dark.png` | `/post` list page |
| `search.png` | Japanese suggest for `かなだ` |
| `show-light.png` / `show-dark.png` | `/post/show/318817` |
| `popup-light.png` / `popup-dark.png` | settings popup |

The test hits the live site (volunteer-run): keep it to one run at a time and do not add retries.
