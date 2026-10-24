import { describe, it, expect, beforeEach } from 'vitest'
import type Database from 'better-sqlite3'
import { playerSheet } from '@dmcc/character-core'
import { openDb } from '../server/utils/db'
import { RouteError, handleCampaigns, handleCharacters } from '../server/utils/characters'

let db: Database.Database
const call = (method: string, path: string, body: Record<string, unknown> | null = null) =>
  handleCharacters(db, { method, segments: path.split('/').filter(Boolean), body })
const campaigns = (method: string, path: string, body: Record<string, unknown> | null = null) =>
  handleCampaigns(db, { method, segments: path.split('/').filter(Boolean), body })

beforeEach(() => {
  db = openDb(':memory:')
})

describe('characters', () => {
  it('creates, lists and makes the first character active', () => {
    const created = call('POST', '', { values: { name: 'Kara', classLabel: 'Monk', level: 7, hpMax: 52, hpCurrent: 52 } }) as { id: number }
    const list = call('GET', '') as { characters: { id: number }[], activeId: number }
    expect(list.characters).toHaveLength(1)
    expect(list.activeId).toBe(created.id)
    expect(list.characters[0]!.id).toBe(created.id)
  })

  it('stores edits in the player layer and clears them with null', () => {
    const { id } = call('POST', '', { values: { name: 'Kara', ac: 15 } }) as { id: number }
    const edited = call('PATCH', String(id), { values: { ac: 17 } }) as { values: { ac?: { local?: number } } }
    expect(edited.values.ac?.local).toBe(17)
    const cleared = call('PATCH', String(id), { values: { ac: null } }) as Parameters<typeof playerSheet>[0]
    expect(playerSheet(cleared).ac).toBe(10)
  })

  it('rejects a missing name and wrong types', () => {
    expect(() => call('POST', '', { values: { name: '  ' } })).toThrow(RouteError)
    expect(() => call('POST', '', { values: { name: 'Kara', ac: 'high' } })).toThrow(/ac/)
  })

  it('switches and repairs the active character on delete', () => {
    const a = call('POST', '', { values: { name: 'A' } }) as { id: number }
    const b = call('POST', '', { values: { name: 'B' } }) as { id: number }
    call('PUT', 'active', { id: b.id })
    expect((call('GET', '') as { activeId: number }).activeId).toBe(b.id)
    call('DELETE', String(b.id))
    expect((call('GET', '') as { activeId: number }).activeId).toBe(a.id)
    call('DELETE', String(a.id))
    expect((call('GET', '') as { activeId: number | null }).activeId).toBeNull()
  })

  it('links a campaign and unlinks it when the campaign is deleted', () => {
    const camp = campaigns('POST', '', { name: 'Curse of the Crimson Moon', dmName: 'Raul' }) as { id: number }
    const { id } = call('POST', '', { values: { name: 'Kara' }, campaignId: camp.id }) as { id: number }
    expect((call('GET', String(id)) as { campaignId: number }).campaignId).toBe(camp.id)
    expect(() => call('PATCH', String(id), { campaignId: 999 })).toThrow(/campaign/)
    campaigns('DELETE', String(camp.id))
    expect((call('GET', String(id)) as { campaignId: number | null }).campaignId).toBeNull()
  })

  it('answers unknown paths with 404', () => {
    expect(() => call('GET', '5')).toThrow(/not found/i)
    expect(() => call('GET', 'a/b')).toThrow(/not found/i)
  })
})
