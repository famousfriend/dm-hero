/**
 * Live Session page (DM Command Center M6): which panels show in prep and in
 * live mode, and which are collapsed. Saved per campaign in the browser.
 */

export const LIVE_MODES = ['live', 'prep'] as const
export type LiveMode = (typeof LIVE_MODES)[number]

export const LIVE_PANELS = ['party', 'combat', 'session', 'notes', 'lookup', 'next', 'quests'] as const
export type LivePanel = (typeof LIVE_PANELS)[number]

export interface LivePanelState {
  shown: boolean
  collapsed: boolean
}

export interface LiveLayout {
  mode: LiveMode
  panels: Record<LiveMode, Record<LivePanel, LivePanelState>>
}

/** At the table: party, fights, what's happening now. Before it: loose ends and plans. */
const DEFAULT_SHOWN: Record<LiveMode, readonly LivePanel[]> = {
  live: ['party', 'combat', 'session', 'notes', 'lookup', 'next'],
  prep: ['party', 'session', 'notes', 'next', 'quests'],
}

export function defaultLiveLayout(): LiveLayout {
  const panels = {} as LiveLayout['panels']
  for (const mode of LIVE_MODES) {
    panels[mode] = {} as Record<LivePanel, LivePanelState>
    for (const panel of LIVE_PANELS) panels[mode][panel] = { shown: DEFAULT_SHOWN[mode].includes(panel), collapsed: false }
  }
  return { mode: 'live', panels }
}

/** A saved layout made safe: unknown values are dropped, missing ones fall back to the defaults. */
export function normalizeLiveLayout(value: unknown): LiveLayout {
  const layout = defaultLiveLayout()
  if (!value || typeof value !== 'object') return layout
  const saved = value as { mode?: unknown, panels?: Record<string, Record<string, Partial<LivePanelState>>> }
  if (LIVE_MODES.includes(saved.mode as LiveMode)) layout.mode = saved.mode as LiveMode
  for (const mode of LIVE_MODES) {
    for (const panel of LIVE_PANELS) {
      const state = saved.panels?.[mode]?.[panel]
      if (!state || typeof state !== 'object') continue
      if (typeof state.shown === 'boolean') layout.panels[mode][panel].shown = state.shown
      if (typeof state.collapsed === 'boolean') layout.panels[mode][panel].collapsed = state.collapsed
    }
  }
  return layout
}

export const liveLayoutKey = (campaignId: number) => `dmcc-live-layout-${campaignId}`
