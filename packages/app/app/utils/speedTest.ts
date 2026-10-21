import type { Router } from 'vue-router'

/**
 * Speed test: clicks through the main pages and scrolls the long lists by
 * itself, timing every frame, so a user can send real numbers from their
 * own PC. State lives here (not in the Settings card) because the card is
 * unmounted while the test visits other pages.
 */
export const speedTest = reactive({ running: false, step: '', report: '' })

const PAGES = ['/', '/npcs', '/locations', '/items', '/factions', '/lore', '/sessions', '/quests', '/encounters']
const SCROLL_PAGES = ['/npcs', '/items', '/locations']

let frames: number[] = []
let longTasks: number[] = []
let lastFrame = 0
let lastBusy = 0

const nextFrame = () => new Promise<number>(r => requestAnimationFrame(r))
const wait = (ms: number) => new Promise(r => setTimeout(r, ms))
const round = (n: number) => Math.round(n * 10) / 10

function startSampling() {
  let stopped = false
  const loop = (t: number) => {
    if (stopped) return
    if (lastFrame) frames.push(t - lastFrame)
    lastFrame = t
    requestAnimationFrame(loop)
  }
  requestAnimationFrame(loop)
  let observer: PerformanceObserver | undefined
  try {
    observer = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        longTasks.push(e.duration)
        lastBusy = Math.max(lastBusy, e.startTime + e.duration)
      }
    })
    observer.observe({ type: 'longtask' })
  }
  catch { /* long tasks are not reported in every browser */ }
  return () => {
    stopped = true
    observer?.disconnect()
  }
}

function take() {
  const out = { frames, longTasks }
  frames = []
  longTasks = []
  return out
}

/** Waits until nothing is busy and frames are on time for 400 ms (max 10 s); returns when the calm began */
async function settle(interval: number) {
  const start = performance.now()
  let calmSince = performance.now()
  while (performance.now() - start < 10000) {
    const t = await nextFrame()
    const last = frames[frames.length - 1] ?? 0
    if (last > interval * 1.5 || t - lastBusy < 50) calmSince = t
    else if (t - calmSince > 400) return calmSince
  }
  return performance.now()
}

function frameStats(list: number[], interval: number) {
  if (!list.length) return 'no frames'
  const sorted = [...list].sort((a, b) => a - b)
  const avg = list.reduce((a, b) => a + b, 0) / list.length
  const slow = list.filter(d => d > interval * 1.5).length
  return `${Math.round(1000 / avg)} fps avg, ${Math.round((slow / list.length) * 100)}% frames late, worst ${round(sorted[sorted.length - 1]!)} ms`
}

export async function runSpeedTest(router: Router, t: (key: string) => string, appVersion: string) {
  if (speedTest.running) return
  speedTest.running = true
  speedTest.report = ''
  const back = router.currentRoute.value.fullPath
  const lines: string[] = []
  const stop = startSampling()
  try {
    // Screen refresh rate: median frame time while idle
    speedTest.step = t('settings.speedTest.measuring')
    await wait(1000)
    take()
    await wait(1000)
    const idle = [...take().frames].sort((a, b) => a - b)
    const interval = idle[Math.floor(idle.length / 2)] ?? 16.7

    const ua = navigator.userAgent
    lines.push(`DM Hero ${appVersion} | ${ua.match(/Electron\/[\d.]+/)?.[0] ?? 'browser'} | ${ua.match(/Chrome\/[\d.]+/)?.[0] ?? ''}`)
    lines.push(`Screen ${Math.round(1000 / interval)} Hz | window ${innerWidth}x${innerHeight} @ ${devicePixelRatio}x | ${navigator.hardwareConcurrency} threads`)
    lines.push(`Theme ${useCookie('dm-hero-theme').value ?? 'default'}`)
    lines.push('')
    lines.push('Page switches (time until the page is calm, longest freeze):')

    for (const path of PAGES) {
      speedTest.step = path
      await settle(interval)
      take()
      const begin = performance.now()
      await router.push(path)
      const ms = (await settle(interval)) - begin
      const { frames: f, longTasks: lt } = take()
      lines.push(`  ${path.padEnd(12)} ${Math.round(ms)} ms, longest freeze ${Math.round(Math.max(0, ...lt, ...f))} ms`)
    }

    lines.push('')
    lines.push('Scrolling (3 s down each list):')
    for (const path of SCROLL_PAGES) {
      speedTest.step = `${path} (scroll)`
      await router.push(path)
      await settle(interval)
      const el = document.querySelector<HTMLElement>('.content-scrollable')
      if (!el) continue
      el.scrollTop = 0
      await settle(interval)
      take()
      const start = performance.now()
      let prev = start
      while (performance.now() - start < 3000) {
        const now = await nextFrame()
        el.scrollTop += (now - prev) * 1.5 // about 1500 px per second
        prev = now
        if (el.scrollTop + el.clientHeight >= el.scrollHeight - 2) el.scrollTop = 0
      }
      const { frames: f, longTasks: lt } = take()
      lines.push(`  ${path.padEnd(12)} ${frameStats(f, interval)}, ${lt.length} long tasks`)
      el.scrollTop = 0
    }
  }
  finally {
    stop()
    speedTest.step = ''
    speedTest.report = lines.join('\n')
    speedTest.running = false
    await router.push(back).catch(() => {})
  }
}
