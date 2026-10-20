import { describe, it, expect, beforeAll } from 'vitest'
import type Database from 'better-sqlite3'
import { getTestDb } from '../utils/test-db'
import { getCodexEntry, searchCodex, seedCodex } from '../../server/utils/codex'
import {
  CodexUserError,
  applyCampaignEdits,
  handleCodexUserRequest,
  resetCampaignEdit,
  saveCampaignEdit,
  saveHomebrew,
} from '../../server/utils/codex-user'
import { addParticipants, listParticipants } from '../../server/utils/encounter-participants'

describe('codex homebrew and campaign edits', () => {
  let db: Database.Database
  let campaignA: number
  let campaignB: number

  beforeAll(() => {
    db = getTestDb()
    seedCodex(db)
    campaignA = Number(db.prepare('INSERT INTO campaigns (name) VALUES (?)').run('A').lastInsertRowid)
    campaignB = Number(db.prepare('INSERT INTO campaigns (name) VALUES (?)').run('B').lastInsertRowid)
  })

  it('creates, renames and deletes homebrew entries', () => {
    const entry = saveHomebrew(db, { kind: 'spell', name: 'Storm Lance', summary: '3rd-level evocation', body: 'Lightning, *a lot*.' })
    expect(entry).toMatchObject({ uid: 'spell:storm lance|hb', sourceCode: 'hb', sourceTitle: 'Homebrew', externalUrl: null })
    expect(searchCodex(db, 'storm lan').map(e => e.uid)).toContain('spell:storm lance|hb')
    expect(() => saveHomebrew(db, { kind: 'spell', name: 'storm lance' })).toThrow(/already exists/)

    // Rename keeps the uid, so tokens and links still resolve
    const renamed = saveHomebrew(db, { uid: entry.uid, name: 'Storm Spear', body: 'New text' })
    expect(renamed).toMatchObject({ uid: 'spell:storm lance|hb', name: 'Storm Spear', body: 'New text', summary: null })

    handleCodexUserRequest(db, { method: 'DELETE', segments: ['homebrew'], query: { uid: entry.uid }, body: null })
    expect(searchCodex(db, 'storm spear')).toEqual([])
    expect(getCodexEntry(db, entry.uid)?.deletedAt).toBeTruthy()
    // Homebrew can't touch bundled entries
    expect(() => saveHomebrew(db, { uid: 'spell:fireball|phb', name: 'Mine' })).toThrow(/not found/)
    expect(() => saveHomebrew(db, { kind: 'vehicle', name: 'Cart' })).toThrow(CodexUserError)
  })

  it('homebrew monsters carry HP and AC into fights', () => {
    const monster = saveHomebrew(db, { kind: 'monster', name: 'Bog Hag', body: '***Curse (Recharge 6).*** Bad luck.', hp: 45, ac: '14' })
    expect(monster.data).toEqual({ hp: 45, ac: 14 })
    expect(() => saveHomebrew(db, { kind: 'monster', name: 'Huge', ac: 99 })).toThrow(/range/)
    const fight = Number(db.prepare('INSERT INTO encounters (campaign_id, name) VALUES (?, ?)').run(campaignA, 'Swamp').lastInsertRowid)
    addParticipants(db, fight, [{ refUid: monster.uid }])
    const [hag] = listParticipants(db, fight) as Array<Record<string, unknown> & { resources: unknown[] }>
    expect(hag).toMatchObject({ display_name: 'Bog Hag', max_hp: 45, armor_class: 14 })
    expect(hag!.resources).toHaveLength(1)
  })

  it('campaign edits change an entry for one campaign only and reset cleanly', () => {
    const uid = 'monster:goblin|mm'
    const original = getCodexEntry(db, uid)!
    const edited = saveCampaignEdit(db, campaignA, uid, { name: 'Cave Goblin', summary: original.summary, body: original.body, hp: 12, ac: original.data!.ac })
    expect(edited).toMatchObject({ name: 'Cave Goblin', summary: original.summary, editedInCampaign: true })
    expect(edited.data).toMatchObject({ hp: 12, ac: original.data!.ac })
    // Only changed fields are stored
    expect(db.prepare('SELECT name, summary, body_md, data_json FROM ref_overrides WHERE ref_uid = ?').get(uid))
      .toEqual({ name: 'Cave Goblin', summary: null, body_md: null, data_json: '{"hp":12}' })

    expect(applyCampaignEdits(db, getCodexEntry(db, uid)!, campaignB).name).toBe('Goblin')
    expect(getCodexEntry(db, uid)!.name).toBe('Goblin')

    // Fights in that campaign use the edited numbers
    const fight = Number(db.prepare('INSERT INTO encounters (campaign_id, name) VALUES (?, ?)').run(campaignA, 'Cave').lastInsertRowid)
    addParticipants(db, fight, [{ refUid: uid }])
    expect(listParticipants(db, fight)[0]).toMatchObject({ display_name: 'Cave Goblin', max_hp: 12 })

    // Saving the original values again removes the edit
    saveCampaignEdit(db, campaignA, uid, { name: 'Goblin', summary: original.summary, body: original.body, hp: original.data!.hp })
    expect(db.prepare('SELECT COUNT(*) AS n FROM ref_overrides').get()).toEqual({ n: 0 })

    // Fields left out keep the original text
    expect(saveCampaignEdit(db, campaignA, uid, { name: 'Cave Goblin' })).toMatchObject({ summary: original.summary, body: original.body })
    expect(resetCampaignEdit(db, campaignA, uid).name).toBe('Goblin')
    expect(applyCampaignEdits(db, getCodexEntry(db, uid)!, campaignA).editedInCampaign).toBeUndefined()
  })

  it('rejects edits of bookmarks, homebrew, unknown entries and campaigns', () => {
    const bookmark = handleCodexUserRequest(db, {
      method: 'POST',
      segments: ['bookmarks'],
      query: {},
      body: { kind: 'spell', name: 'Toll the Dead', book: 'xge', url: 'https://2014.5e.tools/spells.html#toll%20the%20dead_xge' },
    }) as { uid: string }
    expect(() => saveCampaignEdit(db, campaignA, bookmark.uid, { name: 'X' })).toThrow(/directly/)
    expect(() => saveCampaignEdit(db, campaignA, 'spell:storm lance|hb', { name: 'X' })).toThrow(/not found/)
    expect(() => saveCampaignEdit(db, 999999, 'spell:fireball|phb', { name: 'X' })).toThrow(/Campaign/)
    expect(() => saveCampaignEdit(db, campaignA, 'spell:fireball|phb', { name: ' ' })).toThrow(/Name/)
    expect(() => handleCodexUserRequest(db, { method: 'GET', segments: ['homebrew'], query: {}, body: null })).toThrow(/Not found/)
  })
})
