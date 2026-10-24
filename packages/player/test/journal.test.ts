import { describe, it, expect, beforeEach } from 'vitest'
import type Database from 'better-sqlite3'
import { openDb } from '../server/utils/db'
import { handleCampaigns, handleCharacters } from '../server/utils/characters'
import { handleJournal } from '../server/utils/journal'

const pack = (extra: Record<string, unknown> = {}) => ({
  format: 'dmcc-player-pack',
  version: 1,
  exportedAt: '2026-10-24T12:00:00Z',
  campaign: { ref: 'x:campaign:1', name: 'Curse of Strahd', dmName: 'Raul' },
  forCharacter: null,
  places: [],
  npcs: [],
  quests: [],
  ...extra,
})

let db: Database.Database
let characterId: number
const call = (method: string, path: string, body: Record<string, unknown> | null = null, query: Record<string, unknown> = {}) =>
  handleJournal(db, { method, segments: path.split('/').filter(Boolean), body, query })
const journal = () => call('GET', '', null, { characterId }) as { notes: { id: number, visibility: string, title: string }[], places: { id: number, name: string }[], npcs: { id: number, name: string, placeId: number | null, source: string, playerNotes: string }[] }

beforeEach(() => {
  db = openDb(':memory:')
  characterId = (handleCharacters(db, { method: 'POST', segments: [], body: { values: { name: 'Kara' } } }) as { id: number }).id
})

describe('notes', () => {
  it('are private by default and can be shared with the party', () => {
    const note = call('POST', 'notes', { characterId, title: 'The red door', body: 'Opens at moonrise' }) as { id: number, visibility: string }
    expect(note.visibility).toBe('private')
    const shared = call('PATCH', `notes/${note.id}`, { visibility: 'party' }) as { visibility: string }
    expect(shared.visibility).toBe('party')
    expect(() => call('PATCH', `notes/${note.id}`, { visibility: 'everyone' })).toThrow(/visibility/)
  })

  it('need a title or text, and go away with their character', () => {
    expect(() => call('POST', 'notes', { characterId, title: ' ', body: '' })).toThrow(/title or text/)
    call('POST', 'notes', { characterId, body: 'Just text' })
    expect(journal().notes).toHaveLength(1)
    handleCharacters(db, { method: 'DELETE', segments: [String(characterId)], body: null })
    expect(db.prepare('SELECT COUNT(*) AS n FROM notes').get()).toEqual({ n: 0 })
  })
})

describe('places and NPCs', () => {
  it('records where an NPC was met; deleting the place keeps the NPC', () => {
    const place = call('POST', 'places', { characterId, name: 'Saltmarsh' }) as { id: number }
    const npc = call('POST', 'npcs', { characterId, name: 'Eliander', placeId: place.id }) as { id: number, placeId: number, source: string }
    expect(npc.placeId).toBe(place.id)
    expect(npc.source).toBe('player')
    call('DELETE', `places/${place.id}`)
    expect(journal().npcs[0]!.placeId).toBeNull()
  })

  it('rejects a place of another character', () => {
    const other = (handleCharacters(db, { method: 'POST', segments: [], body: { values: { name: 'Ash' } } }) as { id: number }).id
    const place = call('POST', 'places', { characterId: other, name: 'Elsewhere' }) as { id: number }
    expect(() => call('POST', 'npcs', { characterId, name: 'X', placeId: place.id })).toThrow(/place/)
  })

  it('keeps DM entries locked except for the player\'s own notes', () => {
    call('POST', 'import-pack', { characterId, apply: true, pack: pack({ npcs: [{ ref: 'x:npc:1', name: 'Captain Vex', description: 'Smuggler' }] }) })
    const id = journal().npcs[0]!.id
    expect(() => call('PATCH', `npcs/${id}`, { name: 'Vex the Liar' })).toThrow(/DM/)
    call('PATCH', `npcs/${id}`, { playerNotes: 'Owes us 50 gp' })
    const npc = journal().npcs[0]!
    expect(npc.name).toBe('Captain Vex')
    expect(npc.source).toBe('dm')
    expect(npc.playerNotes).toBe('Owes us 50 gp')
  })

  it('never lets the API create a DM entry', () => {
    const npc = call('POST', 'npcs', { characterId, name: 'Fake', source: 'dm' }) as { source: string }
    expect(npc.source).toBe('player')
  })
})

describe('player pack import', () => {
  const first = () => pack({
    places: [{ ref: 'x:place:5', name: 'Vallaki', description: 'Walled town' }],
    npcs: [{ ref: 'x:npc:9', name: 'Ismark', description: '', placeRef: 'x:place:5' }],
    quests: [{ ref: 'x:quest:2', name: 'Escort Ireena', description: 'Keep her safe', status: 'active', reward: '' }],
  })
  const importPack = (data: unknown, apply = true) => call('POST', 'import-pack', { characterId, apply, pack: data }) as {
    applied: boolean
    campaign: { name: string, isNew: boolean }
    changesCampaign: boolean
    counts: Record<string, { added: number, updated: number, unchanged: number }>
  }

  it('previews without writing anything', () => {
    const preview = importPack(first(), false)
    expect(preview.applied).toBe(false)
    expect(preview.campaign).toMatchObject({ name: 'Curse of Strahd', isNew: true })
    expect(preview.counts.npcs).toEqual({ added: 1, updated: 0, unchanged: 0 })
    expect(journal().npcs).toHaveLength(0)
    expect(db.prepare('SELECT COUNT(*) AS n FROM campaigns').get()).toEqual({ n: 0 })
  })

  it('fills the journal, links the campaign, and updates on re-import instead of duplicating', () => {
    importPack(first())
    const j = journal() as ReturnType<typeof journal> & { quests: { name: string, status: string, playerNotes: string, id: number }[] }
    expect(j.places[0]!.name).toBe('Vallaki')
    expect(j.npcs[0]).toMatchObject({ name: 'Ismark', source: 'dm', placeId: j.places[0]!.id })
    expect(j.quests[0]).toMatchObject({ name: 'Escort Ireena', status: 'active' })
    const character = db.prepare('SELECT campaign_id FROM characters WHERE id = ?').get(characterId) as { campaign_id: number }
    expect(db.prepare('SELECT name, dm_name FROM campaigns WHERE id = ?').get(character.campaign_id)).toEqual({ name: 'Curse of Strahd', dm_name: 'Raul' })

    call('PATCH', `quests/${j.quests[0]!.id}`, { playerNotes: 'She trusts us' })
    expect(() => call('PATCH', `quests/${j.quests[0]!.id}`, { status: 'done' })).toThrow(/DM/)

    // Next session: the quest is done, the place lost its description in the pack, a new NPC
    const second = first()
    second.quests[0]!.status = 'done'
    second.places[0]!.description = ''
    second.npcs.push({ ref: 'x:npc:10', name: 'Rictavio', description: '', placeRef: null })
    const result = importPack(second)
    expect(result.counts.quests).toEqual({ added: 0, updated: 1, unchanged: 0 })
    expect(result.counts.places).toEqual({ added: 0, updated: 0, unchanged: 1 })
    expect(result.counts.npcs).toEqual({ added: 1, updated: 0, unchanged: 1 })
    const after = journal() as typeof j
    expect(after.npcs).toHaveLength(2)
    expect(after.places[0]!.description).toBe('Walled town')
    expect(after.quests[0]).toMatchObject({ status: 'done', playerNotes: 'She trusts us' })
    expect(db.prepare('SELECT COUNT(*) AS n FROM campaigns').get()).toEqual({ n: 1 })
  })

  it('reuses the campaign the player typed in, and keeps the player\'s own place for an NPC', () => {
    const own = handleCampaigns(db, { method: 'POST', segments: [], body: { name: 'Strahd (mine)' } }) as { id: number }
    handleCharacters(db, { method: 'PATCH', segments: [String(characterId)], body: { campaignId: own.id } })
    const preview = importPack(first(), false)
    expect(preview.campaign).toMatchObject({ name: 'Strahd (mine)', isNew: false })
    expect(preview.changesCampaign).toBe(false)
    importPack(first())
    expect(db.prepare('SELECT COUNT(*) AS n FROM campaigns').get()).toEqual({ n: 1 })
  })

  it('rejects files that are not player packs', () => {
    expect(() => importPack({ hello: 'world' })).toThrow(/not a player pack/)
    expect(() => importPack({ ...first(), version: 99 })).toThrow(/newer/)
  })
})
