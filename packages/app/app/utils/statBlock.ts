/**
 * Reads the parts of a monster stat block (Markdown, as stored in the Codex)
 * that matter during a fight: traits, attacks and other actions, reactions,
 * legendary actions and spellcasting with its slots or X/day uses.
 * Pure functions so they can be unit tested.
 */

export interface StatBlockFeature {
  name: string
  text: string
}

export interface StatBlockAction extends StatBlockFeature {
  /** Attack bonus, e.g. 4 for "+4 to hit" */
  toHit: number | null
  /** The "Hit:" part, e.g. "5 (1d6 + 2) slashing damage" */
  hit: string | null
  /** First damage dice, e.g. "1d6 + 2" */
  damageDice: string | null
  /** e.g. "DC 13 Dexterity" */
  save: string | null
}

export interface SpellGroup {
  /** As written: "1st level (4 slots)", "3/day each", "At will" */
  label: string
  /** Spell level for prepared spells (0 = cantrips) */
  level: number | null
  /** Slots of that level, or uses per day of each spell */
  slots: number | null
  perDay: number | null
  spells: string[]
}

export interface Spellcasting {
  name: string
  saveDc: number | null
  attack: number | null
  groups: SpellGroup[]
}

export interface StatBlock {
  traits: StatBlockFeature[]
  actions: StatBlockAction[]
  bonusActions: StatBlockAction[]
  reactions: StatBlockAction[]
  legendary: StatBlockAction[]
  spellcasting: Spellcasting[]
}

/** `***Name.*** text` features of one section */
function features(section: string): StatBlockFeature[] {
  const headers = [...section.matchAll(/\*\*\*([^*]+?)\.?\*\*\*/g)]
  return headers.map((match, i) => ({
    name: match[1]!.trim().replace(/\.$/, ''),
    text: section.slice(match.index! + match[0].length, headers[i + 1]?.index ?? section.length).trim(),
  }))
}

function toAction(feature: StatBlockFeature): StatBlockAction {
  const toHit = feature.text.match(/([+-]\d+) to hit/)
  const hit = feature.text.match(/Hit:\s*([^.]+(?:\.\d+[^.]*)?)/)
  // "Hit: 5 (1d6 + 2) slashing" or a flat "Hit: 1 piercing"
  const dice = feature.text.match(/Hit:[^(]*\(([\dd+\-\s]+)\)/)
    ?? feature.text.match(/Hit:\s*(\d+) \w+ damage/)
    // Breath weapons and other saves: "taking 63 (18d6) fire damage"
    ?? feature.text.match(/\((\d+d\d+(?:\s*[+-]\s*\d+)?)\) \w+ damage/)
  const save = feature.text.match(/DC (\d+) (\w+) saving throw/)
  return {
    ...feature,
    toHit: toHit ? Number(toHit[1]) : null,
    hit: hit ? hit[1]!.trim() : null,
    damageDice: dice ? dice[1]!.replace(/\s+/g, ' ').trim() : null,
    save: save ? `DC ${save[1]} ${save[2]}` : null,
  }
}

/** "fire bolt, light, conjure elemental (air elemental only)" -> names, keeping notes in parentheses */
function splitSpells(list: string): string[] {
  const spells: string[] = []
  let depth = 0
  let current = ''
  for (const ch of list) {
    if (ch === '(') depth++
    if (ch === ')') depth = Math.max(0, depth - 1)
    if (ch === ',' && depth === 0) {
      spells.push(current)
      current = ''
    }
    else {
      current += ch
    }
  }
  spells.push(current)
  return spells.map(s => s.replace(/\*/g, '').trim()).filter(Boolean)
}

function parseSpellcasting(feature: StatBlockFeature): Spellcasting {
  const text = feature.text
  const dc = text.match(/spell save DC (\d+)/i)
  const attack = text.match(/([+-]\d+) to hit with spell attacks/i)
  const groups: SpellGroup[] = []

  // Prepared spells: "- 1st level (4 slots): a, b" and "- Cantrips (at will): a, b"
  for (const m of text.matchAll(/(Cantrips \(at will\)|(\d)(?:st|nd|rd|th) level \((\d+) slots?\)):\s*([^\n]+)/gi)) {
    groups.push({
      label: m[1]!,
      level: m[2] ? Number(m[2]) : 0,
      slots: m[3] ? Number(m[3]) : null,
      perDay: null,
      spells: splitSpells(m[4]!),
    })
  }
  // Innate spells: "At will: a, b" and "3/day each: a, b" (sometimes on one line)
  if (!groups.length) {
    const innate = /(At will|(\d+)\/day(?: each)?):\s*([\s\S]+?)(?=(?:At will|\d+\/day(?: each)?):|\n|$)/gi
    for (const m of text.matchAll(innate)) {
      groups.push({ label: m[1]!, level: null, slots: null, perDay: m[2] ? Number(m[2]) : null, spells: splitSpells(m[3]!) })
    }
  }
  return { name: feature.name, saveDc: dc ? Number(dc[1]) : null, attack: attack ? Number(attack[1]) : null, groups }
}

export function parseStatBlock(body: string | null | undefined): StatBlock {
  const block: StatBlock = { traits: [], actions: [], bonusActions: [], reactions: [], legendary: [], spellcasting: [] }
  if (!body) return block

  // "### Actions", "### Reactions", "### Legendary Actions" ...; the part before is traits
  const sections = body.split(/^#{2,4}\s+/m)
  for (const [i, section] of sections.entries()) {
    const heading = i === 0 ? '' : section.slice(0, section.indexOf('\n') + 1 || section.length).trim().toLowerCase()
    const found = features(section)
    if (i === 0) {
      for (const f of found) {
        if (/spellcasting/i.test(f.name)) block.spellcasting.push(parseSpellcasting(f))
        else block.traits.push(f)
      }
    }
    else if (heading.startsWith('legendary')) block.legendary.push(...found.map(toAction))
    else if (heading.startsWith('reaction')) block.reactions.push(...found.map(toAction))
    else if (heading.startsWith('bonus')) block.bonusActions.push(...found.map(toAction))
    else if (heading.startsWith('action')) block.actions.push(...found.map(toAction))
  }
  return block
}

/** Spell name for a Codex lookup: without notes in parentheses */
export function spellLookupName(spell: string): string {
  return spell.replace(/\([^)]*\)/g, '').trim()
}

// Spell slots and innate uses are kept as the participant's limited-use
// abilities under these names (created the first time one is spent)
export const SPELL_RESOURCE_PREFIXES = ['Slots: ', 'Innate: '] as const
export const slotResourceName = (level: number) => `Slots: level ${level}`
export const innateResourceName = (spell: string) => `Innate: ${spellLookupName(spell)}`
export const isSpellResource = (name: string) => SPELL_RESOURCE_PREFIXES.some(p => name.startsWith(p))

/** "Fire Breath (Recharge 5-6)" -> "Fire Breath", the name its limited-use ability has in a fight */
export const abilityName = (name: string) => name.replace(/\s*\([^)]*\)\s*$/, '').trim()

/** Legendary actions that cost more than one: "Wing Attack (Costs 2 Actions)" */
export const legendaryCost = (name: string) => Number(name.match(/Costs (\d+) Actions/i)?.[1] ?? 1)

export interface DiceRoll {
  total: number
  rolls: number[]
  modifier: number
}

/** Rolls "1d6 + 2", "2d8+1d6 - 1"; `double` doubles the dice (critical hit). */
export function rollDice(expression: string, double = false, random: () => number = Math.random): DiceRoll | null {
  const terms = expression.replace(/\s+/g, '').match(/[+-]?[^+-]+/g)
  if (!terms) return null
  const rolls: number[] = []
  let modifier = 0
  let total = 0
  for (const term of terms) {
    const sign = term.startsWith('-') ? -1 : 1
    const body = term.replace(/^[+-]/, '')
    const dice = body.match(/^(\d*)d(\d+)$/i)
    if (dice) {
      const count = (Number(dice[1]) || 1) * (double ? 2 : 1)
      const sides = Number(dice[2])
      if (count > 100 || sides < 1) return null
      for (let i = 0; i < count; i++) {
        const roll = Math.floor(random() * sides) + 1
        rolls.push(roll)
        total += sign * roll
      }
    }
    else if (/^\d+$/.test(body)) {
      modifier += sign * Number(body)
      total += sign * Number(body)
    }
    else {
      return null
    }
  }
  return { total, rolls, modifier }
}
