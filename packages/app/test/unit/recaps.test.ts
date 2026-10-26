import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type Database from 'better-sqlite3'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getTestDb } from '../utils/test-db'
import { RecapInputError, addRecapFile, deleteRecapFile, getRecap, listRecaps, updateRecap } from '../../server/utils/recaps'
import { QuestRouteError, handleQuestRequest } from '../../server/utils/quest-route'

describe('session recaps', () => {
  let db: Database.Database
  let uploadDir: string
  let campaignId: number
  const ids: Record<string, number> = {}

  beforeAll(() => {
    db = getTestDb()
    uploadDir = mkdtempSync(join(tmpdir(), 'recaps-'))
    campaignId = Number(db.prepare('INSERT INTO campaigns (name) VALUES (?)').run('Recap test').lastInsertRowid)
    const session = (n: number, title: string) =>
      Number(db.prepare('INSERT INTO sessions (campaign_id, title, session_number) VALUES (?, ?, ?)').run(campaignId, title, n).lastInsertRowid)
    ids.s1 = session(1, 'Goblin Arrows')
    ids.s2 = session(2, 'Cragmaw')
  })

  afterAll(() => rmSync(uploadDir, { recursive: true, force: true }))

  it('lists every session newest first, without recaps at the start', () => {
    const list = listRecaps(db, campaignId)
    expect(list.map(r => r.title)).toEqual(['Cragmaw', 'Goblin Arrows'])
    expect(list.every(r => r.recap === null && r.files.length === 0)).toBe(true)
  })

  it('saves and clears a recap', () => {
    expect(updateRecap(db, ids.s1!, 'The party met {{npc:1}}.').recap).toBe('The party met {{npc:1}}.')
    expect(updateRecap(db, ids.s1!, '   ').recap).toBeNull()
    expect(() => updateRecap(db, 999999, 'x')).toThrow(RecapInputError)
  })

  it('stores an uploaded file under uploads/recaps and removes it again', () => {
    const file = addRecapFile(db, uploadDir, ids.s2!, { fileName: 'notes.pdf', data: Buffer.from('%PDF-1.4 test').toString('base64') })
    expect(file.fileName).toBe('notes.pdf')
    expect(file.storedName).toMatch(/^recaps\/[\w-]+\.pdf$/)
    expect(readFileSync(join(uploadDir, file.storedName), 'utf-8')).toBe('%PDF-1.4 test')
    expect(getRecap(db, ids.s2!).files.map(f => f.id)).toEqual([file.id])

    expect(deleteRecapFile(db, uploadDir, file.id)).toBe(true)
    expect(existsSync(join(uploadDir, file.storedName))).toBe(false)
    expect(getRecap(db, ids.s2!).files).toEqual([])
    expect(deleteRecapFile(db, uploadDir, file.id)).toBe(false)
  })

  it('refuses unsupported or empty files', () => {
    const data = Buffer.from('x').toString('base64')
    expect(() => addRecapFile(db, uploadDir, ids.s2!, { fileName: 'virus.exe', data })).toThrow('not supported')
    expect(() => addRecapFile(db, uploadDir, ids.s2!, { fileName: 'notes.pdf', data: '' })).toThrow('empty')
    // Path parts in the name never reach the disk
    const file = addRecapFile(db, uploadDir, ids.s2!, { fileName: '../../evil.png', data })
    expect(file.fileName).toBe('.._.._evil.png')
    expect(file.storedName.startsWith('recaps/')).toBe(true)
  })

  it('is reachable through the quests route', () => {
    const request = (method: string, segments: string[], body: Record<string, unknown> | null = null, query = {}) =>
      handleQuestRequest(db, { method, segments, query, body })
    request('PATCH', ['recaps', String(ids.s2)], { recap: 'Klarg is dead.' })
    const list = request('GET', ['recaps'], null, { campaignId }) as Array<{ sessionId: number, recap: string | null }>
    expect(list.find(r => r.sessionId === ids.s2)?.recap).toBe('Klarg is dead.')
    expect(() => request('GET', ['recaps', '999999'])).toThrow(QuestRouteError)
    expect(() => request('GET', ['recaps', 'files', '1', 'extra'])).toThrow(QuestRouteError)
  })
})
