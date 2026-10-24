import { describe, it, expect, beforeAll } from 'vitest'
import type Database from 'better-sqlite3'
import { parsePlayerPack } from '@dmcc/character-core'
import { getTestDb } from '../utils/test-db'
import { createQuest } from '../../server/utils/quests'
import { handleQuestRequest } from '../../server/utils/quest-route'

describe('player pack export', () => {
  let db: Database.Database
  let campaignId: number
  const ids: Record<string, number> = {}

  beforeAll(() => {
    db = getTestDb()
    campaignId = Number(db.prepare('INSERT INTO campaigns (name) VALUES (?)').run('Crimson Moon').lastInsertRowid)
    const other = Number(db.prepare('INSERT INTO campaigns (name) VALUES (?)').run('Other').lastInsertRowid)
    const typeId = (name: string) => (db.prepare('SELECT id FROM entity_types WHERE name = ?').get(name) as { id: number }).id
    const entity = (type: string, name: string, description: string, campaign = campaignId) =>
      Number(db.prepare('INSERT INTO entities (type_id, campaign_id, name, description) VALUES (?, ?, ?, ?)')
        .run(typeId(type), campaign, name, description).lastInsertRowid)
    ids.saltmarsh = entity('Location', 'Saltmarsh', 'Fishing town')
    ids.vex = entity('NPC', 'Captain Vex', 'Smuggler. SECRET: works for the cult.')
    ids.eliander = entity('NPC', 'Eliander', `Friend of {{npc:${ids.vex}}}`)
    ids.stranger = entity('NPC', 'Stranger', '', other)
    db.prepare('INSERT INTO entity_relations (from_entity_id, to_entity_id, relation_type) VALUES (?, ?, ?)').run(ids.vex, ids.saltmarsh, 'lives_in')
    ids.quest = createQuest(db, campaignId, { name: 'Find the red door', reward: '50 gp', status: 'active' }).id
  })

  const exportPack = (body: Record<string, unknown>) =>
    parsePlayerPack(handleQuestRequest(db, { method: 'POST', segments: ['player-pack'], query: {}, body: { campaignId, ...body } }))

  it('exports only what the DM picked, as a valid pack', () => {
    const pack = exportPack({ npcIds: [ids.vex, ids.stranger], placeIds: [ids.saltmarsh], questIds: [ids.quest], forCharacter: 'Kara' })
    expect(pack.campaign.name).toBe('Crimson Moon')
    expect(pack.forCharacter).toBe('Kara')
    expect(pack.npcs.map(n => n.name)).toEqual(['Captain Vex'])
    expect(pack.npcs[0]!.placeRef).toBe(pack.places[0]!.ref)
    expect(pack.quests[0]).toMatchObject({ name: 'Find the red door', status: 'active', reward: '50 gp' })
  })

  it('leaves descriptions out unless asked, and resolves mentions when sent', () => {
    expect(exportPack({ npcIds: [ids.vex] }).npcs[0]!.description).toBe('')
    const pack = exportPack({ npcIds: [ids.eliander], includeDescriptions: true })
    expect(pack.npcs[0]!.description).toBe('Friend of Captain Vex')
  })

  it('keeps the same refs on every export, so re-imports update', () => {
    const a = exportPack({ npcIds: [ids.vex] })
    const b = exportPack({ npcIds: [ids.vex] })
    expect(a.npcs[0]!.ref).toBe(b.npcs[0]!.ref)
    expect(a.campaign.ref).toBe(b.campaign.ref)
  })
})
