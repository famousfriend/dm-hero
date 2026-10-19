import { describe, it, expect, beforeAll } from 'vitest'
import type Database from 'better-sqlite3'
import { getTestDb } from '../utils/test-db'
import {
  BookmarkError,
  addManualLink,
  deleteBookmark,
  getCodexEntry,
  getCodexUsages,
  getLinkOwnerCampaign,
  listManualLinks,
  removeManualLink,
  saveBookmark,
  searchCodex,
  seedCodex,
  syncRefLinks,
} from '../../server/utils/codex'
import { codexToken } from '../../types/codex'

describe('codex linked references and bookmarks', () => {
  let db: Database.Database
  let campaignId: number
  let npcId: number
  let locationId: number
  let encounterId: number

  beforeAll(() => {
    db = getTestDb()
    seedCodex(db)
    campaignId = Number(db.prepare('INSERT INTO campaigns (name) VALUES (?)').run('Links').lastInsertRowid)
    const typeId = (name: string) => (db.prepare('SELECT id FROM entity_types WHERE name = ?').get(name) as { id: number }).id
    const entity = (type: string, name: string) =>
      Number(
        db.prepare('INSERT INTO entities (type_id, campaign_id, name) VALUES (?, ?, ?)').run(typeId(type), campaignId, name)
          .lastInsertRowid,
      )
    npcId = entity('NPC', 'Klarg')
    locationId = entity('Location', 'Cragmaw Hideout')
    encounterId = Number(
      db.prepare('INSERT INTO encounters (campaign_id, name) VALUES (?, ?)').run(campaignId, 'Goblin ambush').lastInsertRowid,
    )
  })

  it('finds the campaign of an owner', () => {
    expect(getLinkOwnerCampaign(db, 'entity', npcId)).toBe(campaignId)
    expect(getLinkOwnerCampaign(db, 'encounter', encounterId)).toBe(campaignId)
    expect(getLinkOwnerCampaign(db, 'entity', 999999)).toBeNull()
  })

  it('adds, lists and removes manual links without duplicates', () => {
    addManualLink(db, campaignId, 'entity', npcId, 'monster:bugbear|mm')
    addManualLink(db, campaignId, 'entity', npcId, 'condition:frightened|phb')
    addManualLink(db, campaignId, 'entity', npcId, 'monster:bugbear|mm')
    expect(listManualLinks(db, 'entity', npcId)).toEqual([
      expect.objectContaining({ uid: 'monster:bugbear|mm', name: 'Bugbear', kind: 'monster', available: true }),
      expect.objectContaining({ uid: 'condition:frightened|phb', name: 'Frightened', available: true }),
    ])
    removeManualLink(db, 'entity', npcId, 'condition:frightened|phb')
    expect(listManualLinks(db, 'entity', npcId).map(l => l.uid)).toEqual(['monster:bugbear|mm'])
  })

  it('keeps manual links apart from note tokens of the same owner', () => {
    addManualLink(db, campaignId, 'encounter', encounterId, 'monster:goblin|mm')
    // A token sync for another owner type must not touch manual links
    syncRefLinks(db, campaignId, 'session', encounterId, '')
    expect(listManualLinks(db, 'encounter', encounterId).map(l => l.uid)).toEqual(['monster:goblin|mm'])
  })

  it('shows unknown uids with a name from the slug', () => {
    addManualLink(db, campaignId, 'entity', locationId, 'spell:toll the dead|xge')
    expect(listManualLinks(db, 'entity', locationId)).toEqual([
      expect.objectContaining({ name: 'Toll The Dead', kind: 'spell', sourceCode: 'xge', available: false }),
    ])
  })

  it('lists NPCs, locations and encounters under "used in"', () => {
    addManualLink(db, campaignId, 'entity', locationId, 'monster:goblin|mm')
    const sessionId = Number(
      db.prepare('INSERT INTO sessions (campaign_id, title, session_number) VALUES (?, ?, ?)').run(campaignId, 'Arrival', 1)
        .lastInsertRowid,
    )
    syncRefLinks(db, campaignId, 'session', sessionId, codexToken('monster:goblin|mm'))
    expect(getCodexUsages(db, campaignId, 'monster:goblin|mm')).toEqual([
      { ownerType: 'entity', ownerId: locationId, title: 'Cragmaw Hideout', entityId: locationId, entityType: 'location' },
      { ownerType: 'encounter', ownerId: encounterId, title: 'Goblin ambush' },
      { ownerType: 'session', ownerId: sessionId, title: 'Arrival' },
    ])

    // Deleted owners drop out
    db.prepare('UPDATE encounters SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?').run(encounterId)
    expect(getCodexUsages(db, campaignId, 'monster:goblin|mm').map(u => u.ownerType)).toEqual(['entity', 'session'])
  })

  it('saves a link-only bookmark that is searchable and resolves', () => {
    const saved = saveBookmark(db, {
      kind: 'spell',
      name: 'Toll the Dead',
      book: 'XGE',
      url: 'https://2014.5e.tools/spells.html#toll%20the%20dead_xge',
    })
    expect(saved).toEqual({ uid: 'spell:toll the dead|xge', kind: 'spell', name: 'Toll the Dead', summary: null, sourceCode: 'bookmark' })
    expect(searchCodex(db, 'toll')[0]?.uid).toBe('spell:toll the dead|xge')

    const entry = getCodexEntry(db, saved.uid)
    expect(entry).toMatchObject({ body: null, externalUrl: 'https://2014.5e.tools/spells.html#toll%20the%20dead_xge', deletedAt: null })
    // The earlier link to this uid now shows the real entry
    expect(listManualLinks(db, 'entity', locationId)[0]).toMatchObject({ name: 'Toll the Dead', available: true })
  })

  it('never overwrites a bundled entry with a bookmark', () => {
    const result = saveBookmark(db, { kind: 'spell', name: 'Fireball', book: 'phb', url: 'https://example.com/x' })
    expect(result.sourceCode).toBe('srd51')
    expect(getCodexEntry(db, 'spell:fireball|phb')?.body).toContain('fire')
  })

  it.each([
    [{ kind: 'npc', name: 'X', book: 'xge', url: 'https://a.b' }],
    [{ kind: 'spell', name: '  ', book: 'xge', url: 'https://a.b' }],
    [{ kind: 'spell', name: 'X', book: 'x g e', url: 'https://a.b' }],
    [{ kind: 'spell', name: 'X', book: 'xge', url: 'javascript:alert(1)' }],
    [{ kind: 'spell', name: 'X', book: 'xge', url: 'not a link' }],
  ])('rejects invalid bookmark %j', (input) => {
    expect(() => saveBookmark(db, input)).toThrow(BookmarkError)
  })

  it('deletes only bookmarks, and links keep their name', () => {
    expect(deleteBookmark(db, 'spell:fireball|phb')).toBe(false)
    expect(deleteBookmark(db, 'spell:toll the dead|xge')).toBe(true)
    expect(searchCodex(db, 'toll the dead').map(r => r.uid)).not.toContain('spell:toll the dead|xge')
    expect(listManualLinks(db, 'entity', locationId).find(l => l.uid === 'spell:toll the dead|xge')).toMatchObject({
      name: 'Toll the Dead',
      available: false,
    })
  })
})
