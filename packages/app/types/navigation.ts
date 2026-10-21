// The sidebar order the DM can arrange: nav entries by key, plus dividers
// ("divider:<id>"). A hidden entry keeps its place as "hidden:<key>".
// The dashboard always stays on top and isn't part of it.

export const NAV_KEYS = [
  'search', 'live', 'npcs', 'locations', 'items', 'factions', 'lore', 'players', 'party', 'sessions', 'quests',
  'encounters', 'calendar', 'maps', 'music', 'groups', 'notes',
] as const
export type NavKey = typeof NAV_KEYS[number]

/** A nav entry key, a hidden entry ("hidden:<key>") or a divider ("divider:<id>") */
export type NavLayoutEntry = NavKey | `hidden:${NavKey}` | `divider:${string}`

export const MAX_NAV_DIVIDERS = 20

export const isNavDivider = (entry: string): entry is `divider:${string}` => /^divider:[\w-]{1,40}$/.test(entry)

export const isNavHidden = (entry: string): entry is `hidden:${NavKey}` => entry.startsWith('hidden:')

/** The nav key of an entry, hidden or not */
export const navKeyOf = (entry: string) => (isNavHidden(entry) ? entry.slice(7) : entry) as NavKey

/**
 * A saved layout made safe: unknown/duplicate entries go, too many dividers go,
 * entries added in later versions show up at the end - nothing can get lost.
 */
export function normalizeNavLayout(value: unknown): NavLayoutEntry[] {
  const seen = new Set<string>()
  const result: NavLayoutEntry[] = []
  let dividers = 0
  for (const entry of Array.isArray(value) ? value : []) {
    if (typeof entry !== 'string' || seen.has(entry)) continue
    if (isNavDivider(entry)) {
      if (dividers >= MAX_NAV_DIVIDERS) continue
      dividers++
    }
    else if (!(NAV_KEYS as readonly string[]).includes(navKeyOf(entry)) || seen.has(navKeyOf(entry))) continue
    seen.add(isNavDivider(entry) ? entry : navKeyOf(entry))
    result.push(entry as NavLayoutEntry)
  }
  for (const key of NAV_KEYS) if (!seen.has(key)) result.push(key)
  return result
}
