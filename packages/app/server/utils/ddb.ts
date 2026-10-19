/**
 * D&D Beyond character sheet → party numbers.
 *
 * Reads the JSON of the unofficial character service
 * (character-service.dndbeyond.com/character/v5/character/{id}); the sheet must be
 * set to Public. D&D Beyond does most math in the browser, so derived values
 * (ability scores, AC, passives, max HP, spell save DC, slot maxima) are
 * recalculated here, each with a short explanation for the UI. Everything that
 * touches the D&D Beyond format lives in this file (risk R14).
 */
import { PARTY_CONDITIONS, type PartyField, type PartyStats, type SpellSlotLevel } from '../../types/party'

// ---------------------------------------------------------------------------
// The parts of the D&D Beyond format we read (everything optional: it is unofficial)
// ---------------------------------------------------------------------------

interface DdbModifier {
  type?: string
  subType?: string
  value?: number | null
  fixedValue?: number | null
  statId?: number | null
  componentId?: number | null
}

interface DdbItem {
  id?: number
  equipped?: boolean
  isAttuned?: boolean
  definition?: {
    id?: number
    name?: string
    armorClass?: number | null
    armorTypeId?: number | null
    filterType?: string
    type?: string
    canAttune?: boolean
  }
}

interface DdbClass {
  level?: number
  definition?: { name?: string, spellCastingAbilityId?: number | null }
  subclassDefinition?: { name?: string, spellCastingAbilityId?: number | null } | null
}

export interface DdbCharacter {
  id?: number
  name?: string
  stats?: Array<{ id: number, value: number | null }>
  bonusStats?: Array<{ id: number, value: number | null }>
  overrideStats?: Array<{ id: number, value: number | null }>
  baseHitPoints?: number
  bonusHitPoints?: number | null
  overrideHitPoints?: number | null
  removedHitPoints?: number
  temporaryHitPoints?: number
  inspiration?: boolean
  deathSaves?: { failCount?: number | null, successCount?: number | null, isStabilized?: boolean }
  conditions?: Array<{ id: number, level?: number | null }>
  classes?: DdbClass[]
  modifiers?: Record<string, DdbModifier[] | undefined>
  inventory?: DdbItem[]
  spellSlots?: Array<{ level: number, used?: number, available?: number }>
  pactMagic?: Array<{ level: number, used?: number, available?: number }>
  /** Hand edits made on the sheet ("customize"): { typeId, value, valueId } */
  characterValues?: Array<{ typeId: number, value: unknown, valueId?: string | number | null }>
}

// characterValues typeIds we honour (sheet "customize" fields)
const CV_AC_OVERRIDE = 1
const CV_AC_MAGIC_BONUS = 2
const CV_AC_MISC_BONUS = 3
const CV_SKILL_PROFICIENCY = 26 // value: 1 none, 2 half, 3 proficient, 4 expertise
// D&D Beyond skill ids
const SKILL_IDS: Record<string, number> = { investigation: 7, insight: 11, perception: 13 }

/** Accepts the API envelope ({ success, data }) or the bare character. */
export function unwrapDdbResponse(json: unknown): DdbCharacter {
  if (!json || typeof json !== 'object') throw new Error('Not a D&D Beyond character file')
  const obj = json as { success?: boolean, data?: unknown, message?: string }
  if ('success' in obj && obj.success === false) {
    throw new Error(obj.message || 'D&D Beyond did not return the character')
  }
  const character = (obj.data && typeof obj.data === 'object' ? obj.data : obj) as DdbCharacter
  if (!Array.isArray(character.stats) || !Array.isArray(character.classes)) {
    throw new Error('Not a D&D Beyond character file')
  }
  return character
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

const ABILITIES = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'] as const
const ABILITY_SHORT = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA']
const mod = (score: number) => Math.floor((score - 10) / 2)
const signed = (n: number) => (n >= 0 ? `+${n}` : String(n))

// Spellcasting progression for the multiclass slot table (PHB p.165)
const FULL_CASTERS = ['bard', 'cleric', 'druid', 'sorcerer', 'wizard']
const HALF_CASTERS = ['paladin', 'ranger']
const THIRD_CASTER_SUBCLASSES = ['eldritch knight', 'arcane trickster']
const SLOT_TABLE: number[][] = [
  [], [2], [3], [4, 2], [4, 3], [4, 3, 2], [4, 3, 3], [4, 3, 3, 1], [4, 3, 3, 2], [4, 3, 3, 3, 1],
  [4, 3, 3, 3, 2], [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1, 1], [4, 3, 3, 3, 3, 1, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 3, 2, 2, 1, 1],
]
// Warlock pact magic: [slots, slot level] by warlock level
const PACT_TABLE: Array<[number, number]> = [
  [0, 0], [1, 1], [2, 1], [2, 2], [2, 2], [2, 3], [2, 3], [2, 4], [2, 4], [2, 5],
  [2, 5], [3, 5], [3, 5], [3, 5], [3, 5], [3, 5], [3, 5], [4, 5], [4, 5], [4, 5], [4, 5],
]

export interface MappedCharacter {
  stats: PartyStats
  explain: Partial<Record<PartyField, string>>
}

export function mapDdbCharacter(character: DdbCharacter): MappedCharacter {
  const explain: Partial<Record<PartyField, string>> = {}

  // Item modifiers only count while the item is equipped (and attuned, if it needs attunement)
  const activeItemIds = new Set<number>()
  for (const item of character.inventory ?? []) {
    const def = item.definition
    if (!item.equipped || !def?.id) continue
    if (def.canAttune && !item.isAttuned) continue
    activeItemIds.add(def.id)
  }
  const modifiers: DdbModifier[] = []
  for (const [group, list] of Object.entries(character.modifiers ?? {})) {
    for (const m of list ?? []) {
      if (group === 'item' && !activeItemIds.has(m.componentId ?? -1)) continue
      modifiers.push(m)
    }
  }
  const sumBonus = (subType: string) =>
    modifiers
      .filter(m => m.type === 'bonus' && m.subType === subType)
      .reduce((total, m) => total + (m.value ?? m.fixedValue ?? 0), 0)
  const has = (type: string, subType: string) => modifiers.some(m => m.type === type && m.subType === subType)
  const customValue = (typeId: number, valueId?: number) => {
    const entry = character.characterValues?.find(
      v => v.typeId === typeId && (valueId === undefined || Number(v.valueId) === valueId),
    )
    const n = Number(entry?.value)
    return entry && entry.value !== null && Number.isFinite(n) ? n : null
  }

  // Level and classes
  const classes = character.classes ?? []
  const level = classes.reduce((total, c) => total + (c.level ?? 0), 0)
  const classLabel = classes
    .map(c => `${c.definition?.name ?? '?'}${c.subclassDefinition?.name ? ` (${c.subclassDefinition.name})` : ''} ${c.level ?? 0}`)
    .join(' / ')
  const proficiency = Math.ceil(Math.max(level, 1) / 4) + 1

  // Ability scores
  const scores = ABILITIES.map((ability, index) => {
    const id = index + 1
    const override = character.overrideStats?.find(s => s.id === id)?.value
    if (override) return override
    const base = character.stats?.find(s => s.id === id)?.value ?? 10
    const bonus = character.bonusStats?.find(s => s.id === id)?.value ?? 0
    let score = base + bonus + sumBonus(`${ability}-score`)
    for (const m of modifiers) {
      if (m.type === 'set' && m.subType === `${ability}-score` && (m.value ?? 0) > score) score = m.value ?? score
    }
    return score
  })
  const abilityMod = (statId: number) => mod(scores[statId - 1] ?? 10)
  const dexMod = abilityMod(2)
  const conMod = abilityMod(3)

  // Hit points
  let hpMax: number
  if (character.overrideHitPoints) {
    hpMax = character.overrideHitPoints
    explain.hpMax = `Set on the sheet: ${hpMax}`
  }
  else {
    const base = character.baseHitPoints ?? 0
    const bonus = character.bonusHitPoints ?? 0
    const perLevel = sumBonus('hit-points-per-level')
    const flat = sumBonus('hit-points')
    hpMax = base + bonus + (conMod + perLevel) * level + flat
    explain.hpMax = `Rolled/fixed ${base} + CON ${signed(conMod)} × ${level}`
      + (perLevel ? ` + ${perLevel} × ${level} (per level)` : '')
      + (bonus ? ` + ${bonus} (bonus)` : '') + (flat ? ` + ${flat}` : '')
  }
  const hpCurrent = Math.max(0, hpMax - (character.removedHitPoints ?? 0))
  const hpTemp = character.temporaryHitPoints ?? 0

  // Armor class
  const equipped = (character.inventory ?? []).filter(i => i.equipped && i.definition)
  const armor = equipped.find(i => [1, 2, 3].includes(i.definition!.armorTypeId ?? 0))
  const shield = equipped.find(i => i.definition!.armorTypeId === 4)
  let ac: number
  const acParts: string[] = []
  if (armor) {
    const def = armor.definition!
    const dexPart = def.armorTypeId === 1 ? dexMod : def.armorTypeId === 2 ? Math.min(dexMod, 2) : 0
    ac = (def.armorClass ?? 10) + dexPart
    acParts.push(`${def.name} ${def.armorClass}`)
    if (dexPart) acParts.push(`DEX ${signed(dexPart)}`)
    const armored = sumBonus('armored-armor-class')
    if (armored) {
      ac += armored
      acParts.push(`${signed(armored)} while armored`)
    }
  }
  else {
    ac = 10 + dexMod
    acParts.push(`10 + DEX ${signed(dexMod)}`)
    const unarmored = modifiers.filter(m => m.subType === 'unarmored-armor-class')
    // Unarmored Defense (Barbarian CON, Monk WIS) or a fixed bonus; the best one applies
    let best = 0
    let bestText = ''
    for (const m of unarmored) {
      const amount = m.statId ? abilityMod(m.statId) : (m.value ?? 0)
      if (amount > best) {
        best = amount
        bestText = m.statId ? `${ABILITY_SHORT[m.statId - 1]} ${signed(amount)} (unarmored)` : `${signed(amount)} (unarmored)`
      }
    }
    if (best) {
      ac += best
      acParts.push(bestText)
    }
  }
  if (shield) {
    const value = shield.definition!.armorClass ?? 2
    ac += value
    acParts.push(`shield ${signed(value)}`)
  }
  const acBonus = sumBonus('armor-class')
  if (acBonus) {
    ac += acBonus
    acParts.push(`items/features ${signed(acBonus)}`)
  }
  const customAcBonus = (customValue(CV_AC_MAGIC_BONUS) ?? 0) + (customValue(CV_AC_MISC_BONUS) ?? 0)
  if (customAcBonus) {
    ac += customAcBonus
    acParts.push(`sheet bonus ${signed(customAcBonus)}`)
  }
  const acOverride = customValue(CV_AC_OVERRIDE)
  if (acOverride) {
    ac = acOverride
    acParts.splice(0, acParts.length, `Set on the sheet: ${acOverride}`)
  }
  explain.ac = acParts.join(', ')

  // Passive skills: 10 + ability + proficiency (expertise doubles, Jack of All Trades/half adds half)
  const passive = (skill: string, statId: number, label: string): number => {
    const abilityPart = abilityMod(statId)
    let profPart = 0
    const customLevel = customValue(CV_SKILL_PROFICIENCY, SKILL_IDS[skill])
    if (customLevel !== null) {
      profPart = customLevel === 4 ? proficiency * 2 : customLevel === 3 ? proficiency : customLevel === 2 ? Math.floor(proficiency / 2) : 0
    }
    else if (has('expertise', skill)) profPart = proficiency * 2
    else if (has('proficiency', skill)) profPart = proficiency
    else if (has('half-proficiency', skill) || has('half-proficiency', 'ability-checks')) {
      profPart = Math.floor(proficiency / 2)
    }
    const bonus = sumBonus(skill) + sumBonus(`passive-${skill}`)
    const total = 10 + abilityPart + profPart + bonus
    explain[label as PartyField] = `10 + ${ABILITY_SHORT[statId - 1]} ${signed(abilityPart)}`
      + (profPart ? ` + proficiency ${signed(profPart)}` : '') + (bonus ? ` + ${bonus} (bonus)` : '')
    return total
  }
  const passivePerception = passive('perception', 5, 'passivePerception')
  const passiveInsight = passive('insight', 5, 'passiveInsight')
  const passiveInvestigation = passive('investigation', 4, 'passiveInvestigation')

  // Spell save DC: highest of the character's spellcasting classes
  let spellSaveDc: number | null = null
  const dcParts: string[] = []
  const dcBonus = sumBonus('spell-save-dc')
  for (const c of classes) {
    const statId = c.subclassDefinition?.spellCastingAbilityId || c.definition?.spellCastingAbilityId
    if (!statId) continue
    const dc = 8 + proficiency + abilityMod(statId) + dcBonus
    dcParts.push(`${c.definition?.name}: 8 + prof ${proficiency} + ${ABILITY_SHORT[statId - 1]} ${signed(abilityMod(statId))}${dcBonus ? ` + ${dcBonus}` : ''} = ${dc}`)
    if (spellSaveDc === null || dc > spellSaveDc) spellSaveDc = dc
  }
  if (dcParts.length) explain.spellSaveDc = dcParts.join('; ')

  // Spell slots: max from the multiclass table (D&D Beyond sends only what was used)
  let casterLevel = 0
  let warlockLevel = 0
  for (const c of classes) {
    const name = (c.definition?.name ?? '').toLowerCase()
    const sub = (c.subclassDefinition?.name ?? '').toLowerCase()
    const lvl = c.level ?? 0
    if (FULL_CASTERS.includes(name)) casterLevel += lvl
    else if (name === 'artificer') casterLevel += Math.ceil(lvl / 2)
    else if (HALF_CASTERS.includes(name)) casterLevel += Math.floor(lvl / 2)
    else if (THIRD_CASTER_SUBCLASSES.includes(sub)) casterLevel += Math.floor(lvl / 3)
    else if (name === 'warlock') warlockLevel += lvl
  }
  const slotMax = SLOT_TABLE[Math.min(casterLevel, 20)] ?? []
  const spellSlots: SpellSlotLevel[] = []
  for (let lvl = 1; lvl <= 9; lvl++) {
    const sent = character.spellSlots?.find(s => s.level === lvl)
    const max = Math.max(slotMax[lvl - 1] ?? 0, sent?.available ?? 0)
    if (max > 0) spellSlots.push({ level: lvl, used: Math.min(sent?.used ?? 0, max), max })
  }
  if (warlockLevel) {
    const [count, slotLevel] = PACT_TABLE[Math.min(warlockLevel, 20)]!
    const sent = character.pactMagic?.find(s => s.level === slotLevel)
    const existing = spellSlots.find(s => s.level === slotLevel)
    const used = Math.min(sent?.used ?? 0, count)
    // Pact slots are shown together with regular slots of the same level
    if (existing) {
      existing.max += count
      existing.used += used
    }
    else if (count) spellSlots.push({ level: slotLevel, used, max: count })
    spellSlots.sort((a, b) => a.level - b.level)
  }
  if (casterLevel || warlockLevel) {
    explain.spellSlots = [casterLevel ? `caster level ${casterLevel}` : '', warlockLevel ? `pact magic (warlock ${warlockLevel})` : '']
      .filter(Boolean)
      .join(' + ')
  }

  // Conditions (D&D Beyond ids 1-15, exhaustion has a level)
  const conditions = (character.conditions ?? [])
    .map((c) => {
      const name = PARTY_CONDITIONS[c.id - 1]
      if (!name) return null
      return name === 'Exhaustion' && c.level ? `Exhaustion ${c.level}` : name
    })
    .filter((c): c is string => !!c)

  return {
    stats: {
      name: (character.name || '').trim(),
      classLabel,
      level,
      hpCurrent,
      hpMax,
      hpTemp,
      ac,
      passivePerception,
      passiveInsight,
      passiveInvestigation,
      spellSaveDc,
      conditions,
      deathSaveSuccesses: character.deathSaves?.successCount ?? 0,
      deathSaveFailures: character.deathSaves?.failCount ?? 0,
      inspiration: !!character.inspiration,
      spellSlots,
    },
    explain,
  }
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

export const DDB_CHARACTER_URL = 'https://character-service.dndbeyond.com/character/v5/character/'

export class DdbFetchError extends Error {}

/** Loads a public character; throws DdbFetchError with a message the DM can act on. */
export async function fetchDdbCharacter(characterId: string, timeoutMs = 10000): Promise<DdbCharacter> {
  let response: Response
  try {
    response = await fetch(DDB_CHARACTER_URL + encodeURIComponent(characterId), {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    })
  }
  catch {
    throw new DdbFetchError('D&D Beyond could not be reached (offline or blocked).')
  }
  if (response.status === 403 || response.status === 404) {
    throw new DdbFetchError('Character not found or not public. Set the sheet\'s sharing to Public on D&D Beyond.')
  }
  if (!response.ok) {
    throw new DdbFetchError(`D&D Beyond answered with an error (${response.status}).`)
  }
  try {
    return unwrapDdbResponse(await response.json())
  }
  catch (error) {
    throw new DdbFetchError(error instanceof Error ? error.message : 'Unexpected answer from D&D Beyond.')
  }
}
