import type { CodexDataset } from './codex'

/*
 * Turns a 5e.tools-style JSON file (homebrew or a data file the DM supplies)
 * into Codex entries with Markdown bodies. Only what the file contains is
 * converted; nothing is downloaded. Monsters are written the way SRD stat
 * blocks are, so the fight tracker reads their attacks, spells and
 * limited-use abilities the same way.
 */

type Json = Record<string, unknown>
type Entry = CodexDataset['entries'][number]

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : value === undefined || value === null ? [] : [value])
const str = (value: unknown) => (typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '')

// ---------------------------------------------------------------- {@tag ...} and entries

const TAG_TEXT: Record<string, (parts: string[]) => string> = {
  hit: p => (Number(p[0]) >= 0 ? `+${p[0]}` : p[0]!),
  h: () => 'Hit: ',
  m: () => 'Miss: ',
  dc: p => `DC ${p[0]}`,
  recharge: p => (p[0] ? `(Recharge ${p[0]}-6)` : '(Recharge 6)'),
  chance: p => `${p[0]} percent`,
  atk: (p) => {
    const kinds: Record<string, string> = {
      'mw': 'Melee Weapon Attack:',
      'rw': 'Ranged Weapon Attack:',
      'mw,rw': 'Melee or Ranged Weapon Attack:',
      'ms': 'Melee Spell Attack:',
      'rs': 'Ranged Spell Attack:',
      'ms,rs': 'Melee or Ranged Spell Attack:',
    }
    return kinds[p[0] ?? ''] ?? 'Attack:'
  },
}

/** "{@damage 2d6 + 3}" -> "2d6 + 3", "{@spell fireball|phb}" -> "fireball"; nested tags too. */
export function renderTags(text: string): string {
  let out = text
  for (let i = 0; i < 10 && /\{@\w+/.test(out); i++) {
    out = out.replace(/\{@(\w+)\s*([^{}]*)\}/g, (_m, tag: string, content: string) => {
      const parts = content.split('|')
      const special = TAG_TEXT[tag]
      if (special) return special(parts)
      // Some tags put the display text third ({@creature goblin|mm|Goblins})
      return (parts[2] || parts[0] || '').trim()
    })
  }
  return out
}

function renderEntry(entry: unknown, depth: number): string {
  if (typeof entry === 'string') return renderTags(entry)
  if (!entry || typeof entry !== 'object') return ''
  const e = entry as Json
  const name = e.name ? renderTags(str(e.name)) : ''

  if (e.type === 'list') {
    return asArray(e.items).map((item) => {
      if (item && typeof item === 'object' && (item as Json).name) {
        const it = item as Json
        const text = [it.entry, ...asArray(it.entries)].filter(Boolean).map(x => renderEntry(x, depth + 1)).join(' ')
        return `- ***${renderTags(str(it.name))}.*** ${text}`
      }
      return `- ${renderEntry(item, depth + 1)}`
    }).join('\n')
  }
  if (e.type === 'table') {
    const labels = asArray(e.colLabels).map(l => renderTags(str(l)))
    const rows = asArray(e.rows).map(row => asArray(row).map(cell => renderEntry(cell, depth + 1).replace(/\|/g, '/').replace(/\n+/g, ' ')))
    if (!rows.length) return ''
    const width = Math.max(labels.length, ...rows.map(r => r.length))
    const header = labels.length ? labels : Array.from({ length: width }, () => ' ')
    const lines = [`| ${header.join(' | ')} |`, `|${' --- |'.repeat(width)}`, ...rows.map(r => `| ${r.join(' | ')} |`)]
    return (e.caption ? `**${renderTags(str(e.caption))}**\n\n` : '') + lines.join('\n')
  }
  if (e.type === 'cell' || e.type === 'dice') return str((e.roll as Json | undefined)?.exact ?? (e.toRoll ? JSON.stringify(e.toRoll) : ''))

  // entries / section / inset / quote / item / anything else with text inside
  const children = [...asArray(e.entries), ...asArray(e.entry), ...asArray(e.items)]
  const body = children.map(c => renderEntry(c, depth + 1)).filter(Boolean)
  if (!name) return body.join('\n\n')
  if (depth <= 1 && e.type === 'section') return [`### ${name}`, ...body].join('\n\n')
  // Named block: first paragraph starts with the bold-italic name, like SRD stat blocks
  const [first = '', ...rest] = body
  return [`***${name}.*** ${first}`.trim(), ...rest].join('\n\n')
}

export function renderEntries(entries: unknown): string {
  return asArray(entries).map(e => renderEntry(e, 0)).filter(Boolean).join('\n\n')
}

// ---------------------------------------------------------------- spells

const SCHOOLS: Record<string, string> = {
  A: 'abjuration',
  C: 'conjuration',
  D: 'divination',
  E: 'enchantment',
  V: 'evocation',
  I: 'illusion',
  N: 'necromancy',
  T: 'transmutation',
}

export const ordinal = (n: number) => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`

function spellTime(spell: Json) {
  return asArray(spell.time).map((t) => {
    const time = t as Json
    const unit = str(time.unit).replace('bonus', 'bonus action')
    const plural = Number(time.number) !== 1 ? 's' : ''
    return `${str(time.number)} ${unit}${plural}${time.condition ? `, ${renderTags(str(time.condition))}` : ''}`.trim()
  }).join(' or ')
}

function spellRange(spell: Json) {
  const range = spell.range as Json | undefined
  if (!range) return ''
  const distance = range.distance as Json | undefined
  if (range.type === 'special') return 'Special'
  if (!distance) return str(range.type)
  if (distance.type === 'self' && range.type !== 'point') return `Self (${str(distance.amount)}-foot ${str(range.type)})`
  if (['self', 'touch', 'sight', 'unlimited'].includes(str(distance.type))) return str(distance.type).replace(/^./, c => c.toUpperCase())
  return `${str(distance.amount)} ${str(distance.type)}`
}

function spellComponents(spell: Json) {
  const c = (spell.components ?? {}) as Json
  const parts: string[] = []
  if (c.v) parts.push('V')
  if (c.s) parts.push('S')
  if (c.m) {
    const m = typeof c.m === 'object' ? str((c.m as Json).text) : str(c.m)
    parts.push(m ? `M (${renderTags(m)})` : 'M')
  }
  return parts.join(', ')
}

function spellDuration(spell: Json): { text: string, concentration: boolean } {
  let concentration = false
  const text = asArray(spell.duration).map((d) => {
    const dur = d as Json
    if (dur.type === 'instant') return 'Instantaneous'
    if (dur.type === 'permanent') return 'Until dispelled'
    if (dur.type === 'special') return 'Special'
    const amount = (dur.duration ?? {}) as Json
    const span = `${str(amount.amount)} ${str(amount.type)}${Number(amount.amount) > 1 ? 's' : ''}`
    if (dur.concentration) {
      concentration = true
      return `Concentration, up to ${span}`
    }
    return span
  }).join(' or ')
  return { text, concentration }
}

function convertSpell(spell: Json): Entry {
  const level = Number(spell.level ?? 0)
  const school = SCHOOLS[str(spell.school)] ?? str(spell.school).toLowerCase()
  const ritual = Boolean((spell.meta as Json | undefined)?.ritual)
  const header = level === 0 ? `${school} cantrip` : `${ordinal(level)}-level ${school}${ritual ? ' (ritual)' : ''}`
  const duration = spellDuration(spell)
  const classes = asArray((spell.classes as Json | undefined)?.fromClassList).map(c => str((c as Json).name)).filter(Boolean)
  const lines = [
    `*${header.replace(/^./, c => c.toUpperCase())}*`,
    ([
      ['Casting Time', spellTime(spell)],
      ['Range', spellRange(spell)],
      ['Components', spellComponents(spell)],
      ['Duration', duration.text],
    ] as const).filter(([, value]) => value).map(([label, value]) => `**${label}:** ${value}`).join('  \n'),
    renderEntries(spell.entries),
  ]
  const higher = renderEntries(spell.entriesHigherLevel)
  if (higher) lines.push(higher)
  if (classes.length) lines.push(`**Classes:** ${classes.join(', ')}`)
  return {
    kind: 'spell',
    name: str(spell.name),
    book: null,
    summary: header,
    body: lines.filter(Boolean).join('\n\n'),
    data: { level, school, ritual, concentration: duration.concentration, classes },
  }
}

// ---------------------------------------------------------------- monsters

const SIZES: Record<string, string> = { T: 'Tiny', S: 'Small', M: 'Medium', L: 'Large', H: 'Huge', G: 'Gargantuan' }
const ALIGNMENTS: Record<string, string> = { L: 'lawful', N: 'neutral', C: 'chaotic', G: 'good', E: 'evil', U: 'unaligned', A: 'any alignment' }
const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const

const modifier = (score: number) => {
  const mod = Math.floor((score - 10) / 2)
  return mod >= 0 ? `+${mod}` : `${mod}`
}

function crValue(cr: unknown): { text: string, value: number | null } {
  const text = typeof cr === 'object' && cr ? str((cr as Json).cr) : str(cr)
  if (!text) return { text: '', value: null }
  const [a, b] = text.split('/').map(Number)
  return { text, value: b ? a! / b : Number.isFinite(a) ? a! : null }
}

function monsterType(type: unknown) {
  if (typeof type === 'string') return type
  const t = (type ?? {}) as Json
  const tags = asArray(t.tags).map(x => (typeof x === 'string' ? x : str((x as Json).tag))).filter(Boolean)
  const base = typeof t.type === 'object' ? asArray((t.type as Json).choose).join(' or ') : str(t.type)
  return tags.length ? `${base} (${tags.join(', ')})` : base
}

function monsterAc(ac: unknown): { text: string, value: number | null } {
  const first = asArray(ac)[0]
  if (typeof first === 'number') return { text: String(first), value: first }
  const obj = (first ?? {}) as Json
  const value = typeof obj.ac === 'number' ? obj.ac : null
  const from = asArray(obj.from).map(f => renderTags(str(f))).join(', ')
  return { text: value === null ? str(obj.special) : `${value}${from ? ` (${from})` : ''}`, value }
}

function monsterSpeed(speed: unknown) {
  if (!speed || typeof speed !== 'object') return str(speed)
  return Object.entries(speed as Json)
    .filter(([key]) => key !== 'canHover')
    .map(([key, value]) => {
      const n = typeof value === 'object' && value ? `${str((value as Json).number)} ft. ${str((value as Json).condition)}`.trim() : `${str(value)} ft.`
      return key === 'walk' ? n : `${key} ${n}`
    })
    .join(', ')
}

const keyed = (obj: unknown) =>
  Object.entries((obj ?? {}) as Json).map(([k, v]) => `${k.replace(/^./, c => c.toUpperCase())} ${str(v)}`).join(', ')

/** 5e.tools spellcasting blocks -> the SRD wording the fight tracker reads */
function renderSpellcasting(block: Json): string {
  const lines: string[] = [renderEntries(block.headerEntries)]
  const spells = (block.spells ?? {}) as Record<string, Json>
  for (const [lvl, group] of Object.entries(spells)) {
    const list = asArray(group.spells).map(s => renderTags(str(s))).join(', ')
    if (lvl === '0') lines.push(`- Cantrips (at will): ${list}`)
    else lines.push(`- ${ordinal(Number(lvl))} level (${str(group.slots ?? 0)} slot${group.slots === 1 ? '' : 's'}): ${list}`)
  }
  const will = asArray(block.will).map(s => renderTags(str(s)))
  if (will.length) lines.push(`At will: ${will.join(', ')}`)
  for (const [key, list] of Object.entries((block.daily ?? {}) as Json)) {
    const n = key.replace('e', '')
    lines.push(`${n}/day${key.endsWith('e') ? ' each' : ''}: ${asArray(list).map(s => renderTags(str(s))).join(', ')}`)
  }
  const footer = renderEntries(block.footerEntries)
  if (footer) lines.push(footer)
  return `***${renderTags(str(block.name) || 'Spellcasting')}.*** ${lines.filter(Boolean).join('\n')}`
}

function namedBlocks(list: unknown): string {
  return asArray(list).map((item) => {
    const it = item as Json
    return `***${renderTags(str(it.name))}.*** ${renderEntries(it.entries)}`
  }).join('\n\n')
}

function convertMonster(m: Json): Entry {
  const size = asArray(m.size).map(s => SIZES[str(s)] ?? str(s)).join(' or ')
  const type = monsterType(m.type)
  const alignment = asArray(m.alignment).map(a => (typeof a === 'string' ? ALIGNMENTS[a] ?? a : '')).filter(Boolean).join(' ')
  const ac = monsterAc(m.ac)
  const hp = (m.hp ?? {}) as Json
  const cr = crValue(m.cr)
  const abilities = Object.fromEntries(ABILITIES.map(a => [a, Number(m[a] ?? 10)]))

  const header = [
    `**Armor Class** ${ac.text}`,
    `**Hit Points** ${hp.average !== undefined ? `${str(hp.average)} (${str(hp.formula)})` : str(hp.special)}`,
    `**Speed** ${monsterSpeed(m.speed)}`,
  ].join('  \n')
  const table = [
    '| STR | DEX | CON | INT | WIS | CHA |',
    '|---|---|---|---|---|---|',
    `| ${ABILITIES.map(a => `${abilities[a]} (${modifier(abilities[a]!)})`).join(' | ')} |`,
  ].join('\n')
  const details = [
    m.save ? `**Saving Throws** ${keyed(m.save)}` : '',
    m.skill ? `**Skills** ${keyed(m.skill)}` : '',
    m.resist ? `**Damage Resistances** ${asArray(m.resist).map(r => (typeof r === 'string' ? r : '')).filter(Boolean).join(', ')}` : '',
    m.immune ? `**Damage Immunities** ${asArray(m.immune).map(r => (typeof r === 'string' ? r : '')).filter(Boolean).join(', ')}` : '',
    m.conditionImmune ? `**Condition Immunities** ${asArray(m.conditionImmune).map(str).filter(Boolean).join(', ')}` : '',
    `**Senses** ${[...asArray(m.senses).map(s => renderTags(str(s))), m.passive !== undefined ? `passive Perception ${str(m.passive)}` : ''].filter(Boolean).join(', ')}`,
    `**Languages** ${asArray(m.languages).map(l => renderTags(str(l))).join(', ') || '—'}`,
    cr.text ? `**Challenge** ${cr.text}` : '',
  ].filter(Boolean).join('  \n')

  const traits = [namedBlocks(m.trait), ...asArray(m.spellcasting).map(s => renderSpellcasting(s as Json))].filter(Boolean)
  const sections = [
    `*${size} ${type}${alignment ? `, ${alignment}` : ''}*`,
    header,
    table,
    details,
    ...traits,
  ]
  if (asArray(m.action).length) sections.push('### Actions', namedBlocks(m.action))
  if (asArray(m.bonus).length) sections.push('### Bonus Actions', namedBlocks(m.bonus))
  if (asArray(m.reaction).length) sections.push('### Reactions', namedBlocks(m.reaction))
  if (asArray(m.legendary).length) {
    const count = Number(m.legendaryActions ?? 3)
    const intro = renderEntries(m.legendaryHeader)
      || `The ${str(m.name).toLowerCase()} can take ${count} legendary actions, choosing from the options below. Only one legendary action option can be used at a time and only at the end of another creature's turn. The ${str(m.name).toLowerCase()} regains spent legendary actions at the start of its turn.`
    sections.push('### Legendary Actions', intro, namedBlocks(m.legendary))
  }

  return {
    kind: 'monster',
    name: str(m.name),
    book: null,
    summary: `CR ${cr.text || '?'} ${size.toLowerCase()} ${type}`.trim(),
    body: sections.filter(Boolean).join('\n\n'),
    data: {
      cr: cr.value,
      type,
      size,
      ac: ac.value,
      hp: typeof hp.average === 'number' ? hp.average : null,
      hitDice: str(hp.formula) || null,
      abilities,
    },
  }
}

// ---------------------------------------------------------------- items, feats, conditions

const RARITIES = new Set(['common', 'uncommon', 'rare', 'very rare', 'legendary', 'artifact'])

function convertItem(item: Json): Entry {
  const rarity = str(item.rarity)
  const wondrous = item.wondrous ? 'Wondrous item' : ''
  const attune = item.reqAttune ? `requires attunement${typeof item.reqAttune === 'string' ? ` ${item.reqAttune}` : ''}` : ''
  const summary = [wondrous || 'Item', RARITIES.has(rarity) ? rarity : ''].filter(Boolean).join(', ') + (attune ? ` (${attune})` : '')
  return {
    kind: 'item',
    name: str(item.name),
    book: null,
    summary,
    body: [`*${summary}*`, renderEntries(item.entries)].filter(Boolean).join('\n\n'),
    data: { rarity: rarity || null, attunement: Boolean(item.reqAttune) },
  }
}

function convertFeat(feat: Json): Entry {
  return { kind: 'feat', name: str(feat.name), book: null, summary: 'Feat', body: renderEntries(feat.entries), data: {} }
}

function convertCondition(condition: Json, label: string): Entry {
  return { kind: 'condition', name: str(condition.name), book: null, summary: label, body: renderEntries(condition.entries), data: {} }
}

const CONVERTERS: Record<string, (e: Json) => Entry> = {
  spell: convertSpell,
  monster: convertMonster,
  item: convertItem,
  baseitem: convertItem,
  magicvariant: convertItem,
  feat: convertFeat,
  condition: e => convertCondition(e, 'Condition'),
  disease: e => convertCondition(e, 'Disease'),
}

export interface FiveEToolsResult {
  entries: Entry[]
  /** Entries that only point at others (`_copy`) can't be converted on their own */
  skipped: number
  /** Kinds of content in the file we don't read (e.g. classes, races) */
  ignored: string[]
  meta: { abbreviation: string | null, title: string | null, author: string | null }
}

export function isFiveEToolsFile(json: unknown): boolean {
  return !!json && typeof json === 'object' && Object.keys(CONVERTERS).some(k => Array.isArray((json as Json)[k]))
}

export function convertFiveETools(json: Json): FiveEToolsResult {
  const entries: Entry[] = []
  let skipped = 0
  const ignored: string[] = []
  for (const [key, value] of Object.entries(json)) {
    if (key.startsWith('_') || !Array.isArray(value)) continue
    const convert = CONVERTERS[key]
    if (!convert) {
      // Fluff (lore and pictures for other entries) is not content of its own
      if (value.length && !key.endsWith('Fluff')) ignored.push(key)
      continue
    }
    for (const raw of value) {
      const e = raw as Json
      if (!e || typeof e !== 'object' || e._copy || !str(e.name)) {
        skipped++
        continue
      }
      try {
        entries.push(convert(e))
      }
      catch {
        skipped++
      }
    }
  }
  const source = asArray((json._meta as Json | undefined)?.sources)[0] as Json | undefined
  return {
    entries,
    skipped,
    ignored,
    meta: {
      abbreviation: source ? str(source.abbreviation) || str(source.json) : null,
      title: source ? str(source.full) || null : null,
      author: source ? asArray(source.authors).map(str).join(', ') || null : null,
    },
  }
}
