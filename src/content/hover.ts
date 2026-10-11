import type { Settings } from '../settings'

export const HOVER_DELAY_MS = 300
const THUMB = '.bsb-thumb'

/**
 * Plays the post's video over its thumbnail after a short hover.
 * Listeners are capture-phase on `root` (mouseenter/leave do not bubble), so
 * cards added later are covered too. Only one video exists at a time.
 */
export function attachHoverPlay(root: ParentNode, settings: Settings, win: Window = window): () => void {
  if (!settings.hoverPlay) return () => {}
  if (typeof win.matchMedia === 'function' && win.matchMedia('(hover: none)').matches) return () => {}

  let timer: ReturnType<typeof setTimeout> | null = null
  let current: { thumb: HTMLElement; video: HTMLVideoElement | null } | null = null

  const stop = () => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    const v = current?.video
    if (v) {
      try {
        v.pause()
      } catch {
        // ignore
      }
      v.removeAttribute('src')
      v.remove()
    }
    current = null
  }

  const start = (thumb: HTMLElement) => {
    const src = thumb.dataset.fileUrl
    if (!src) return
    current = { thumb, video: null }
    timer = setTimeout(() => {
      timer = null
      if (!current || current.thumb !== thumb) return
      const v = thumb.ownerDocument.createElement('video')
      v.muted = true
      v.setAttribute('muted', '')
      v.loop = true
      v.setAttribute('loop', '')
      v.setAttribute('playsinline', '')
      v.setAttribute('preload', 'none')
      v.src = src
      thumb.appendChild(v)
      current.video = v
      try {
        const p = v.play()
        if (p && typeof p.catch === 'function') p.catch(() => {})
      } catch {
        // ignore
      }
    }, HOVER_DELAY_MS)
  }

  const asThumb = (t: EventTarget | null): HTMLElement | null =>
    t && (t as Element).nodeType === 1 && (t as Element).matches(THUMB) ? (t as HTMLElement) : null

  const onEnter = (e: Event) => {
    const thumb = asThumb(e.target)
    if (!thumb || current?.thumb === thumb) return
    stop()
    start(thumb)
  }
  const onLeave = (e: Event) => {
    const thumb = asThumb(e.target)
    if (thumb && current?.thumb === thumb) stop()
  }

  root.addEventListener('mouseenter', onEnter, true)
  root.addEventListener('mouseleave', onLeave, true)
  return () => {
    root.removeEventListener('mouseenter', onEnter, true)
    root.removeEventListener('mouseleave', onLeave, true)
    stop()
  }
}
