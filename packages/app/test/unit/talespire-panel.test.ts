import { describe, it, expect, beforeEach } from 'vitest'
import type Database from 'better-sqlite3'
import { getTestDb } from '../utils/test-db'
import { seedCodex } from '../../server/utils/codex'
import { addParticipants } from '../../server/utils/encounter-participants'
import { applyCombatAction, listCombatLog, undoLastCombatAction } from '../../server/utils/encounter-actions'
import { getTaleSpireKey, getTaleSpireState, isTaleSpireKey, logTaleSpireRoll } from '../../server/utils/talespire'

// The panel inside TaleSpire: its key, the running fight, and rolls in the action log
let db: Database.Database
let encounterId: number

beforeEach(() => {
  db = getTestDb()
  seedCodex(db)
  const campaignId = Number(db.prepare('INSERT INTO campaigns (name) VALUES (?)').run('Lost Mine').lastInsertRowid)
  encounterId = Number(db.prepare('INSERT INTO encounters (campaign_id, name, status, round) VALUES (?, ?, ?, ?)')
    .run(campaignId, 'Ambush', 'active', 2).lastInsertRowid)
  addParticipants(db, encounterId, [{ refUid: 'monster:goblin|mm', count: 2 }])
})

describe('TaleSpire panel', () => {
  it('keeps one key and checks it', () => {
    const key = getTaleSpireKey(db)
    expect(key).toMatch(/^[a-f0-9]{48}$/)
    expect(getTaleSpireKey(db)).toBe(key)
    expect(isTaleSpireKey(db, key)).toBe(true)
    expect(isTaleSpireKey(db, 'nope')).toBe(false)
    expect(isTaleSpireKey(db, undefined)).toBe(false)
  })

  it('shows the running fight with monster attacks', () => {
    const { encounter } = getTaleSpireState(db)
    expect(encounter).toMatchObject({ id: encounterId, name: 'Ambush', round: 2, campaign: 'Lost Mine' })
    expect(encounter!.participants.map(p => p.name)).toEqual(['Goblin', 'Goblin (2)'])
    expect(encounter!.participants[0]).toMatchObject({ kind: 'monster', hp: 7, maxHp: 7, ac: 15 })
    expect(encounter!.participants[0]!.actions[0]).toEqual({ name: 'Scimitar', toHit: 4, damageDice: '1d6 + 2', save: null })
  })

  it('has nothing when no fight is running', () => {
    db.prepare('UPDATE encounters SET status = ? WHERE id = ?').run('finished', encounterId)
    expect(getTaleSpireState(db)).toEqual({ encounter: null })
  })

  it('logs rolls without making them undoable', () => {
    const [goblin] = getTaleSpireState(db).encounter!.participants
    applyCombatAction(db, encounterId, goblin!.id, { type: 'damage', amount: 3 })
    logTaleSpireRoll(db, { encounterId, participantId: goblin!.id, label: 'Scimitar', total: 17, detail: '17 to hit · 5 damage' })
    const [roll] = listCombatLog(db, encounterId)
    expect(roll).toMatchObject({ kind: 'roll', participantName: 'Goblin', round: 2, amount: 17, details: { label: 'Scimitar', detail: '17 to hit · 5 damage' } })
    // Undo skips the roll and takes back the damage
    expect(undoLastCombatAction(db, encounterId)).toBe(true)
    expect(getTaleSpireState(db).encounter!.participants[0]!.hp).toBe(7)
    expect(undoLastCombatAction(db, encounterId)).toBe(false)
  })

  it('refuses rolls without what it needs', () => {
    expect(() => logTaleSpireRoll(db, { encounterId, label: '', total: 3 })).toThrow()
    expect(() => logTaleSpireRoll(db, { encounterId: 999, label: 'X', total: 3 })).toThrow()
  })
})
