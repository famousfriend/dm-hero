import { describe, it, expect, beforeEach } from 'vitest'
import type Database from 'better-sqlite3'
import { openDb } from '../server/utils/db'
import { handleCharacters } from '../server/utils/characters'
import { addDmEntry, handleJournal } from '../server/utils/journal'

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
    const id = addDmEntry(db, 'npcs', characterId, { name: 'Captain Vex', description: 'Smuggler' })
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
