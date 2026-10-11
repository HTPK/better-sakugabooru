/**
 * Live-site smoke test for the built extension (dist/).
 *
 * POLITENESS: sakugabooru.com is run by volunteers. This is ONE serial test with a
 * hard budget of MAX_LOADS main-frame navigations to the site (redirects and the
 * locale reload included). Do not add retries or loops around page loads.
 *
 * Run: pnpm build && pnpm smoke
 * Profile dir: $BSB_PW_PROFILE (wiped per run) or a fresh dir under the OS temp.
 */
import { test, expect, chromium, type BrowserContext, type ConsoleMessage, type Page } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const DIST = path.join(ROOT, 'dist')
const SHOTS = path.join(ROOT, 'test/smoke/screenshots')
const SITE = 'https://www.sakugabooru.com'
const POST_ID = 318817
const MAX_LOADS = 10
const CJK = /[぀-ヿ㐀-鿿]/

function profileDir(): string {
  const fromEnv = process.env.BSB_PW_PROFILE
  if (fromEnv) {
    fs.rmSync(fromEnv, { recursive: true, force: true })
    fs.mkdirSync(fromEnv, { recursive: true })
    return fromEnv
  }
  return fs.mkdtempSync(path.join(os.tmpdir(), 'bsb-pw-'))
}

test('extension smoke on live site', async () => {
  expect(fs.existsSync(path.join(DIST, 'manifest.json')), 'run `pnpm build` first').toBe(true)
  fs.mkdirSync(SHOTS, { recursive: true })

  const context: BrowserContext = await chromium.launchPersistentContext(profileDir(), {
    channel: 'chromium',
    headless: process.env.BSB_PW_HEADED ? false : true,
    viewport: { width: 1280, height: 800 },
    colorScheme: 'light',
    locale: 'ja-JP',
    args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
  })

  const consoleLog: string[] = []
  const bsbFailures: string[] = []
  let loads = 0
  const loadLog: string[] = []
  const watch = (page: Page) => {
    page.on('console', (m: ConsoleMessage) => {
      const line = `[${m.type()}] ${page.url()} :: ${m.text()}`
      if (m.type() === 'error' || m.type() === 'warning') consoleLog.push(line)
      // boot.ts reports step failures via console.warn('[bsb]', ...); treat warn and error alike.
      if (m.text().includes('[bsb]') && (m.type() === 'error' || m.type() === 'warning')) bsbFailures.push(line)
    })
    page.on('pageerror', (e) => consoleLog.push(`[pageerror] ${page.url()} :: ${e.message}`))
    page.on('request', (r) => {
      if (r.isNavigationRequest() && r.frame() === page.mainFrame() && r.url().startsWith(SITE)) {
        loads++
        loadLog.push(r.url())
        if (loads > MAX_LOADS) throw new Error(`page-load budget exceeded: ${loadLog.join(', ')}`)
      }
    })
  }
  const shot = (page: Page, name: string) => page.screenshot({ path: path.join(SHOTS, name) })

  try {
    let [sw] = context.serviceWorkers()
    if (!sw) sw = await context.waitForEvent('serviceworker')
    const extId = new URL(sw.url()).host

    const page = context.pages()[0] ?? (await context.newPage())
    watch(page)

    // 1. Front page -> /post (frontToPosts), possibly one locale reload.
    await page.goto(`${SITE}/`)
    await page.waitForURL(/\/post(\?|$)/)
    await page.locator('html.bsb-ready').waitFor({ state: 'attached', timeout: 30_000 })
    await page.waitForLoadState('domcontentloaded')
    await page.locator('html.bsb-ready').waitFor({ state: 'attached', timeout: 30_000 })
    expect(new URL(page.url()).pathname).toBe('/post')
    console.log(`step1 url=${page.url()} loads=${loads}`)

    // 2. List page.
    await expect(page.locator('html[data-bsb-theme]')).toHaveCount(1)
    await expect(page.locator('.bsb-grid')).toBeVisible()
    const cards = await page.locator('.bsb-grid .bsb-card').count()
    console.log(`step2 cards=${cards}`)
    expect(cards).toBeGreaterThanOrEqual(24)
    const chipTexts = await page.locator('.bsb-chip').allInnerTexts()
    const nameTexts = await page.locator('.bsb-work, .bsb-artists').allInnerTexts()
    const jaChips = [...new Set(chipTexts.filter((t) => CJK.test(t)))]
    const jaNames = [...new Set(nameTexts.filter((t) => CJK.test(t)))]
    console.log(`step2 jaChips=${JSON.stringify(jaChips)}`)
    console.log(`step2 jaNames=${JSON.stringify(jaNames.slice(0, 10))} (of ${nameTexts.length} name blocks)`)
    expect(jaChips.length + jaNames.length, 'some Japanese chip/name text').toBeGreaterThan(0)
    const untranslated = await page.locator('.bsb-untranslated').count()
    console.log(`step2 untranslated=${untranslated}`)
    expect(untranslated).toBeGreaterThan(0)
    await expect(page.locator('.bsb-bar')).toBeVisible()
    await expect(page.locator('.bsb-bar .bsb-upload')).toBeVisible()
    await expect(page.locator('.bsb-lang')).toHaveCount(1)
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
    console.log(`step2 scrollWidth=${scrollWidth}`)
    expect.soft(scrollWidth, 'no horizontal overflow at 1280 (header bar)').toBeLessThanOrEqual(1280)
    await shot(page, 'list-light.png')
    const thumb = page.locator('.bsb-thumb').first()
    await thumb.hover()
    await page.waitForTimeout(600)
    await expect(thumb.locator('video')).toHaveCount(1)
    await page.mouse.move(5, 5)

    // 3. Japanese search suggest.
    // On the list page the search box lives in the title band (#bsb-q); the header form is hidden there.
    const bandInput = page.locator('#bsb-q')
    const search = (await bandInput.count()) ? bandInput : page.locator('.bsb-search-form input[name="tags"]').first()
    await search.click()
    await search.pressSequentially('かなだ', { delay: 50 })
    const suggest = page.locator('.bsb-suggest')
    await expect(suggest).toBeVisible()
    await expect(suggest.locator('.bsb-sg', { hasText: '金田伊功' }).first()).toBeVisible()
    // The site styles bare `div { color: white }`; the label must not vanish into the box background.
    const [jaColor, boxBg] = await page.evaluate(() => [
      getComputedStyle(document.querySelector('.bsb-suggest .bsb-sg-ja')!).color,
      getComputedStyle(document.querySelector('.bsb-suggest')!).backgroundColor,
    ])
    expect.soft(jaColor, 'suggest label readable').not.toBe(boxBg)
    console.log(`step3 suggest=${JSON.stringify((await suggest.locator('.bsb-sg').allInnerTexts()).slice(0, 5))}`)
    await shot(page, 'search.png')
    await search.press('Escape')
    await expect(suggest).toBeHidden()

    // 4. Show page.
    const showUrl = `${SITE}/post/show/${POST_ID}`
    await page.goto(showUrl)
    await page.locator('html.bsb-ready').waitFor({ state: 'attached', timeout: 30_000 })
    const h1 = (await page.locator('.bsb-show-band h1').innerText()).trim()
    console.log(`step4 h1=${JSON.stringify(h1)}`)
    expect(h1.length).toBeGreaterThan(0)
    await expect(page.locator('.video-js').first()).toBeVisible()
    await expect(page.locator(`#post-score-${POST_ID}`)).toHaveCount(1)
    await expect(page.locator('.bsb-stats')).toHaveCount(1)
    await shot(page, 'show-light.png')

    // 5. Popup -> dark theme.
    const popup = await context.newPage()
    await popup.setViewportSize({ width: 380, height: 640 })
    await popup.goto(`chrome-extension://${extId}/src/popup/index.html`)
    await expect(popup.locator('#pp-dict-count')).not.toBeEmpty()
    await popup.screenshot({ path: path.join(SHOTS, 'popup-light.png'), fullPage: true })
    await popup.locator('[data-seg="theme"] button[data-value="dark"]').click()
    await expect(popup.locator('html')).toHaveAttribute('data-bsb-theme', 'dark')
    await expect
      .poll(async () => popup.evaluate(async () => ((await chrome.storage.sync.get('settings')).settings as { theme?: string } | undefined)?.theme))
      .toBe('dark')
    await popup.screenshot({ path: path.join(SHOTS, 'popup-dark.png'), fullPage: true })
    await popup.close()

    await page.bringToFront()
    await page.goto(showUrl)
    await page.locator('html.bsb-ready').waitFor({ state: 'attached', timeout: 30_000 })
    await expect(page.locator('html')).toHaveAttribute('data-bsb-theme', 'dark')
    await shot(page, 'show-dark.png')
    await page.goto(`${SITE}/post`)
    await page.locator('html.bsb-ready').waitFor({ state: 'attached', timeout: 30_000 })
    await expect(page.locator('html')).toHaveAttribute('data-bsb-theme', 'dark')
    await shot(page, 'list-dark.png')
  } finally {
    console.log(`page loads: ${loads} -> ${JSON.stringify(loadLog)}`)
    console.log(`console errors/warnings (${consoleLog.length}):\n${consoleLog.join('\n')}`)
    await context.close()
  }
  expect(bsbFailures, 'no [bsb] warnings/errors').toEqual([])
})
