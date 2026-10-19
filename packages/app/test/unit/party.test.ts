import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import type Database from 'better-sqlite3'
import { getTestDb } from '../utils/test-db'
import { mapDdbCharacter, unwrapDdbResponse, DdbFetchError, type DdbCharacter } from '../../server/utils/ddb'
import {
  listParty,
  getPartyMember,
  updatePartyMember,
  refreshPartyMember,
  importDdbJson,
  sanitizeManual,
} from '../../server/utils/party'
import { applyHpChange, mergePartyStats, parseDdbCharacterId, EMPTY_PARTY_STATS } from '../../types/party'

// Shaped like character-service.dndbeyond.com/character/v5/character/{id}
function fighterWizard(): DdbCharacter {
  return {
    id: 12345678,
    name: 'Tamsin',
    stats: [
      { id: 1, value: 15 }, { id: 2, value: 14 }, { id: 3, value: 13 },
      { id: 4, value: 15 }, { id: 5, value: 12 }, { id: 6, value: 8 },
    ],
    bonusStats: [{ id: 1, value: null }, { id: 2, value: null }, { id: 3, value: 1 }],
    overrideStats: [{ id: 1, value: null }],
    baseHitPoints: 34,
    bonusHitPoints: null,
    overrideHitPoints: null,
    removedHitPoints: 12,
    temporaryHitPoints: 5,
    inspiration: true,
    deathSaves: { failCount: 1, successCount: 2, isStabilized: false },
    conditions: [{ id: 12, level: null }, { id: 4, level: 2 }],
    classes: [
      { level: 5, definition: { name: 'Fighter', spellCastingAbilityId: null }, subclassDefinition: { name: 'Eldritch Knight', spellCastingAbilityId: 4 } },
      { level: 2, definition: { name: 'Wizard', spellCastingAbilityId: 4 }, subclassDefinition: null },
    ],
    modifiers: {
      race: [{ type: 'bonus', subType: 'dexterity-score', value: 2 }],
      class: [
        { type: 'proficiency', subType: 'perception', value: null },
        { type: 'expertise', subType: 'investigation', value: null },
      ],
      background: [{ type: 'proficiency', subType: 'insight', value: null }],
      feat: [{ type: 'bonus', subType: 'passive-perception', value: 5 }],
      // Ring of Protection (attuned) counts, Cloak of Protection (not attuned) does not
      item: [
        { type: 'bonus', subType: 'armor-class', value: 1, componentId: 501 },
        { type: 'bonus', subType: 'armor-class', value: 1, componentId: 502 },
      ],
      condition: [],
    },
    inventory: [
      { equipped: true, definition: { id: 100, name: 'Half Plate', armorClass: 15, armorTypeId: 2 } },
      { equipped: true, definition: { id: 101, name: 'Shield', armorClass: 2, armorTypeId: 4 } },
      { equipped: false, definition: { id: 102, name: 'Plate', armorClass: 18, armorTypeId: 3 } },
      { equipped: true, isAttuned: true, definition: { id: 501, name: 'Ring of Protection', canAttune: true } },
      { equipped: true, isAttuned: false, definition: { id: 502, name: 'Cloak of Protection', canAttune: true } },
    ],
    spellSlots: [{ level: 1, used: 1, available: 0 }, { level: 2, used: 0, available: 0 }],
    pactMagic: [],
  }
}

describe('D&D Beyond mapping', () => {
  const { stats, explain } = mapDdbCharacter(fighterWizard())

  it('reads identity, hit points, conditions and saves', () => {
    expect(stats).toMatchObject({
      name: 'Tamsin',
      classLabel: 'Fighter (Eldritch Knight) 5 / Wizard 2',
      level: 7,
      // 34 + CON(13+1 → +2) × 7 = 48
      hpMax: 48,
      hpCurrent: 36,
      hpTemp: 5,
      conditions: ['Prone', 'Exhaustion 2'],
      deathSaveSuccesses: 2,
      deathSaveFailures: 1,
      inspiration: true,
    })
    expect(explain.hpMax).toContain('CON +2 × 7')
  })

  it('computes AC from equipped armor, shield and attuned items only', () => {
    // Half plate 15 + DEX(16 → +3, capped at 2) + shield 2 + ring 1
    expect(stats.ac).toBe(20)
    expect(explain.ac).toBe('Half Plate 15, DEX +2, shield +2, items/features +1')
  })

  it('computes passives with proficiency, expertise and bonuses', () => {
    // prof +3 at level 7
    expect(stats.passivePerception).toBe(10 + 1 + 3 + 5)
    expect(stats.passiveInsight).toBe(10 + 1 + 3)
    expect(stats.passiveInvestigation).toBe(10 + 2 + 6)
    expect(explain.passivePerception).toBe('10 + WIS +1 + proficiency +3 + 5 (bonus)')
  })

  it('takes the best spell save DC and multiclass slot maxima', () => {
    expect(stats.spellSaveDc).toBe(8 + 3 + 2)
    // caster level: EK 5/3 → 1, wizard 2 → 3 → slots 4/2
    expect(stats.spellSlots).toEqual([
      { level: 1, used: 1, max: 4 },
      { level: 2, used: 0, max: 2 },
    ])
  })

  it('handles unarmored defense and pact magic', () => {
    const monk = mapDdbCharacter({
      name: 'Bo',
      stats: [{ id: 1, value: 10 }, { id: 2, value: 16 }, { id: 3, value: 10 }, { id: 4, value: 10 }, { id: 5, value: 16 }, { id: 6, value: 10 }],
      classes: [
        { level: 3, definition: { name: 'Monk' } },
        { level: 3, definition: { name: 'Warlock', spellCastingAbilityId: 6 } },
      ],
      baseHitPoints: 30,
      modifiers: { class: [{ type: 'set', subType: 'unarmored-armor-class', statId: 5 }] },
      inventory: [],
      pactMagic: [{ level: 2, used: 1, available: 0 }],
    })
    expect(monk.stats.ac).toBe(16)
    expect(monk.explain.ac).toBe('10 + DEX +3, WIS +3 (unarmored)')
    expect(monk.stats.spellSlots).toEqual([{ level: 2, used: 1, max: 2 }])
  })

  it('maps a real sheet (Monk 7, trimmed to the fields we read)', () => {
    const file = JSON.parse(readFileSync(new URL('../fixtures/ddb-monk-7.json', import.meta.url), 'utf8'))
    const real = mapDdbCharacter(unwrapDdbResponse(file))
    expect(real.stats).toMatchObject({
      name: 'Torin',
      classLabel: 'Monk (Dracon Fist) 7',
      hpMax: 59,
      hpCurrent: 59,
      ac: 18,
      passivePerception: 13,
      passiveInsight: 13,
      passiveInvestigation: 11,
      spellSlots: [],
    })
    // An unequipped Potion of Healing's modifier must not count
    expect(real.explain.hpMax).toBe('Rolled/fixed 45 + CON +2 × 7')
    expect(real.explain.ac).toBe('10 + DEX +5, WIS +3 (unarmored)')
  })

  it('honours hand edits made on the D&D Beyond sheet', () => {
    const edited = mapDdbCharacter({
      ...fighterWizard(),
      characterValues: [
        { typeId: 3, value: 1 },
        { typeId: 26, value: 1, valueId: '13' }, // perception: not proficient
        { typeId: 26, value: 4, valueId: '11' }, // insight: expertise
      ],
    })
    expect(edited.stats.ac).toBe(21)
    expect(edited.stats.passivePerception).toBe(10 + 1 + 5)
    expect(edited.stats.passiveInsight).toBe(10 + 1 + 6)
    expect(mapDdbCharacter({ ...fighterWizard(), characterValues: [{ typeId: 1, value: 25 }] }).stats.ac).toBe(25)
  })

  it('accepts the API envelope and rejects other files', () => {
    expect(unwrapDdbResponse({ success: true, data: fighterWizard() }).name).toBe('Tamsin')
    expect(() => unwrapDdbResponse({ success: false, message: 'Character not found' })).toThrow('Character not found')
    expect(() => unwrapDdbResponse({ hello: 'world' })).toThrow('Not a D&D Beyond character file')
  })
})

describe('party helpers', () => {
  it.each([
    ['https://www.dndbeyond.com/characters/12345678', '12345678'],
    ['dndbeyond.com/profile/raul/characters/987654/builder', '987654'],
    ['  12345678 ', '12345678'],
    ['https://example.com/characters/123456', null],
    ['hello', null],
  ])('parseDdbCharacterId(%j) = %j', (input, expected) => {
    expect(parseDdbCharacterId(input)).toBe(expected)
  })

  it('applies damage to temp HP first and caps healing at max', () => {
    const stats = { ...EMPTY_PARTY_STATS, hpMax: 30, hpCurrent: 20, hpTemp: 5 }
    expect(applyHpChange(stats, -8)).toEqual({ hpCurrent: 17, hpTemp: 0 })
    expect(applyHpChange(stats, -3)).toEqual({ hpCurrent: 20, hpTemp: 2 })
    expect(applyHpChange(stats, -50)).toEqual({ hpCurrent: 0, hpTemp: 0 })
    expect(applyHpChange(stats, 25)).toEqual({ hpCurrent: 30, hpTemp: 5 })
  })

  it('lets manual values win over D&D Beyond', () => {
    const ddb = { ...EMPTY_PARTY_STATS, name: 'Tamsin', ac: 18, hpCurrent: 30 }
    expect(mergePartyStats(ddb, { ac: 20 }, 'Entity name')).toMatchObject({ name: 'Tamsin', ac: 20, hpCurrent: 30 })
    expect(mergePartyStats(null, {}, 'Entity name').name).toBe('Entity name')
  })

  it('sanitizes manual input', () => {
    expect(
      sanitizeManual({ ac: '17', hpCurrent: 12.7, bogus: 1, inspiration: 'yes', conditions: ['Prone', 3], spellSlots: [{ level: 10, used: 1, max: 1 }, { level: 1, used: '2', max: 4 }] }),
    ).toEqual({ ac: 17, hpCurrent: 12, conditions: ['Prone'], spellSlots: [{ level: 1, used: 2, max: 4 }] })
  })
})

describe('party storage', () => {
  let db: Database.Database
  let campaignId: number
  let playerId: number
  let otherId: number

  beforeAll(() => {
    db = getTestDb()
    campaignId = Number(db.prepare('INSERT INTO campaigns (name) VALUES (?)').run('Party Campaign').lastInsertRowid)
    const playerType = db.prepare('SELECT id FROM entity_types WHERE name = ?').get('Player') as { id: number }
    const npcType = db.prepare('SELECT id FROM entity_types WHERE name = ?').get('NPC') as { id: number }
    const insert = db.prepare('INSERT INTO entities (type_id, campaign_id, name, metadata) VALUES (?, ?, ?, ?)')
    playerId = Number(insert.run(playerType.id, campaignId, 'Tamsin', JSON.stringify({ player_name: 'Raul' })).lastInsertRowid)
    otherId = Number(insert.run(playerType.id, campaignId, 'Bo', null).lastInsertRowid)
    insert.run(npcType.id, campaignId, 'Not a player', null)
    const archived = Number(insert.run(playerType.id, campaignId, 'Retired', null).lastInsertRowid)
    db.prepare('UPDATE entities SET archived_at = CURRENT_TIMESTAMP WHERE id = ?').run(archived)
  })

  it('lists active player characters, fully manual until linked', () => {
    const party = listParty(db, campaignId)
    expect(party.map(m => m.entityName)).toEqual(['Bo', 'Tamsin'])
    expect(party[1]).toMatchObject({ playerName: 'Raul', ddbCharacterId: null, ddb: null })
    expect(party[1]!.effective.name).toBe('Tamsin')
  })

  it('keeps manual values across a refresh until reverted', async () => {
    updatePartyMember(db, playerId, { ddbCharacterId: '12345678', manual: { hpCurrent: 3 } })
    const fetcher = async () => fighterWizard()
    expect(await refreshPartyMember(db, playerId, { force: true, fetcher })).toBe(true)

    let member = getPartyMember(db, playerId)!
    expect(member.ddb?.hpCurrent).toBe(36)
    expect(member.effective.hpCurrent).toBe(3)
    expect(member.effective.ac).toBe(20)
    expect(member.ddbFetchedAt).not.toBeNull()

    updatePartyMember(db, playerId, { manual: { hpCurrent: null } })
    member = getPartyMember(db, playerId)!
    expect(member.effective.hpCurrent).toBe(36)
    expect(member.manual).toEqual({})
  })

  it('throttles automatic refreshes but not forced ones', async () => {
    let calls = 0
    const fetcher = async () => {
      calls++
      return fighterWizard()
    }
    expect(await refreshPartyMember(db, playerId, { fetcher })).toBe(false)
    expect(await refreshPartyMember(db, playerId, { force: true, fetcher })).toBe(true)
    expect(calls).toBe(1)
  })

  it('keeps the last good numbers when D&D Beyond fails', async () => {
    const fetcher = async (): Promise<DdbCharacter> => {
      throw new DdbFetchError('D&D Beyond could not be reached (offline or blocked).')
    }
    await refreshPartyMember(db, playerId, { force: true, fetcher })
    const member = getPartyMember(db, playerId)!
    expect(member.ddbError).toContain('could not be reached')
    expect(member.ddb?.name).toBe('Tamsin')
  })

  it('clears old numbers when the link changes, and imports a saved file', () => {
    updatePartyMember(db, playerId, { ddbCharacterId: '999999' })
    expect(getPartyMember(db, playerId)!.ddb).toBeNull()

    importDdbJson(db, otherId, { success: true, data: fighterWizard() })
    const other = getPartyMember(db, otherId)!
    expect(other.ddb?.ac).toBe(20)
    expect(other.ddbCharacterId).toBe('12345678')
    expect(() => importDdbJson(db, otherId, { nope: true })).toThrow()
  })

  it('removes party data with the player', () => {
    db.prepare('DELETE FROM entities WHERE id = ?').run(otherId)
    expect(db.prepare('SELECT COUNT(*) AS n FROM party_status WHERE entity_id = ?').get(otherId)).toEqual({ n: 0 })
  })
})
