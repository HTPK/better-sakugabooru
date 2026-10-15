import { h } from './render'

/** Fallbacks used only when the page's data-setup does not say (never shown as page data). */
const DEFAULT_RATES = [0.25, 0.5, 1]
const DEFAULT_FPS = 23.976
const SVG_NS = 'http://www.w3.org/2000/svg'
const ICON_PLAY = 'M7 4l13 8-13 8z'
const ICON_PAUSE = 'M6 4h4v16H6zM14 4h4v16h-4z'

export interface PlayerSetup {
  rates: number[]
  fps: number
  /** True when fps came from the page's framebyframe config (only then may it be displayed). */
  fpsKnown: boolean
}

export interface PlayerOptions {
  video: HTMLVideoElement
  /** Element put into fullscreen (the video container). */
  screen: HTMLElement
  rates: number[]
  fps: number
  /** Show a frame counter next to the time (only when fps is the page's real value, not a default). */
  fpsKnown?: boolean
  fileUrl?: string
  fileSize?: number
}

/** 1-based frame number at `sec` (frame 1 starts at 0 s). A tiny epsilon absorbs t + n/fps rounding. */
export function frameAt(sec: number, fps: number): number {
  if (!Number.isFinite(sec) || sec < 0 || !(fps > 0)) return 1
  return Math.floor(sec * fps + FRAME_EPSILON) + 1
}

/** Total frames of a clip, or null when the duration is unknown. */
export function frameCount(duration: number, fps: number): number | null {
  if (!Number.isFinite(duration) || duration <= 0 || !(fps > 0)) return null
  return Math.max(1, Math.round(duration * fps))
}

const pad = (n: number, w: number) => String(n).padStart(w, '0')
const FRAME_EPSILON = 1e-4
const FRAME_UNKNOWN = '-'

/** `m:ss.d`; unknown values render as placeholders, never as a made-up number. */
export function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '-:--.-'
  const tenths = Math.round(sec * 10)
  const m = Math.floor(tenths / 600)
  const s = Math.floor((tenths % 600) / 10)
  return `${m}:${pad(s, 2)}.${tenths % 10}`
}

/** Binary units with one decimal, matching the site's own "Video (12.9 MB MP4)" label. */
export function formatBytes(bytes: number): string {
  const mb = bytes / 1024 / 1024
  if (mb >= 1) return `${mb.toFixed(1)} MB`
  return `${Math.round(bytes / 1024)} KB`
}

export function formatFps(fps: number): string {
  return String(Math.round(fps * 100) / 100)
}

const positive = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x > 0

/** Reads `playbackRates` and `plugins.framebyframe.fps` from the element's video.js data-setup JSON. */
export function readSetup(el: Element | null): PlayerSetup {
  let conf: unknown = null
  try {
    conf = JSON.parse(el?.getAttribute('data-setup') ?? 'null')
  } catch {
    conf = null
  }
  const c = (conf && typeof conf === 'object' ? conf : {}) as {
    playbackRates?: unknown
    plugins?: { framebyframe?: { fps?: unknown } }
  }
  const rates = Array.isArray(c.playbackRates) ? c.playbackRates.filter(positive) : []
  const fps = c.plugins?.framebyframe?.fps
  return {
    rates: rates.length ? rates : DEFAULT_RATES,
    fps: positive(fps) ? fps : DEFAULT_FPS,
    fpsKnown: positive(fps),
  }
}

function icon(doc: Document, d: string): SVGSVGElement {
  const svg = doc.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('width', '14')
  svg.setAttribute('height', '14')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('fill', 'currentColor')
  const p = doc.createElementNS(SVG_NS, 'path')
  p.setAttribute('d', d)
  svg.append(p)
  return svg
}

const button = (doc: Document, cls: string, text: string | null, attrs: Record<string, string> = {}) =>
  h(doc, 'button', { type: 'button', class: cls, ...attrs }, text)

/**
 * Our control row under the site's video. It drives the HTMLVideoElement directly; video.js keeps
 * owning the element (its own control bar is hidden by CSS).
 */
export function buildPlayer(doc: Document, o: PlayerOptions): HTMLElement {
  const v = o.video
  const play = button(doc, 'bsb-play bsb-round', null, { 'aria-label': '再生' })
  const cur = h(doc, 'b', { class: 'bsb-time-cur' }, formatTime(0))
  const total = h(doc, 'span', { class: 'bsb-time-total' }, formatTime(NaN))
  const time = h(doc, 'span', { class: 'bsb-time' }, cur, ' / ', total)
  const frameCur = h(doc, 'b', { class: 'bsb-frame-cur' }, '1')
  const frameTotal = h(doc, 'span', { class: 'bsb-frame-total' }, FRAME_UNKNOWN)
  const frame = o.fpsKnown
    ? h(doc, 'span', { class: 'bsb-frame', title: `コマ番号 (${formatFps(o.fps)} fps)` }, frameCur, ' / ', frameTotal, ' f')
    : null
  const fill = h(doc, 'div', { class: 'bsb-progress-fill' })
  const bar = h(doc, 'div', { class: 'bsb-progress', role: 'slider', 'aria-label': '再生位置', 'aria-valuemin': '0', tabindex: '0' }, fill)
  const speeds = o.rates.map((r) => button(doc, '', `${r}x`, { 'data-rate': String(r) }))
  const speed = h(doc, 'span', { class: 'bsb-speed', role: 'group', 'aria-label': '再生速度' }, ...speeds)
  const back = button(doc, 'bsb-step', '‹ 1f', { 'aria-label': '1 フレーム戻る' })
  const fwd = button(doc, 'bsb-step', '1f ›', { 'aria-label': '1 フレーム進む' })
  const loop = button(doc, 'bsb-loop', 'ループ')
  const mute = button(doc, 'bsb-mute', 'ミュート')
  // file_url comes from the page; only an http(s) URL becomes a link.
  const save = o.fileUrl && /^https?:\/\//i.test(o.fileUrl)
    ? h(
        doc,
        'a',
        { class: 'bsb-save', href: o.fileUrl, download: '' },
        'mp4 を保存',
        positive(o.fileSize) && ' ',
        positive(o.fileSize) && h(doc, 'span', { class: 'bsb-en' }, formatBytes(o.fileSize)),
      )
    : null
  const full = button(doc, 'bsb-fullscreen', '全画面')

  const syncPlay = () => {
    play.replaceChildren(icon(doc, v.paused ? ICON_PLAY : ICON_PAUSE))
    play.setAttribute('aria-label', v.paused ? '再生' : '一時停止')
  }
  const syncTime = () => {
    const d = v.duration
    cur.textContent = formatTime(v.currentTime)
    total.textContent = formatTime(d)
    if (frame) {
      const n = frameCount(d, o.fps)
      frameCur.textContent = String(n === null ? frameAt(v.currentTime, o.fps) : Math.min(n, frameAt(v.currentTime, o.fps)))
      frameTotal.textContent = n === null ? FRAME_UNKNOWN : String(n)
      // Digits are tabular (Jost tnum = 1ch each); reserving the total's width keeps 1 → 199 from shifting the bar.
      frameCur.style.minWidth = `${frameTotal.textContent.length}ch`
    }
    const pct = Number.isFinite(d) && d > 0 ? Math.min(100, (v.currentTime / d) * 100) : 0
    fill.style.width = `${pct}%`
    bar.setAttribute('aria-valuenow', String(Math.round(pct)))
    bar.setAttribute('aria-valuemax', '100')
  }
  const syncRate = () => {
    for (const b of speeds) b.setAttribute('aria-pressed', String(Number(b.dataset.rate) === v.playbackRate))
  }
  const syncLoop = () => loop.setAttribute('aria-pressed', String(v.loop))
  const syncMute = () => {
    mute.textContent = v.muted ? 'ミュート解除' : 'ミュート'
  }

  const toggle = () => {
    if (v.paused) {
      const p = v.play()
      if (p && typeof p.catch === 'function') p.catch(() => undefined)
    } else v.pause()
    syncPlay()
  }
  const step = (dir: 1 | -1) => {
    v.pause()
    const d = v.duration
    let t = v.currentTime + dir / o.fps
    if (t < 0) t = 0
    if (Number.isFinite(d) && t > d) t = d
    v.currentTime = t
  }

  play.addEventListener('click', toggle)
  bar.addEventListener('click', (e) => {
    const r = bar.getBoundingClientRect()
    const d = v.duration
    if (!(r.width > 0) || !Number.isFinite(d)) return
    v.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * d
  })
  for (const b of speeds) {
    b.addEventListener('click', () => {
      v.playbackRate = Number(b.dataset.rate)
      syncRate()
    })
  }
  back.addEventListener('click', () => step(-1))
  fwd.addEventListener('click', () => step(1))
  loop.addEventListener('click', () => {
    v.loop = !v.loop
    syncLoop()
  })
  mute.addEventListener('click', () => {
    v.muted = !v.muted
    syncMute()
  })
  full.addEventListener('click', () => {
    const p = o.screen.requestFullscreen?.()
    if (p && typeof p.catch === 'function') p.catch(() => undefined)
  })

  // `timeupdate` fires only about four times a second, which makes a tenths readout and the bar
  // advance in uneven jumps. While playing, refresh on every animation frame instead.
  const win = doc.defaultView
  let rafId = 0
  const tick = () => {
    syncTime()
    rafId = win?.requestAnimationFrame ? win.requestAnimationFrame(tick) : 0
  }
  const startTicking = () => {
    if (!rafId && win && typeof win.requestAnimationFrame === 'function') rafId = win.requestAnimationFrame(tick)
  }
  const stopTicking = () => {
    if (rafId && win) win.cancelAnimationFrame(rafId)
    rafId = 0
    syncTime()
  }

  for (const ev of ['play', 'pause', 'playing', 'ended']) v.addEventListener(ev, syncPlay)
  for (const ev of ['play', 'playing']) v.addEventListener(ev, startTicking)
  for (const ev of ['pause', 'ended', 'emptied']) v.addEventListener(ev, stopTicking)
  for (const ev of ['timeupdate', 'loadedmetadata', 'durationchange', 'seeked']) v.addEventListener(ev, syncTime)
  if (!v.paused) startTicking()
  v.addEventListener('ratechange', syncRate)
  v.addEventListener('volumechange', syncMute)

  const row = h(doc, 'div', { class: 'bsb-player-row' }, play, time, frame, bar, speed, back, fwd, loop, mute, save, full)
  row.addEventListener('keydown', (e) => {
    if (e.key !== ' ' || e.ctrlKey || e.metaKey || e.altKey) return
    e.preventDefault()
    toggle()
  })
  syncPlay()
  syncTime()
  syncRate()
  syncLoop()
  syncMute()
  return row
}
