import { describe, it, expect, beforeAll } from 'vitest'
import type Database from 'better-sqlite3'
import { getTestDb } from '../utils/test-db'
import { getCodexEntry, searchCodex, seedCodex } from '../../server/utils/codex'
import { renderTags } from '../../server/utils/codex-5etools'
import { handleCodexImportRequest, importCodexFile, listCodexSources } from '../../server/utils/codex-import'
import { parseMonsterResources } from '../../server/utils/encounter-resources'
import { parseStatBlock } from '../../app/utils/statBlock'

// A made-up homebrew file in the 5e.tools layout
const homebrew = () => ({
  _meta: { sources: [{ json: 'TestBrew', abbreviation: 'TB', full: 'Test Brew', authors: ['Raul'] }] },
  spell: [
    {
      name: 'Storm Lance',
      source: 'TestBrew',
      level: 3,
      school: 'V',
      time: [{ number: 1, unit: 'action' }],
      range: { type: 'point', distance: { type: 'feet', amount: 120 } },
      components: { v: true, s: true, m: 'a copper rod' },
      duration: [{ type: 'timed', duration: { type: 'minute', amount: 1 }, concentration: true }],
      entries: ['A spear of lightning deals {@damage 4d10} lightning damage on a failed {@skill Dexterity} save.'],
      entriesHigherLevel: [{ type: 'entries', name: 'At Higher Levels', entries: ['+{@dice 1d10} per slot level above 3rd.'] }],
      classes: { fromClassList: [{ name: 'Wizard' }, { name: 'Sorcerer' }] },
    },
    // Imported under this file's code, next to the SRD one
    { name: 'Fireball', source: 'PHB', level: 3, school: 'V', entries: ['Mine'] },
  ],
  monster: [
    {
      name: 'Bog Witch',
      size: ['M'],
      type: { type: 'fey', tags: ['hag'] },
      alignment: ['N', 'E'],
      ac: [{ ac: 15, from: ['natural armor'] }],
      hp: { average: 52, formula: '8d8 + 16' },
      speed: { walk: 30, swim: 30 },
      str: 16, dex: 12, con: 14, int: 13, wis: 14, cha: 15,
      senses: ['darkvision 60 ft.'],
      passive: 12,
      languages: ['Common', 'Sylvan'],
      cr: '3',
      trait: [{ name: 'Amphibious', entries: ['The witch can breathe air and water.'] }],
      spellcasting: [{
        name: 'Innate Spellcasting',
        headerEntries: ['Its spellcasting ability is Charisma (spell save {@dc 12}).'],
        will: ['{@spell dancing lights}'],
        daily: { '2e': ['{@spell fog cloud}', '{@spell sleep}'] },
      }],
      action: [
        { name: 'Claws', entries: ['{@atk mw} {@hit 5} to hit, reach 5 ft., one target. {@h}10 ({@damage 2d6 + 3}) slashing damage.'] },
        { name: 'Bog Breath {@recharge 5}', entries: ['Each creature in a 15-foot cone must make a {@dc 12} Constitution saving throw, taking 14 ({@damage 4d6}) poison damage on a failed save.'] },
      ],
      legendary: [{ name: 'Claw', entries: ['The witch makes a claw attack.'] }],
    },
  ],
  item: [{ name: 'Lantern of Mist', rarity: 'uncommon', wondrous: true, reqAttune: true, entries: ['Sheds dim light.', { type: 'list', items: ['Fog', 'Mist'] }] }],
  feat: [{ name: 'Bog Born', entries: ['You can hold your breath for 10 minutes.'] }],
  monsterFluff: [{ name: 'Bog Witch', entries: ['Lore'] }],
  class: [{ name: 'Not read' }],
  condition: [{ name: 'Soaked', entries: ['You have disadvantage on fire saves.'] }, { _copy: { name: 'Soaked' }, name: 'Drenched' }],
})

describe('codex import', () => {
  let db: Database.Database

  beforeAll(() => {
    db = getTestDb()
    seedCodex(db)
  })

  it('renders 5e.tools tags as text', () => {
    expect(renderTags('{@atk mw} {@hit 5} to hit. {@h}7 ({@damage 2d6}) {@recharge 5}')).toBe('Melee Weapon Attack: +5 to hit. Hit: 7 (2d6) (Recharge 5-6)')
    expect(renderTags('{@creature goblin|mm|Goblins} and {@spell {@b nested}}')).toBe('Goblins and nested')
  })

  it('imports a 5e.tools homebrew file as its own source', () => {
    const result = importCodexFile(db, homebrew())
    expect(result).toEqual({ code: 'tb', title: 'Test Brew', imported: 6, alreadyThere: 0, skipped: 1, ignored: ['class'] })
    expect(getCodexEntry(db, 'spell:fireball|phb')?.sourceCode).toBe('srd51')
    expect(getCodexEntry(db, 'spell:fireball|tb')?.body).toBe('*3rd-level evocation*\n\nMine')

    const spell = getCodexEntry(db, 'spell:storm lance|tb')!
    expect(spell).toMatchObject({ summary: '3rd-level evocation', sourceTitle: 'Test Brew', attribution: 'By Raul' })
    expect(spell.body).toContain('**Duration:** Concentration, up to 1 minute')
    expect(spell.body).toContain('deals 4d10 lightning damage')
    expect(spell.body).toContain('***At Higher Levels.***')
    expect(searchCodex(db, 'storm lance').map(e => e.uid)).toContain('spell:storm lance|tb')
    expect(getCodexEntry(db, 'item:lantern of mist|tb')!.summary).toBe('Wondrous item, uncommon (requires attunement)')
  })

  it('writes monsters so fights read their numbers, attacks, spells and abilities', () => {
    const witch = getCodexEntry(db, 'monster:bog witch|tb')!
    expect(witch.data).toMatchObject({ hp: 52, ac: 15, cr: 3 })
    expect(witch.summary).toBe('CR 3 medium fey (hag)')

    const block = parseStatBlock(witch.body)
    expect(block.traits.map(t => t.name)).toEqual(['Amphibious'])
    expect(block.actions[0]).toMatchObject({ name: 'Claws', toHit: 5, damageDice: '2d6 + 3' })
    expect(block.actions[1]).toMatchObject({ save: 'DC 12 Constitution', damageDice: '4d6' })
    expect(block.spellcasting[0]!.groups.map(g => [g.label, g.spells])).toEqual([
      ['At will', ['dancing lights']],
      ['2/day each', ['fog cloud', 'sleep']],
    ])
    expect(parseMonsterResources(witch.body)).toEqual([
      { name: 'Bog Breath', kind: 'recharge', max_uses: 1, recharge_min: 5 },
      { name: 'Legendary Actions', kind: 'legendary', max_uses: 3 },
    ])
  })

  it('re-imports, lists and removes an import', () => {
    const file = homebrew()
    file.feat = []
    importCodexFile(db, file)
    expect(getCodexEntry(db, 'feat:bog born|tb')?.deletedAt).toBeTruthy()

    expect(listCodexSources(db).find(s => s.code === 'tb')).toMatchObject({ origin: 'import', entryCount: 5 })
    handleCodexImportRequest(db, { method: 'DELETE', segments: ['sources'], query: { code: 'tb' }, body: null })
    expect(getCodexEntry(db, 'spell:storm lance|tb')).toBeNull()
    expect(listCodexSources(db).map(s => s.code)).not.toContain('tb')
  })

  it('imports our own dataset format under a chosen code', () => {
    const result = handleCodexImportRequest(db, {
      method: 'POST',
      segments: ['import'],
      query: {},
      body: { code: 'My Rules!', data: { source: { code: 'x', title: 'House rules' }, entries: [{ kind: 'rule', name: 'Flanking', summary: 'Advantage', body: 'Allies on opposite sides.' }, { kind: 'vehicle', name: 'Cart' }] } },
    })
    expect(result).toMatchObject({ code: 'myrules', title: 'House rules', imported: 1, skipped: 1 })
    expect(getCodexEntry(db, 'rule:flanking|myrules')?.body).toBe('Allies on opposite sides.')
  })

  it('rejects files it cannot use and codes the app owns', () => {
    expect(() => importCodexFile(db, { hello: 1 })).toThrow(/No spells/)
    expect(() => importCodexFile(db, homebrew(), { code: 'srd51' })).toThrow(/already used/)
    expect(() => importCodexFile(db, homebrew(), { code: 'hb' })).toThrow(/already used/)
    expect(() => importCodexFile(db, { spell: [{ name: 'Fireball', level: 3 }] }, { code: 'phb' })).toThrow(/Nothing new/)
    expect(() => handleCodexImportRequest(db, { method: 'DELETE', segments: ['sources'], query: { code: 'srd51' }, body: null })).toThrow(/not found/)
  })
})
