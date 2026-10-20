import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type Database from 'better-sqlite3'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { getTestDb } from '../utils/test-db'
import { DuplicateError, duplicateEncounter, duplicateEntity } from '../../server/utils/entity-duplicate'
import { addParticipants, listParticipants } from '../../server/utils/encounter-participants'
import { applyCombatAction } from '../../server/utils/encounter-actions'
import { applyResourceOp } from '../../server/utils/encounter-resources'
import type { EncounterResource } from '../../types/encounter'

describe('duplicate', () => {
  let db: Database.Database
  let uploads: string
  let campaignId: number
  let npcId: number
  let tavernId: number

  beforeAll(() => {
    db = getTestDb()
    uploads = mkdtempSync(join(tmpdir(), 'dmcc-dup-'))
    mkdirSync(join(uploads, 'campaigns/1/entities'), { recursive: true })
    writeFileSync(join(uploads, 'campaigns/1/entities/guard.png'), 'png')

    campaignId = Number(db.prepare('INSERT INTO campaigns (name) VALUES (?)').run('Dup').lastInsertRowid)
    const type = (name: string) => (db.prepare('SELECT id FROM entity_types WHERE name = ?').get(name) as { id: number }).id
    tavernId = Number(db.prepare('INSERT INTO entities (type_id, campaign_id, name) VALUES (?, ?, ?)').run(type('Location'), campaignId, 'Tavern').lastInsertRowid)
    npcId = Number(
      db.prepare('INSERT INTO entities (type_id, campaign_id, name, description, metadata, image_url, location_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(type('NPC'), campaignId, 'Guard', 'Bored.', '{"race":"human"}', 'campaigns/1/entities/guard.png', tavernId).lastInsertRowid,
    )
    db.prepare('INSERT INTO entity_relations (from_entity_id, to_entity_id, relation_type) VALUES (?, ?, ?)').run(npcId, tavernId, 'works at')
    db.prepare('INSERT INTO entity_relations (from_entity_id, to_entity_id, relation_type) VALUES (?, ?, ?)').run(tavernId, npcId, 'employs')
    const tagId = Number(db.prepare('INSERT INTO tags (name) VALUES (?)').run('dup-watch').lastInsertRowid)
    db.prepare('INSERT INTO entity_tags (entity_id, tag_id) VALUES (?, ?)').run(npcId, tagId)
    db.prepare('INSERT INTO entity_documents (entity_id, title, content, date, sort_order) VALUES (?, ?, ?, ?, 0)').run(npcId, 'Backstory', 'Was a farmer.', '2026-10-20')
  })

  afterAll(() => rmSync(uploads, { recursive: true, force: true }))

  it('copies an entity with its details, relations and its own picture file', () => {
    const copyId = duplicateEntity(db, uploads, npcId, 'Guard (copy)')
    const copy = db.prepare('SELECT * FROM entities WHERE id = ?').get(copyId) as Record<string, unknown>
    expect(copy).toMatchObject({ name: 'Guard (copy)', description: 'Bored.', metadata: '{"race":"human"}', location_id: tavernId, campaign_id: campaignId })
    expect(copy.image_url).not.toBe('campaigns/1/entities/guard.png')
    expect(readFileSync(join(uploads, copy.image_url as string), 'utf8')).toBe('png')

    const relations = db.prepare('SELECT from_entity_id AS f, to_entity_id AS t, relation_type AS r FROM entity_relations WHERE ? IN (from_entity_id, to_entity_id) ORDER BY id').all(copyId)
    expect(relations).toEqual([
      { f: copyId, t: tavernId, r: 'works at' },
      { f: tavernId, t: copyId, r: 'employs' },
    ])
    expect(db.prepare('SELECT COUNT(*) AS n FROM entity_tags WHERE entity_id = ?').get(copyId)).toEqual({ n: 1 })
    expect(db.prepare('SELECT title, content FROM entity_documents WHERE entity_id = ?').all(copyId)).toEqual([{ title: 'Backstory', content: 'Was a farmer.' }])
    // Search finds the copy
    expect(db.prepare('SELECT rowid FROM entities_fts WHERE entities_fts MATCH ?').all('"Guard"').map(r => (r as { rowid: number }).rowid)).toContain(copyId)
  })

  it('uses a default name, and refuses unknown entities', () => {
    const id = duplicateEntity(db, uploads, tavernId)
    expect((db.prepare('SELECT name FROM entities WHERE id = ?').get(id) as { name: string }).name).toBe('Tavern (copy)')
    expect(() => duplicateEntity(db, uploads, 999999)).toThrow(DuplicateError)
  })

  it('leaves the original picture file in place', () => {
    expect(existsSync(join(uploads, 'campaigns/1/entities/guard.png'))).toBe(true)
  })

  it('copies a fight as fresh: full HP, abilities back, no initiative or log', () => {
    const encounterId = Number(db.prepare('INSERT INTO encounters (campaign_id, name, status, round) VALUES (?, ?, ?, 3)').run(campaignId, 'Ambush', 'active').lastInsertRowid)
    addParticipants(db, encounterId, [{ entityId: npcId, currentHp: 11, maxHp: 11, armorClass: 16 }])
    const guard = listParticipants(db, encounterId)[0]!
    db.prepare('UPDATE encounter_participants SET initiative = 14 WHERE id = ?').run(guard.id)
    applyResourceOp(db, guard.id as number, { op: 'add', name: 'Second Wind', kind: 'uses', max_uses: 1 })
    const res = (listParticipants(db, encounterId)[0]!.resources as EncounterResource[])[0]!
    applyResourceOp(db, guard.id as number, { op: 'set', id: res.id, used: 1 })
    applyCombatAction(db, encounterId, guard.id as number, { type: 'damage', amount: 7 })

    const copyId = duplicateEncounter(db, encounterId, 'Ambush again')
    expect(db.prepare('SELECT name, status, round FROM encounters WHERE id = ?').get(copyId)).toEqual({ name: 'Ambush again', status: 'setup', round: 0 })
    const [p] = listParticipants(db, copyId)
    expect(p).toMatchObject({ display_name: 'Guard', current_hp: 11, max_hp: 11, armor_class: 16, initiative: null, is_ko: 0 })
    expect((p!.resources as EncounterResource[]).map(r => [r.name, r.used])).toEqual([['Second Wind', 0]])
    expect(db.prepare('SELECT COUNT(*) AS n FROM encounter_log WHERE encounter_id = ?').get(copyId)).toEqual({ n: 0 })
    // The original is untouched
    expect(listParticipants(db, encounterId)[0]).toMatchObject({ current_hp: 4, initiative: 14 })
  })
})
