import { describe, it, expect, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { buildPlayer, formatBytes, formatFps, formatTime, readSetup } from './player'

interface Fake {
  paused: boolean
  currentTime: number
  duration: number
  playbackRate: number
  muted: boolean
  loop: boolean
}

/** jsdom has no media pipeline: back the media properties with plain state and fire the real events. */
function fakeMedia(video: HTMLVideoElement, init: Partial<Fake> = {}): Fake {
  const s: Fake = { paused: true, currentTime: 0, duration: NaN, playbackRate: 1, muted: false, loop: video.hasAttribute('loop'), ...init }
  const fire = (t: string) => video.dispatchEvent(new video.ownerDocument.defaultView!.Event(t))
  const prop = (k: keyof Fake, ev?: string) =>
    Object.defineProperty(video, k, {
      configurable: true,
      get: () => s[k],
      set: (v) => {
        ;(s as unknown as Record<string, unknown>)[k] = v
        if (ev) fire(ev)
      },
    })
  prop('paused')
  prop('currentTime', 'timeupdate')
  prop('duration', 'durationchange')
  prop('playbackRate', 'ratechange')
  prop('muted', 'volumechange')
  prop('loop')
  video.play = vi.fn(() => {
    s.paused = false
    fire('play')
    return Promise.resolve()
  })
  video.pause = vi.fn(() => {
    s.paused = true
    fire('pause')
  })
  return s
}

const SETUP = `{"autoplay": true, "playbackRates": [0.2, 0.4, 1], "plugins": {"framebyframe": {"fps": 23.976024, "steps": []}}}`

function setup(attrs = `loop data-setup='${SETUP}'`, visual = false) {
  // pretendToBeVisual gives the window a real requestAnimationFrame (about 60 Hz).
  const doc = new JSDOM(`<!doctype html><body><div id="screen"><video class="video-js" ${attrs}></video></div></body>`, {
    pretendToBeVisual: visual,
  }).window.document
  const video = doc.querySelector('video')!
  const screen = doc.getElementById('screen')!
  const state = fakeMedia(video)
  const conf = readSetup(video)
  const row = buildPlayer(doc, {
    video,
    screen,
    rates: conf.rates,
    fps: conf.fps,
    fpsKnown: conf.fpsKnown,
    fileUrl: 'https://x/a.mp4',
    fileSize: 13486318,
  })
  doc.body.append(row)
  return { doc, video, screen, state, row, conf }
}

describe('formatters', () => {
  it('formats times as m:ss.d', () => {
    expect(formatTime(8.31)).toBe('0:08.3')
    expect(formatTime(21.1)).toBe('0:21.1')
    expect(formatTime(75.04)).toBe('1:15.0')
    expect(formatTime(NaN)).toBe('-:--.-')
  })
  it('formats bytes the way the site does (MiB, one decimal)', () => {
    expect(formatBytes(13486318)).toBe('12.9 MB')
    expect(formatBytes(512000)).toBe('500 KB')
  })
  it('formats fps with at most two decimals', () => {
    expect(formatFps(23.976024)).toBe('23.98')
    expect(formatFps(24)).toBe('24')
  })
})

describe('readSetup', () => {
  it('reads playbackRates and framebyframe fps from data-setup', () => {
    const { conf } = setup()
    expect(conf).toEqual({ rates: [0.2, 0.4, 1], fps: 23.976024, fpsKnown: true })
  })
  it('falls back to 0.25/0.5/1 and 23.976 when data-setup is missing or broken', () => {
    const doc = new JSDOM(`<video data-setup='{oops'></video>`).window.document
    expect(readSetup(doc.querySelector('video')!)).toEqual({ rates: [0.25, 0.5, 1], fps: 23.976, fpsKnown: false })
  })
})

describe('buildPlayer', () => {
  it('toggles play/pause and swaps the label', () => {
    const { row, video, state } = setup()
    const btn = row.querySelector<HTMLButtonElement>('.bsb-play')!
    expect(btn.getAttribute('aria-label')).toBe('再生')
    btn.click()
    expect(video.play).toHaveBeenCalled()
    expect(state.paused).toBe(false)
    expect(btn.getAttribute('aria-label')).toBe('一時停止')
    btn.click()
    expect(video.pause).toHaveBeenCalled()
    expect(btn.getAttribute('aria-label')).toBe('再生')
  })

  it('Space anywhere in the row toggles play', () => {
    const { row, doc, state } = setup()
    const loop = row.querySelector<HTMLButtonElement>('.bsb-loop')!
    const ev = new doc.defaultView!.KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true })
    loop.dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(true)
    expect(state.paused).toBe(false)
    expect(loop.getAttribute('aria-pressed')).toBe('true')
  })

  it('shows current and total time and fills the progress bar', () => {
    const { row, video, state } = setup()
    state.duration = 21.1
    video.dispatchEvent(new video.ownerDocument.defaultView!.Event('loadedmetadata'))
    video.currentTime = 8.3
    expect(row.querySelector('.bsb-time-cur')!.textContent).toBe('0:08.3')
    expect(row.querySelector('.bsb-time-total')!.textContent).toBe('0:21.1')
    const fill = row.querySelector<HTMLElement>('.bsb-progress-fill')!
    expect(parseFloat(fill.style.width)).toBeCloseTo((8.3 / 21.1) * 100, 1)
  })

  it('while playing, refreshes the readout every animation frame, not only on timeupdate', async () => {
    const { row, video, state } = setup(undefined, true)
    state.duration = 10
    await video.play()
    // Advance the clock silently (no timeupdate event): the frame loop must still pick it up.
    state.currentTime = 3
    const cur = row.querySelector('.bsb-time-cur')!
    await vi.waitFor(() => expect(cur.textContent).toBe('0:03.0'))
    const fill = row.querySelector<HTMLElement>('.bsb-progress-fill')!
    await vi.waitFor(() => expect(parseFloat(fill.style.width)).toBeCloseTo(30, 1))
    // Paused: the loop stops, so a silent change is no longer reflected.
    video.pause()
    state.currentTime = 5
    await new Promise((r) => setTimeout(r, 60))
    expect(cur.textContent).toBe('0:03.0')
  })

  it('works without requestAnimationFrame (falls back to timeupdate)', async () => {
    const { row, video, state } = setup()
    expect(typeof video.ownerDocument.defaultView!.requestAnimationFrame).toBe('undefined')
    state.duration = 10
    await video.play()
    video.currentTime = 4
    expect(row.querySelector('.bsb-time-cur')!.textContent).toBe('0:04.0')
  })

  it('shows a 1-based frame counter next to the time when fps is known, and steps advance it by one', () => {
    const { row, video, state } = setup()
    const fps = 23.976024
    state.duration = 21.1
    video.dispatchEvent(new video.ownerDocument.defaultView!.Event('loadedmetadata'))
    const cur = row.querySelector('.bsb-frame-cur')!
    const total = row.querySelector('.bsb-frame-total')!
    expect(cur.textContent).toBe('1')
    expect(total.textContent).toBe(String(Math.round(21.1 * fps)))
    video.currentTime = 8.3
    expect(cur.textContent).toBe(String(Math.floor(8.3 * fps) + 1))
    const fwd = row.querySelectorAll<HTMLButtonElement>('.bsb-step')[1]
    const before = Number(cur.textContent)
    for (let i = 1; i <= 5; i++) {
      fwd.click()
      expect(cur.textContent).toBe(String(before + i))
    }
    video.currentTime = 21.1
    expect(cur.textContent).toBe(total.textContent) // never one past the end
  })

  it('reserves the total frame count width for the current frame so the seek bar does not shift', () => {
    const { row, video, state } = setup()
    state.duration = 21.1
    video.dispatchEvent(new video.ownerDocument.defaultView!.Event('loadedmetadata'))
    const cur = row.querySelector<HTMLElement>('.bsb-frame-cur')!
    expect(cur.textContent).toBe('1')
    expect(cur.style.minWidth).toBe(`${row.querySelector('.bsb-frame-total')!.textContent!.length}ch`)
  })

  it('shows no frame counter when fps is only a default', () => {
    const { row } = setup(`data-setup='{"playbackRates":[1]}'`)
    expect(row.querySelector('.bsb-frame')).toBeNull()
    expect(row.querySelector('.bsb-time')).not.toBeNull()
  })

  it('seeks when the progress bar is clicked', () => {
    const { row, video, state, doc } = setup()
    state.duration = 20
    const bar = row.querySelector<HTMLElement>('.bsb-progress')!
    bar.getBoundingClientRect = () => ({ left: 100, width: 200, top: 0, height: 4, right: 300, bottom: 4, x: 100, y: 0, toJSON: () => ({}) })
    bar.dispatchEvent(new doc.defaultView!.MouseEvent('click', { clientX: 150, bubbles: true }))
    expect(video.currentTime).toBeCloseTo(5)
  })

  it('renders one speed button per data-setup rate and sets playbackRate', () => {
    const { row, video } = setup()
    const btns = Array.from(row.querySelectorAll<HTMLButtonElement>('.bsb-speed button'))
    expect(btns.map((b) => b.textContent)).toEqual(['0.2x', '0.4x', '1x'])
    expect(btns[2].getAttribute('aria-pressed')).toBe('true')
    btns[0].click()
    expect(video.playbackRate).toBe(0.2)
    expect(btns[0].getAttribute('aria-pressed')).toBe('true')
    expect(btns[2].getAttribute('aria-pressed')).toBe('false')
  })

  it('steps one frame back and forward (pausing) using the data-setup fps', () => {
    const { row, video, state } = setup()
    state.duration = 20
    state.currentTime = 1
    state.paused = false
    const [back, fwd] = Array.from(row.querySelectorAll<HTMLButtonElement>('.bsb-step'))
    expect([back.textContent, fwd.textContent]).toEqual(['‹ 1f', '1f ›'])
    fwd.click()
    expect(video.pause).toHaveBeenCalled()
    expect(video.currentTime).toBeCloseTo(1 + 1 / 23.976024, 6)
    back.click()
    back.click()
    expect(video.currentTime).toBeCloseTo(1 - 1 / 23.976024, 6)
    state.currentTime = 0
    back.click()
    expect(video.currentTime).toBe(0)
  })

  it('loop defaults from the loop attribute and toggles', () => {
    const { row, video } = setup()
    const loop = row.querySelector<HTMLButtonElement>('.bsb-loop')!
    expect(loop.textContent).toBe('ループ')
    expect(loop.getAttribute('aria-pressed')).toBe('true')
    loop.click()
    expect(video.loop).toBe(false)
    expect(loop.getAttribute('aria-pressed')).toBe('false')
    const off = setup(`data-setup='${SETUP}'`)
    expect(off.row.querySelector('.bsb-loop')!.getAttribute('aria-pressed')).toBe('false')
  })

  it('mute toggles and relabels', () => {
    const { row, video } = setup()
    const mute = row.querySelector<HTMLButtonElement>('.bsb-mute')!
    expect(mute.textContent).toBe('ミュート')
    mute.click()
    expect(video.muted).toBe(true)
    expect(mute.textContent).toBe('ミュート解除')
    mute.click()
    expect(video.muted).toBe(false)
  })

  it('offers the mp4 with its size and a fullscreen button on the screen', () => {
    const { row, screen } = setup()
    const a = row.querySelector<HTMLAnchorElement>('a.bsb-save')!
    expect(a.getAttribute('href')).toBe('https://x/a.mp4')
    expect(a.textContent).toBe('mp4 を保存 12.9 MB')
    screen.requestFullscreen = vi.fn(() => Promise.resolve())
    row.querySelector<HTMLButtonElement>('.bsb-fullscreen')!.click()
    expect(screen.requestFullscreen).toHaveBeenCalled()
  })

  it('omits the save link without a file url', () => {
    const doc = new JSDOM(`<div id="s"><video></video></div>`).window.document
    const video = doc.querySelector('video')!
    fakeMedia(video)
    const row = buildPlayer(doc, { video, screen: doc.getElementById('s')!, rates: [1], fps: 24 })
    expect(row.querySelector('a.bsb-save')).toBeNull()
  })

  it('omits the save link when the file url is not http(s)', () => {
    const doc = new JSDOM(`<div id="s"><video></video></div>`).window.document
    const video = doc.querySelector('video')!
    fakeMedia(video)
    const row = buildPlayer(doc, { video, screen: doc.getElementById('s')!, rates: [1], fps: 24, fileUrl: 'javascript:alert(1)' })
    expect(row.querySelector('a.bsb-save')).toBeNull()
  })
})
