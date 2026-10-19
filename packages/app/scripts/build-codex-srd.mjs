#!/usr/bin/env node
/**
 * Builds the bundled Reference Codex dataset (server/codex-data/srd-5.1.json)
 * from the SRD 5.1 JSON files of the `dnd5-srd` npm package
 * (github.com/soryy708/5e-database, MIT; the text itself is the System
 * Reference Document 5.1 by Wizards of the Coast, CC-BY-4.0).
 *
 * Only SRD content goes in here. Never point this at other book data.
 *
 * Usage:
 *   mkdir /tmp/srd && cd /tmp/srd && npm pack dnd5-srd@1.0.0 && tar xzf dnd5-srd-1.0.0.tgz
 *   node scripts/build-codex-srd.mjs /tmp/srd/package
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const srcDir = process.argv[2]
if (!srcDir) {
  console.error('Usage: node scripts/build-codex-srd.mjs <path to dnd5-srd package dir>')
  process.exit(1)
}

const read = name => JSON.parse(readFileSync(join(srcDir, name), 'utf8'))
const here = dirname(fileURLToPath(import.meta.url))
const outFile = join(here, '..', 'server', 'codex-data', 'srd-5.1.json')

const ordinal = n => (n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`)
const crText = cr => (cr === 0.125 ? '1/8' : cr === 0.25 ? '1/4' : cr === 0.5 ? '1/2' : String(cr))
const mod = (score) => {
  const m = Math.floor((score - 10) / 2)
  return m >= 0 ? `+${m}` : String(m)
}
const paragraphs = list => (list || []).map(p => p.trim()).filter(Boolean).join('\n\n')
const traitBlock = (title, list) =>
  list?.length ? `\n\n### ${title}\n\n${list.map(a => `***${a.name}.*** ${a.desc}`).join('\n\n')}` : ''

const entries = []

// Conditions
for (const c of read('conditions.json')) {
  entries.push({
    kind: 'condition',
    name: c.name,
    book: 'phb',
    summary: 'Condition',
    body: c.desc.map(line => (line.startsWith('- ') ? line : `- ${line}`)).join('\n'),
    data: {},
  })
}

// Spells
for (const s of read('spells.json')) {
  const school = s.school.name
  const levelText = s.level === 0 ? `${school} cantrip` : `${ordinal(s.level)}-level ${school.toLowerCase()}`
  const components = s.components.join(', ') + (s.material ? ` (${s.material.replace(/\.$/, '')})` : '')
  const duration = (s.concentration ? 'Concentration, ' : '') + s.duration
  const header = [
    `*${levelText}${s.ritual ? ' (ritual)' : ''}*`,
    '',
    `**Casting Time:** ${s.casting_time}  `,
    `**Range:** ${s.range}  `,
    `**Components:** ${components}  `,
    `**Duration:** ${duration}`,
  ].join('\n')
  const higher = s.higher_level?.length ? `\n\n***At Higher Levels.*** ${paragraphs(s.higher_level)}` : ''
  const classes = s.classes.length ? `\n\n**Classes:** ${s.classes.map(c => c.name).join(', ')}` : ''
  entries.push({
    kind: 'spell',
    name: s.name,
    book: s.page.startsWith('phb') ? 'phb' : null,
    summary: levelText + (s.ritual ? ' (ritual)' : '') + (s.concentration ? ', concentration' : ''),
    body: `${header}\n\n${paragraphs(s.desc)}${higher}${classes}`,
    data: {
      level: s.level,
      school,
      ritual: s.ritual,
      concentration: s.concentration,
      classes: s.classes.map(c => c.name),
    },
  })
}

// Monsters
for (const m of read('monsters.json')) {
  const type = m.subtype ? `${m.type} (${m.subtype})` : m.type
  const speed = Object.entries(m.speed)
    .map(([k, v]) => (k === 'walk' ? v : `${k} ${v}`))
    .join(', ')
  const abilities = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma']
  const abilityRow = `| STR | DEX | CON | INT | WIS | CHA |\n|---|---|---|---|---|---|\n| ${abilities
    .map(a => `${m[a]} (${mod(m[a])})`)
    .join(' | ')} |`
  const profs = prefix =>
    m.proficiencies
      .filter(p => p.name.startsWith(prefix))
      .map(p => `${p.name.slice(prefix.length)} +${p.value}`)
      .join(', ')
  const saves = profs('Saving Throw: ')
  const skills = profs('Skill: ')
  const senses = Object.entries(m.senses)
    .map(([k, v]) => (k === 'passive_perception' ? `passive Perception ${v}` : `${k} ${v}`))
    .join(', ')
  const lines = [
    `*${m.size} ${type}, ${m.alignment}*`,
    '',
    `**Armor Class** ${m.armor_class}  `,
    `**Hit Points** ${m.hit_points} (${m.hit_dice})  `,
    `**Speed** ${speed}`,
    '',
    abilityRow,
    '',
  ]
  const detail = [
    saves && `**Saving Throws** ${saves}`,
    skills && `**Skills** ${skills}`,
    m.damage_vulnerabilities.length && `**Damage Vulnerabilities** ${m.damage_vulnerabilities.join(', ')}`,
    m.damage_resistances.length && `**Damage Resistances** ${m.damage_resistances.join(', ')}`,
    m.damage_immunities.length && `**Damage Immunities** ${m.damage_immunities.join(', ')}`,
    m.condition_immunities.length
    && `**Condition Immunities** ${m.condition_immunities.map(c => (typeof c === 'string' ? c : c.name)).join(', ')}`,
    `**Senses** ${senses}`,
    `**Languages** ${m.languages || '—'}`,
    `**Challenge** ${crText(m.challenge_rating)}`,
  ].filter(Boolean)
  const body = lines.join('\n') + '\n' + detail.join('  \n')
    + (m.special_abilities?.length ? `\n\n${m.special_abilities.map(a => `***${a.name}.*** ${a.desc}`).join('\n\n')}` : '')
    + traitBlock('Actions', m.actions)
    + traitBlock('Reactions', m.reactions)
    + traitBlock('Legendary Actions', m.legendary_actions)
  entries.push({
    kind: 'monster',
    name: m.name,
    book: 'mm',
    summary: `CR ${crText(m.challenge_rating)} ${m.size.toLowerCase()} ${type}`,
    body,
    data: {
      cr: m.challenge_rating,
      type: m.type,
      size: m.size,
      ac: m.armor_class,
      hp: m.hit_points,
      hitDice: m.hit_dice,
      abilities: Object.fromEntries(abilities.map(a => [a.slice(0, 3), m[a]])),
    },
  })
}

const dataset = {
  source: {
    code: 'srd51',
    title: 'System Reference Document 5.1',
    license: 'CC-BY-4.0',
    attribution:
      'This work includes material taken from the System Reference Document 5.1 ("SRD 5.1") by Wizards of the Coast LLC and available at https://dnd.wizards.com/resources/systems-reference-document. The SRD 5.1 is licensed under the Creative Commons Attribution 4.0 International License available at https://creativecommons.org/licenses/by/4.0/legalcode.',
  },
  entries,
}

mkdirSync(dirname(outFile), { recursive: true })
writeFileSync(outFile, JSON.stringify(dataset) + '\n')
console.log(`Wrote ${entries.length} entries to ${outFile}`)
