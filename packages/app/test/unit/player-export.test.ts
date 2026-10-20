import { describe, it, expect, beforeEach } from 'vitest'
import type Database from 'better-sqlite3'
import { getTestDb } from '../utils/test-db'
import { seedCodex } from '../../server/utils/codex'
import { buildPlayerExport, listPlayerExportCandidates, renderPlayerMarkdown } from '../../server/utils/share/player-export'

// The offline player handout (M10): same field policies and aliases as the game table
let db: Database.Database
let campaignId: number
let npcId: number
let villainId: number

beforeEach(() => {
  db = getTestDb()
  seedCodex(db)
  campaignId = Number(db.prepare('INSERT INTO campaigns (name) VALUES (?)').run('Lost Mine').lastInsertRowid)
  const typeId = (name: string) => (db.prepare('SELECT id FROM entity_types WHERE name = ?').get(name) as { id: number }).id
  const add = (type: string, name: string, description: string | null, metadata: object = {}, campaign = campaignId) =>
    Number(db.prepare('INSERT INTO entities (type_id, name, description, metadata, campaign_id) VALUES (?, ?, ?, ?, ?)')
      .run(typeId(type), name, description, JSON.stringify(metadata), campaign).lastInsertRowid)

  villainId = add('NPC', 'Glasstaff', 'Secretly Iarno', { relationship: 'Betrays the party' })
  npcId = add('NPC', 'Sildar', `Knows {{npc:${villainId}}}. Casts {{codex:spell:fireball|phb}} <script>alert(1)</script> [web](https://example.com) [file](file:///c:/secret)`, { race: 'human', relationship: 'Owes the party' })
  add('Location', 'Phandalin', 'A town')
  add('NPC', 'Elsewhere', 'Other campaign', {}, Number(db.prepare('INSERT INTO campaigns (name) VALUES (?)').run('Other').lastInsertRowid))

  const tableId = Number(db.prepare('INSERT INTO game_tables (campaign_id, code) VALUES (?, ?)').run(campaignId, 'ABC123').lastInsertRowid)
  db.prepare('INSERT INTO game_table_shares (game_table_id, share_key, entity_type, entity_id, fields, display_name) VALUES (?, ?, ?, ?, ?, ?)')
    .run(tableId, 'k1', 'npc', villainId, '["description"]', 'The masked wizard')
})

describe('player handout', () => {
  it('lists the campaign\'s shareable entries with what the game table shares', () => {
    const list = listPlayerExportCandidates(db, campaignId)
    expect(list.map(c => c.name).sort()).toEqual(['Glasstaff', 'Phandalin', 'Sildar'])
    expect(list.find(c => c.id === villainId)).toMatchObject({ type: 'npc', alias: 'The masked wizard', shared: true })
    expect(list.find(c => c.id === npcId)).toMatchObject({ alias: null, shared: false })
  })

  it('builds one safe html file with aliases, rules names and no private fields', async () => {
    const html = await buildPlayerExport(db, campaignId, {
      locale: 'en',
      items: [{ type: 'npc', id: npcId }, { type: 'npc', id: villainId }],
      fields: { npc: ['description', 'race', 'relationship'] },
    })
    expect(html).toMatch(/^<!doctype html>/)
    expect(html).toContain('<title>Lost Mine</title>')
    expect(html).toContain('<h3>The masked wizard</h3>')
    expect(html).toContain('Knows The masked wizard.')
    expect(html).toContain('Casts Fireball')
    expect(html).toContain('<dd>Human</dd>')
    expect(html).not.toContain('Glasstaff')
    expect(html).not.toContain('Owes the party')
    expect(html).not.toContain('Betrays')
    expect(html).not.toContain('<script>')
    expect(html).toContain('href="https://example.com"')
    expect(html).not.toContain('file:///')
    expect(html).not.toContain('Phandalin')
  })

  it('only exports picked entries of this campaign', async () => {
    await expect(buildPlayerExport(db, campaignId, { items: [{ type: 'npc', id: 999 }] })).rejects.toThrow(/Pick at least one/)
    const elsewhere = (db.prepare('SELECT id FROM entities WHERE name = ?').get('Elsewhere') as { id: number }).id
    await expect(buildPlayerExport(db, campaignId, { items: [{ type: 'npc', id: elsewhere }] })).rejects.toThrow(/Pick at least one/)
  })

  it('uses the chosen title and language', async () => {
    const html = await buildPlayerExport(db, campaignId, {
      title: 'Handout <1>',
      locale: 'de',
      items: [{ type: 'npc', id: npcId }],
      fields: { npc: ['race'] },
    })
    expect(html).toContain('<title>Handout &lt;1&gt;</title>')
    expect(html).toContain('<html lang="de">')
    expect(html).toContain('<dt>Volk</dt><dd>Mensch</dd>')
  })

  it('renders markdown without raw html or unsafe links', () => {
    expect(renderPlayerMarkdown('**bold** <img src=x onerror=alert(1)> ![pic](uploads/a.png) [x](javascript:alert(1))'))
      .toBe('<p><strong>bold</strong> &lt;img src=x onerror=alert(1)&gt; pic x</p>\n')
  })
})
