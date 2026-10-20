import { describe, it, expect, beforeAll } from 'vitest'
import Database from 'better-sqlite3'
import { getTestDb } from '../utils/test-db'
import { migrations } from '../../server/utils/migrations'
import { addParticipants, getParticipant, listParticipants } from '../../server/utils/encounter-participants'

describe('encounter participants: reference monsters and AC', () => {
  let db: Database.Database
  let encounterId: number
  let npcId: number

  beforeAll(() => {
    db = getTestDb()
    const campaignId = Number(db.prepare('INSERT INTO campaigns (name) VALUES (?)').run('Fights').lastInsertRowid)
    const npcType = (db.prepare('SELECT id FROM entity_types WHERE name = ?').get('NPC') as { id: number }).id
    npcId = Number(db.prepare('INSERT INTO entities (type_id, campaign_id, name) VALUES (?, ?, ?)').run(npcType, campaignId, 'Klarg').lastInsertRowid)
    encounterId = Number(db.prepare('INSERT INTO encounters (campaign_id, name) VALUES (?, ?)').run(campaignId, 'Cave').lastInsertRowid)

    const sourceId = Number(
      db.prepare('INSERT INTO ref_sources (code, title, license, origin) VALUES (\'test-mm\', \'Test\', \'test\', \'user\')').run().lastInsertRowid,
    )
    const entry = db.prepare('INSERT INTO ref_entries (ref_uid, kind, name, source_id, data_json) VALUES (?, ?, ?, ?, ?)')
    entry.run('monster:goblin|test', 'monster', 'Goblin', sourceId, JSON.stringify({ hp: 7, ac: 15 }))
    entry.run('spell:fireball|test', 'spell', 'Fireball', sourceId, null)
  })

  it('adds several copies of a reference monster with its HP and AC', () => {
    addParticipants(db, encounterId, [{ refUid: 'monster:goblin|test', count: 3 }])
    const goblins = listParticipants(db, encounterId)
    expect(goblins.map(p => [p.display_name, p.duplicate_index, p.current_hp, p.max_hp, p.armor_class, p.entity_id, p.entity_type])).toEqual([
      ['Goblin', 0, 7, 7, 15, null, 'Monster'],
      ['Goblin', 1, 7, 7, 15, null, 'Monster'],
      ['Goblin', 2, 7, 7, 15, null, 'Monster'],
    ])
  })

  it('keeps entities working, with an optional AC, and skips unknown or non-monster entries', () => {
    addParticipants(db, encounterId, [
      { entityId: npcId, currentHp: 20, maxHp: 27, armorClass: 14 },
      { refUid: 'spell:fireball|test' },
      { refUid: 'monster:nothing|test' },
      { entityId: 999999 },
      { refUid: 'monster:goblin|test', count: 100 },
    ])
    const all = listParticipants(db, encounterId)
    const klarg = all.find(p => p.entity_id === npcId)!
    expect(klarg).toMatchObject({ display_name: 'Klarg', current_hp: 20, max_hp: 27, armor_class: 14, entity_type: 'NPC', ref_uid: null })
    // 3 earlier goblins + Klarg + 20 (capped) goblins
    expect(all).toHaveLength(24)
    expect(all.map(p => p.sort_order)).toEqual([...all.map(p => p.sort_order)].sort((a, b) => Number(a) - Number(b)))
    expect(getParticipant(db, encounterId, klarg.id as number)).toMatchObject({ display_name: 'Klarg' })
  })

  it('refuses a participant that is neither an entity nor a monster', () => {
    expect(() =>
      db.prepare('INSERT INTO encounter_participants (encounter_id, display_name) VALUES (?, ?)').run(encounterId, 'Ghost'),
    ).toThrow(/CHECK/)
  })
})

describe('migration 70 keeps existing fights', () => {
  it('rebuilds encounter_participants without losing participants or effects', () => {
    const db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    for (const m of migrations.filter(m => m.version < 70)) m.up(db)

    const campaignId = Number(db.prepare('INSERT INTO campaigns (name) VALUES (?)').run('Old').lastInsertRowid)
    const npcType = (db.prepare('SELECT id FROM entity_types WHERE name = ?').get('NPC') as { id: number }).id
    const npcId = Number(db.prepare('INSERT INTO entities (type_id, campaign_id, name) VALUES (?, ?, ?)').run(npcType, campaignId, 'Orc').lastInsertRowid)
    const encounterId = Number(db.prepare('INSERT INTO encounters (campaign_id, name) VALUES (?, ?)').run(campaignId, 'Old fight').lastInsertRowid)
    const participantId = Number(
      db.prepare(
        'INSERT INTO encounter_participants (encounter_id, entity_id, display_name, current_hp, max_hp, initiative) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(encounterId, npcId, 'Orc', 9, 15, 12).lastInsertRowid,
    )
    db.prepare('INSERT INTO encounter_effects (participant_id, name, duration_type, duration_rounds, remaining_rounds) VALUES (?, ?, ?, ?, ?)')
      .run(participantId, 'Poisoned', 'rounds', 3, 2)

    db.transaction(() => migrations.find(m => m.version === 70)!.up(db))()

    expect(db.prepare('SELECT id, display_name, current_hp, max_hp, initiative, armor_class, ref_uid FROM encounter_participants').all()).toEqual([
      { id: participantId, display_name: 'Orc', current_hp: 9, max_hp: 15, initiative: 12, armor_class: null, ref_uid: null },
    ])
    expect(db.prepare('SELECT participant_id, name, remaining_rounds FROM encounter_effects').all()).toEqual([
      { participant_id: participantId, name: 'Poisoned', remaining_rounds: 2 },
    ])
    expect(db.pragma('foreign_key_check')).toEqual([])
    // Deleting the encounter still cascades through participants to effects
    db.prepare('DELETE FROM encounters WHERE id = ?').run(encounterId)
    expect(db.prepare('SELECT COUNT(*) AS n FROM encounter_effects').get()).toEqual({ n: 0 })
  })
})
