import { describe, it, expect, beforeAll } from 'vitest'
import type Database from 'better-sqlite3'
import { getTestDb } from '../utils/test-db'
import {
  TemplateError,
  applyDefaultExtras,
  createFromTemplate,
  fillFromDefault,
  handleTemplateRequest,
  listTemplates,
  saveTemplate,
  setDefaultTemplate,
} from '../../server/utils/entity-templates'

describe('entity templates', () => {
  let db: Database.Database
  let campaignA: number
  let campaignB: number
  let guardId: number
  let tagId: number
  let statTemplateId: number

  const entity = (id: number) => db.prepare('SELECT * FROM entities WHERE id = ?').get(id) as Record<string, unknown>

  beforeAll(() => {
    db = getTestDb()
    campaignA = Number(db.prepare('INSERT INTO campaigns (name) VALUES (?)').run('A').lastInsertRowid)
    campaignB = Number(db.prepare('INSERT INTO campaigns (name) VALUES (?)').run('B').lastInsertRowid)
    const npcType = (db.prepare('SELECT id FROM entity_types WHERE name = ?').get('NPC') as { id: number }).id
    guardId = Number(
      db.prepare('INSERT INTO entities (type_id, campaign_id, name, description, metadata) VALUES (?, ?, ?, ?, ?)')
        .run(npcType, campaignA, 'Gate guard', 'Bored, armed.', JSON.stringify({ race: 'human', class: 'fighter', age: null }))
        .lastInsertRowid,
    )
    tagId = Number(db.prepare('INSERT INTO tags (name) VALUES (?)').run('tpl-watch').lastInsertRowid)
    db.prepare('INSERT INTO entity_tags (entity_id, tag_id) VALUES (?, ?)').run(guardId, tagId)
    statTemplateId = Number(db.prepare('INSERT INTO stat_templates (name) VALUES (?)').run('Tpl stats').lastInsertRowid)
    db.prepare('INSERT INTO entity_stats (entity_id, template_id, values_json) VALUES (?, ?, ?)').run(guardId, statTemplateId, '{"hp":11}')
  })

  it('saves an entry as a template and creates new entries from it in any campaign', () => {
    const tpl = saveTemplate(db, guardId, 'Town guard')
    expect(tpl).toMatchObject({ type: 'npc', name: 'Town guard', description: 'Bored, armed.', isDefault: false, hasStats: true, tagCount: 1 })

    const newId = createFromTemplate(db, tpl.id, campaignB)
    expect(entity(newId)).toMatchObject({ name: 'Town guard', campaign_id: campaignB, description: 'Bored, armed.' })
    expect(JSON.parse(entity(newId).metadata as string)).toMatchObject({ race: 'human', class: 'fighter' })
    expect(db.prepare('SELECT template_id, values_json FROM entity_stats WHERE entity_id = ?').get(newId)).toEqual({ template_id: statTemplateId, values_json: '{"hp":11}' })
    expect(db.prepare('SELECT tag_id FROM entity_tags WHERE entity_id = ?').all(newId)).toEqual([{ tag_id: tagId }])
    // Search finds it
    expect(db.prepare('SELECT rowid FROM entities_fts WHERE entities_fts MATCH ?').all('"Town"').map(r => (r as { rowid: number }).rowid)).toContain(newId)
  })

  it('keeps one default per type; the default fills only empty fields', () => {
    const [tpl] = listTemplates(db, 'npc')
    const second = saveTemplate(db, guardId, 'Another')
    setDefaultTemplate(db, tpl!.id, true)
    setDefaultTemplate(db, second.id, true)
    expect(listTemplates(db, 'npc').map(t => [t.name, t.isDefault])).toEqual([['Another', true], ['Town guard', false]])

    const filled = fillFromDefault(db, 'NPC', '', { race: 'elf', class: '' } as Record<string, unknown>)
    expect(filled.description).toBe('Bored, armed.')
    expect(filled.metadata).toEqual({ race: 'elf', class: 'fighter' })

    // Stats and tags are added unless the new entry already has its own
    const npcType = (db.prepare('SELECT id FROM entity_types WHERE name = ?').get('NPC') as { id: number }).id
    const id = db.prepare('INSERT INTO entities (type_id, campaign_id, name) VALUES (?, ?, ?)').run(npcType, campaignA, 'New').lastInsertRowid
    applyDefaultExtras(db, filled.template, id)
    expect(db.prepare('SELECT COUNT(*) AS n FROM entity_stats WHERE entity_id = ?').get(id)).toEqual({ n: 1 })

    setDefaultTemplate(db, second.id, false)
    expect(fillFromDefault(db, 'NPC', null, null)).toEqual({ description: null, metadata: null, template: null })
  })

  it('answers the API paths and rejects bad requests', () => {
    expect(handleTemplateRequest(db, { method: 'GET', segments: ['list'], query: { type: 'item' }, body: null }, '/nonexistent')).toEqual([])
    expect(() => handleTemplateRequest(db, { method: 'GET', segments: ['list'], query: { type: 'player' }, body: null }, '/nonexistent')).toThrow(TemplateError)
    const [tpl] = listTemplates(db, 'npc')
    const created = handleTemplateRequest(db, { method: 'POST', segments: [String(tpl!.id), 'create'], query: {}, body: { campaignId: campaignA } }, '/nonexistent') as { id: number }
    expect(entity(created.id).campaign_id).toBe(campaignA)
    handleTemplateRequest(db, { method: 'DELETE', segments: [String(tpl!.id)], query: {}, body: null }, '/nonexistent')
    expect(() => createFromTemplate(db, tpl!.id, campaignA)).toThrow(/not found/)
    expect(() => createFromTemplate(db, listTemplates(db, 'npc')[0]!.id, 999999)).toThrow(/Campaign/)
    const copy = handleTemplateRequest(db, { method: 'POST', segments: ['duplicate', String(guardId)], query: {}, body: { name: 'Guard 2' } }, '/nonexistent') as { id: number }
    expect(entity(copy.id).name).toBe('Guard 2')
    expect(() => handleTemplateRequest(db, { method: 'POST', segments: ['duplicate', '999999'], query: {}, body: {} }, '/nonexistent')).toThrow(/not found/)
  })
})
