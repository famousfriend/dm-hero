/**
 * Party view (DM Command Center M2): live player numbers from D&D Beyond,
 * with a manual value for any field. Shared by app and server.
 *
 * effective value = manual value if set, else the D&D Beyond value.
 */

export interface SpellSlotLevel {
  level: number
  used: number
  max: number
}

export interface PartyStats {
  name: string
  classLabel: string
  level: number
  hpCurrent: number
  hpMax: number
  hpTemp: number
  ac: number
  passivePerception: number
  passiveInsight: number
  passiveInvestigation: number
  spellSaveDc: number | null
  conditions: string[]
  deathSaveSuccesses: number
  deathSaveFailures: number
  inspiration: boolean
  spellSlots: SpellSlotLevel[]
}

export type PartyField = keyof PartyStats

export const PARTY_FIELDS: PartyField[] = [
  'name',
  'classLabel',
  'level',
  'hpCurrent',
  'hpMax',
  'hpTemp',
  'ac',
  'passivePerception',
  'passiveInsight',
  'passiveInvestigation',
  'spellSaveDc',
  'conditions',
  'deathSaveSuccesses',
  'deathSaveFailures',
  'inspiration',
  'spellSlots',
]

/** The 5e (2014) conditions offered in the manual picker; D&D Beyond ids 1-15 in this order. */
export const PARTY_CONDITIONS = [
  'Blinded',
  'Charmed',
  'Deafened',
  'Exhaustion',
  'Frightened',
  'Grappled',
  'Incapacitated',
  'Invisible',
  'Paralyzed',
  'Petrified',
  'Poisoned',
  'Prone',
  'Restrained',
  'Stunned',
  'Unconscious',
] as const

export const EMPTY_PARTY_STATS: PartyStats = {
  name: '',
  classLabel: '',
  level: 0,
  hpCurrent: 0,
  hpMax: 0,
  hpTemp: 0,
  ac: 10,
  passivePerception: 10,
  passiveInsight: 10,
  passiveInvestigation: 10,
  spellSaveDc: null,
  conditions: [],
  deathSaveSuccesses: 0,
  deathSaveFailures: 0,
  inspiration: false,
  spellSlots: [],
}

export interface PartyMember {
  entityId: number
  /** Character name of the player entity in DM Hero */
  entityName: string
  /** The human player's name (player metadata), if set */
  playerName: string | null
  ddbCharacterId: string | null
  /** Last good numbers from D&D Beyond, or null if never synced */
  ddb: PartyStats | null
  /** How the derived D&D Beyond values were calculated, per field */
  ddbExplain: Partial<Record<PartyField, string>>
  ddbFetchedAt: string | null
  /** Last refresh error (the previous data is kept) */
  ddbError: string | null
  manual: Partial<PartyStats>
  effective: PartyStats
}

/** Manual values win; without D&D Beyond data the entity name fills in for the character name. */
export function mergePartyStats(
  ddb: PartyStats | null,
  manual: Partial<PartyStats>,
  fallbackName: string,
): PartyStats {
  return { ...EMPTY_PARTY_STATS, name: fallbackName, ...(ddb ?? {}), ...manual }
}

/**
 * Damage uses temporary HP first; healing never goes above max. Returns the new
 * hpCurrent/hpTemp to store as manual values.
 */
export function applyHpChange(stats: PartyStats, amount: number): Pick<PartyStats, 'hpCurrent' | 'hpTemp'> {
  if (amount >= 0) {
    return { hpCurrent: Math.min(stats.hpMax, stats.hpCurrent + amount), hpTemp: stats.hpTemp }
  }
  const damage = -amount
  const fromTemp = Math.min(stats.hpTemp, damage)
  return { hpCurrent: Math.max(0, stats.hpCurrent - (damage - fromTemp)), hpTemp: stats.hpTemp - fromTemp }
}

/**
 * D&D Beyond character id from what the DM pastes: a sheet URL
 * (dndbeyond.com/characters/123, .../profile/x/characters/123/...) or the bare number.
 */
export function parseDdbCharacterId(input: string): string | null {
  const text = input.trim()
  if (/^\d{3,12}$/.test(text)) return text
  const match = /dndbeyond\.com\/(?:[^\s?#]*\/)?characters\/(\d{3,12})(?:\b|\/)/i.exec(text)
  return match ? match[1]! : null
}

export function ddbSheetUrl(characterId: string): string {
  return `https://www.dndbeyond.com/characters/${characterId}`
}
