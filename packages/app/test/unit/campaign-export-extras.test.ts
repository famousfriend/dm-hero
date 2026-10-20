import { describe, it, expect, beforeEach } from 'vitest'
import type Database from 'better-sqlite3'
import { getTestDb } from '../utils/test-db'
import { exportCampaignExtras, importCampaignExtras } from '../../server/utils/campaign-export-extras'

// Party view, continuity and rules edits travel with a campaign export
let db: Database.Database
let campaignId: number
let playerId: number
let npcId: number
let sessionId: number

const typeId = (name: string) => (db.prepare('SELECT id FROM entity_types WHERE name = ?').get(name) as { id: number }).id
const addEntity = (campaign: number, type: string, name: string) =>
  Number(db.prepare('INSERT INTO entities (type_id, name, campaign_id) VALUES (?, ?, ?)').run(typeId(type), name, campaign).lastInsertRowid)

beforeEach(() => {
  db = getTestDb()
  campaignId = Number(db.prepare('INSERT INTO campaigns (name) VALUES (?)').run('Source').lastInsertRowid)
  playerId = addEntity(campaignId, 'Player', 'Torin')
  npcId = addEntity(campaignId, 'NPC', 'Sildar')
  sessionId = Number(db.prepare('INSERT INTO sessions (campaign_id, title, session_number) VALUES (?, ?, ?)').run(campaignId, 'One', 1).lastInsertRowid)
  db.prepare('INSERT INTO party_status (entity_id, ddb_character_id, ddb_stats_json, manual_json) VALUES (?, ?, ?, ?)')
    .run(playerId, '12345', '{"hp":30}', '{"ac":17}')
  const itemId = Number(db.prepare('INSERT INTO continuity_items (campaign_id, session_id, kind, text, status, next_session) VALUES (?, ?, ?, ?, ?, ?)')
    .run(campaignId, sessionId, 'promise', `Promised {{npc:${npcId}}} a reward`, 'open', 1).lastInsertRowid)
  db.prepare('INSERT INTO continuity_item_entities (item_id, entity_id) VALUES (?, ?)').run(itemId, npcId)
  db.prepare('INSERT INTO ref_overrides (campaign_id, ref_uid, name, data_json) VALUES (?, ?, ?, ?)').run(campaignId, 'monster:goblin|mm', 'Cragmaw Goblin', '{"hp":9}')
})

function exportIt(mode: 'full' | 'partial', entityIds = [playerId, npcId]) {
  const entities = new Map(entityIds.map((id, i) => [id, `entity:${i + 1}`]))
  return exportCampaignExtras(db, campaignId, {
    mode,
    entities,
    sessions: new Map([[sessionId, 'session:1']]),
    transformLinks: text => text?.replace(/\{\{npc:(\d+)\}\}/g, (m, id: string) => entities.has(Number(id)) ? `{{npc:${entities.get(Number(id))}}}` : m),
  })
}

describe('campaign export extras', () => {
  it('exports party view, continuity and rules edits with portable ids', () => {
    const extras = exportIt('full')
    expect(extras.partyStatus).toEqual([{ entity: 'entity:1', ddbCharacterId: '12345', ddbStatsJson: '{"hp":30}', ddbExplainJson: undefined, ddbFetchedAt: undefined, manualJson: '{"ac":17}' }])
    expect(extras.continuity).toMatchObject([{ session: 'session:1', kind: 'promise', text: 'Promised {{npc:entity:2}} a reward', status: 'open', nextSession: true, entities: ['entity:2'] }])
    expect(extras.campaignEdits).toEqual([{ refUid: 'monster:goblin|mm', name: 'Cragmaw Goblin', summary: undefined, bodyMd: undefined, dataJson: '{"hp":9}' }])
  })

  it('partial exports only carry the exported players\' party rows', () => {
    expect(exportIt('partial', [npcId])).toEqual({ partyStatus: undefined, continuity: undefined, campaignEdits: undefined })
    expect(exportIt('partial', [playerId]).partyStatus).toHaveLength(1)
  })

  it('imports them into another campaign with the new ids', () => {
    const extras = exportIt('full')
    const target = Number(db.prepare('INSERT INTO campaigns (name) VALUES (?)').run('Target').lastInsertRowid)
    const newPlayer = addEntity(target, 'Player', 'Torin')
    const newNpc = addEntity(target, 'NPC', 'Sildar')
    const newSession = Number(db.prepare('INSERT INTO sessions (campaign_id, title, session_number) VALUES (?, ?, ?)').run(target, 'One', 1).lastInsertRowid)
    db.prepare('INSERT INTO ref_overrides (campaign_id, ref_uid, name) VALUES (?, ?, ?)').run(target, 'monster:goblin|mm', 'Mine')

    const counts = importCampaignExtras(db, target, {
      ...extras,
      continuity: [...extras.continuity!, { kind: 'nonsense', text: 'x', status: 'open', nextSession: false, createdAt: '2026-01-01', entities: [] }],
    }, {
      entities: new Map([['entity:1', newPlayer], ['entity:2', newNpc]]),
      sessions: new Map([['session:1', newSession]]),
    })
    expect(counts).toEqual({ party: 1, continuity: 1, campaignEdits: 0, skipped: 1 })

    expect(db.prepare('SELECT ddb_character_id, manual_json FROM party_status WHERE entity_id = ?').get(newPlayer)).toEqual({ ddb_character_id: '12345', manual_json: '{"ac":17}' })
    const item = db.prepare('SELECT id, session_id, text, next_session FROM continuity_items WHERE campaign_id = ?').get(target) as { id: number, session_id: number, text: string, next_session: number }
    expect(item).toMatchObject({ session_id: newSession, text: `Promised {{npc:${newNpc}}} a reward`, next_session: 1 })
    expect(db.prepare('SELECT entity_id FROM continuity_item_entities WHERE item_id = ?').all(item.id)).toEqual([{ entity_id: newNpc }])
    // The target's own rules edit wins
    expect(db.prepare('SELECT name FROM ref_overrides WHERE campaign_id = ?').get(target)).toEqual({ name: 'Mine' })
  })
})
