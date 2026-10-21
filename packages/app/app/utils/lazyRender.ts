import { nextTick } from 'vue'

/*
 * Shared scheduling for SharedLazyRender: cards near the screen are drawn a
 * few per frame, cards a few screens ahead while the app is idle.
 */

// One pair of observers per scroll container, shared by every LazyRender in it
type Observers = { near: IntersectionObserver, ahead: IntersectionObserver }
const observers = new Map<Element | null, Observers>()
const callbacks = new WeakMap<Element, () => void>()
const idleQueue = new Set<Element>()
let idleScheduled = false

function reveal(el: Element) {
  const cb = callbacks.get(el)
  unwatch(el)
  cb?.()
}

// Cards near the screen are drawn a few per frame (about 8 ms of work each
// frame), so opening a page or scrolling never freezes on a whole screenful
const frameQueue = new Set<Element>()
let frameScheduled = false

function scheduleFrame() {
  if (frameScheduled) return
  frameScheduled = true
  requestAnimationFrame(async () => {
    frameScheduled = false
    const start = performance.now()
    for (const el of frameQueue) {
      frameQueue.delete(el)
      reveal(el)
      await nextTick()
      if (performance.now() - start > 8) break
    }
    if (frameQueue.size) scheduleFrame()
  })
}

function drainIdle(deadline?: IdleDeadline) {
  idleScheduled = false
  for (const el of idleQueue) {
    if (deadline && deadline.timeRemaining() < 4) break
    if (frameQueue.has(el)) continue
    reveal(el)
    if (!deadline) break
  }
  if (idleQueue.size) scheduleIdle()
}

function scheduleIdle() {
  if (idleScheduled) return
  idleScheduled = true
  if ('requestIdleCallback' in window) window.requestIdleCallback(drainIdle, { timeout: 2000 })
  else setTimeout(() => drainIdle(), 50)
}

function observersFor(scroller: Element | null): Observers {
  let o = observers.get(scroller)
  if (!o) {
    // Near the screen: draw now. A few screens ahead: draw when the app is idle.
    const near = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) frameQueue.add(e.target)
      if (frameQueue.size) scheduleFrame()
    }, { root: scroller, rootMargin: '300px 0px' })
    const ahead = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) idleQueue.add(e.target)
        else idleQueue.delete(e.target)
      }
      if (idleQueue.size) scheduleIdle()
    }, { root: scroller, rootMargin: '2500px 0px' })
    o = { near, ahead }
    observers.set(scroller, o)
  }
  return o
}

export function watchNear(el: Element, cb: () => void) {
  callbacks.set(el, cb)
  const o = observersFor(el.closest('.content-scrollable'))
  o.near.observe(el)
  o.ahead.observe(el)
}

export function unwatch(el: Element) {
  callbacks.delete(el)
  idleQueue.delete(el)
  frameQueue.delete(el)
  for (const o of observers.values()) {
    o.near.unobserve(el)
    o.ahead.unobserve(el)
  }
}
