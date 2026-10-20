import { describe, it, expect } from 'vitest'
import { LIVE_PANELS, defaultLiveLayout, normalizeLiveLayout } from '../../types/live'

describe('live session layout', () => {
  it('shows party and combat at the table, quests when preparing', () => {
    const layout = defaultLiveLayout()
    expect(layout.mode).toBe('live')
    expect(layout.panels.live.combat.shown).toBe(true)
    expect(layout.panels.live.quests.shown).toBe(false)
    expect(layout.panels.prep.quests.shown).toBe(true)
    expect(layout.panels.prep.combat.shown).toBe(false)
  })

  it('keeps valid saved values and falls back for the rest', () => {
    const layout = normalizeLiveLayout({
      mode: 'prep',
      panels: { prep: { combat: { shown: true, collapsed: true }, notes: { shown: 'yes' } }, bogus: {} },
    })
    expect(layout.mode).toBe('prep')
    expect(layout.panels.prep.combat).toEqual({ shown: true, collapsed: true })
    expect(layout.panels.prep.notes).toEqual({ shown: true, collapsed: false })
    expect(Object.keys(layout.panels.live)).toEqual([...LIVE_PANELS])
  })

  it('survives garbage', () => {
    expect(normalizeLiveLayout(null)).toEqual(defaultLiveLayout())
    expect(normalizeLiveLayout({ mode: 'party', panels: 3 })).toEqual(defaultLiveLayout())
  })
})
