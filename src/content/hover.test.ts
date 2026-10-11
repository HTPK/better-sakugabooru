import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { attachHoverPlay, HOVER_DELAY_MS } from './hover'
import { DEFAULTS, type Settings } from '../settings'

const fakeWin = (hoverNone = false) =>
  ({ matchMedia: (q: string) => ({ matches: hoverNone && q === '(hover: none)' }) }) as unknown as Window

function setup() {
  document.body.innerHTML = `<ul class="bsb-grid">
    <li class="bsb-card"><a class="bsb-thumb" href="/post/show/1" data-file-url="https://x.test/1.mp4"><img class="bsb-preview"></a></li>
    <li class="bsb-card"><a class="bsb-thumb" href="/post/show/2" data-file-url="https://x.test/2.mp4"><img class="bsb-preview"></a></li>
  </ul>`
  const thumbs = Array.from(document.querySelectorAll<HTMLElement>('.bsb-thumb'))
  return { root: document.body, thumbs }
}
const enter = (el: Element) => el.dispatchEvent(new MouseEvent('mouseenter'))
const leave = (el: Element) => el.dispatchEvent(new MouseEvent('mouseleave'))
const videos = () => document.querySelectorAll('video')

describe('attachHoverPlay', () => {
  let play: ReturnType<typeof vi.fn>
  let pause: ReturnType<typeof vi.fn>
  beforeEach(() => {
    vi.useFakeTimers()
    play = vi.fn(() => Promise.resolve())
    pause = vi.fn()
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(play as never)
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(pause as never)
  })
  let detachers: Array<() => void> = []
  afterEach(() => {
    detachers.forEach((d) => d())
    detachers = []
    vi.useRealTimers()
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  const attach = (patch: Partial<Settings> = {}, hoverNone = false) => {
    const { root, thumbs } = setup()
    const detach = attachHoverPlay(root, { ...DEFAULTS, ...patch }, fakeWin(hoverNone))
    detachers.push(detach)
    return { thumbs, detach }
  }

  it('creates a muted looping video only after the delay', () => {
    const { thumbs } = attach()
    enter(thumbs[0])
    vi.advanceTimersByTime(HOVER_DELAY_MS - 1)
    expect(videos()).toHaveLength(0)
    vi.advanceTimersByTime(1)
    const v = thumbs[0].querySelector('video')!
    expect(v).not.toBeNull()
    expect(v.getAttribute('src')).toBe('https://x.test/1.mp4')
    expect(v.muted).toBe(true)
    expect(v.hasAttribute('muted')).toBe(true)
    expect(v.loop).toBe(true)
    expect(v.hasAttribute('playsinline')).toBe(true)
    expect(v.getAttribute('preload')).toBe('none')
    expect(play).toHaveBeenCalledTimes(1)
  })

  it('pauses and removes the video on leave', () => {
    const { thumbs } = attach()
    enter(thumbs[0])
    vi.advanceTimersByTime(HOVER_DELAY_MS)
    leave(thumbs[0])
    expect(videos()).toHaveLength(0)
    expect(pause).toHaveBeenCalled()
  })

  it('creates nothing when leaving before the delay', () => {
    const { thumbs } = attach()
    enter(thumbs[0])
    vi.advanceTimersByTime(HOVER_DELAY_MS - 50)
    leave(thumbs[0])
    vi.advanceTimersByTime(HOVER_DELAY_MS * 2)
    expect(videos()).toHaveLength(0)
    expect(play).not.toHaveBeenCalled()
  })

  it('keeps only one video: entering another thumb replaces the first', () => {
    const { thumbs } = attach()
    enter(thumbs[0])
    vi.advanceTimersByTime(HOVER_DELAY_MS)
    enter(thumbs[1])
    expect(thumbs[0].querySelector('video')).toBeNull()
    vi.advanceTimersByTime(HOVER_DELAY_MS)
    expect(videos()).toHaveLength(1)
    expect(thumbs[1].querySelector('video')).not.toBeNull()
  })

  it('swallows play() rejections', async () => {
    play.mockImplementation(() => Promise.reject(new Error('NotAllowed')))
    const { thumbs } = attach()
    enter(thumbs[0])
    vi.advanceTimersByTime(HOVER_DELAY_MS)
    await Promise.resolve()
    expect(videos()).toHaveLength(1)
  })

  it('attaches nothing when hoverPlay is off', () => {
    const { thumbs } = attach({ hoverPlay: false })
    enter(thumbs[0])
    vi.advanceTimersByTime(HOVER_DELAY_MS * 2)
    expect(videos()).toHaveLength(0)
  })

  it('attaches nothing on hover-less devices', () => {
    const { thumbs } = attach({}, true)
    enter(thumbs[0])
    vi.advanceTimersByTime(HOVER_DELAY_MS * 2)
    expect(videos()).toHaveLength(0)
  })

  it('detach removes listeners and any playing video', () => {
    const { thumbs, detach } = attach()
    enter(thumbs[0])
    vi.advanceTimersByTime(HOVER_DELAY_MS)
    detach()
    expect(videos()).toHaveLength(0)
    enter(thumbs[1])
    vi.advanceTimersByTime(HOVER_DELAY_MS * 2)
    expect(videos()).toHaveLength(0)
  })
})
