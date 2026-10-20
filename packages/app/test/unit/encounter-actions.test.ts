import { describe, it, expect, beforeAll } from 'vitest'
import type Database from 'better-sqlite3'
import { getTestDb } from '../utils/test-db'
import { addParticipants, listParticipants } from '../../server/utils/encounter-participants'
import { applyCombatAction, listCombatLog, resolveAction, undoLastCombatAction } from '../../server/utils/encounter-actions'
import type { CombatAction } from '../../types/encounter'

type Row = Parameters<typeof resolveAction>[0]
const row = (over: Partial<Row> = {}): Row => ({
  id: 1,
  encounter_id: 1,
  display_name: 'Bo',
  duplicate_index: 0,
  entity_type: 'Player',
  current_hp: 10,
  max_hp: 20,
  temp_hp: 0,
  armor_class: 15,
  is_ko: false,
  death_save_successes: 0,
  death_save_failures: 0,
  ...over,
})
const act = (r: Row, a: CombatAction) => resolveAction(r, a)

describe('combat rules (5e 2014)', () => {
  it('damage uses temp HP first and knocks out at 0', () => {
    expect(act(row({ temp_hp: 4 }), { type: 'damage', amount: 6 })).toEqual({
      after: expect.objectContaining({ current_hp: 8, temp_hp: 0, is_ko: false }),
      details: { absorbed: 4 },
    })
    const down = act(row(), { type: 'damage', amount: 12 })
    expect(down.after).toMatchObject({ current_hp: 0, is_ko: true, death_save_failures: 0 })
    expect(down.details).toEqual({ down: true })
  })

  it('massive damage kills a player outright', () => {
    // 10 HP left, max 20: 30 damage leaves 20 over = max HP
    const result = act(row(), { type: 'damage', amount: 30 })
    expect(result.after).toMatchObject({ current_hp: 0, death_save_failures: 3 })
    expect(result.details).toMatchObject({ massive: true, dead: true })
    expect(act(row(), { type: 'damage', amount: 29 }).details).toEqual({ down: true })
  })

  it('damage while down is a failed death save; monsters make none', () => {
    const downed = row({ current_hp: 0, is_ko: true, death_save_failures: 1 })
    expect(act(downed, { type: 'damage', amount: 3 }).after.death_save_failures).toBe(2)
    expect(act(downed, { type: 'damage', amount: 25 }).after.death_save_failures).toBe(3)
    const goblin = row({ entity_type: 'Monster', current_hp: 3, max_hp: 7 })
    expect(act(goblin, { type: 'damage', amount: 50 }).after).toMatchObject({ current_hp: 0, is_ko: true, death_save_failures: 0 })
  })

  it('healing caps at max and brings a downed character back', () => {
    expect(act(row(), { type: 'heal', amount: 50 }).after.current_hp).toBe(20)
    const back = act(row({ current_hp: 0, is_ko: true, death_save_successes: 2, death_save_failures: 2 }), { type: 'heal', amount: 4 })
    expect(back.after).toMatchObject({ current_hp: 4, is_ko: false, death_save_successes: 0, death_save_failures: 0 })
    expect(back.details).toEqual({ revived: true })
    expect(() => act(row({ current_hp: 0, is_ko: true, death_save_failures: 3 }), { type: 'heal', amount: 4 })).toThrow(/Dead/)
  })

  it('temporary HP keep the higher value', () => {
    expect(act(row({ temp_hp: 5 }), { type: 'tempHp', amount: 3 })).toEqual({
      after: expect.objectContaining({ temp_hp: 5 }),
      details: { kept: 5 },
    })
    expect(act(row({ temp_hp: 5 }), { type: 'tempHp', amount: 8 }).after.temp_hp).toBe(8)
  })

  it('death saves: stable at 3 successes, dead at 3 failures, nat 20 and nat 1', () => {
    const down = row({ current_hp: 0, is_ko: true })
    expect(act({ ...down, death_save_successes: 2 }, { type: 'deathSave', result: 'success' }).details).toMatchObject({ stable: true })
    expect(act({ ...down, death_save_failures: 1 }, { type: 'deathSave', result: 'critFail' }).after.death_save_failures).toBe(3)
    expect(act(down, { type: 'deathSave', result: 'crit' }).after).toMatchObject({ current_hp: 1, is_ko: false })
    expect(() => act(row(), { type: 'deathSave', result: 'success' })).toThrow(/downed/)
    expect(() => act({ ...down, death_save_failures: 3 }, { type: 'deathSave', result: 'success' })).toThrow(/dead/)
    expect(() => act(row(), { type: 'damage', amount: -3 })).toThrow(/positive/)
  })
})

describe('action log and undo', () => {
  let db: Database.Database
  let encounterId: number
  let boId: number

  beforeAll(() => {
    db = getTestDb()
    const campaignId = Number(db.prepare('INSERT INTO campaigns (name) VALUES (?)').run('Log').lastInsertRowid)
    const playerType = (db.prepare('SELECT id FROM entity_types WHERE name = ?').get('Player') as { id: number }).id
    const bo = Number(db.prepare('INSERT INTO entities (type_id, campaign_id, name) VALUES (?, ?, ?)').run(playerType, campaignId, 'Bo').lastInsertRowid)
    encounterId = Number(db.prepare('INSERT INTO encounters (campaign_id, name, round) VALUES (?, ?, 2)').run(campaignId, 'Fight').lastInsertRowid)
    addParticipants(db, encounterId, [{ entityId: bo, currentHp: 10, maxHp: 20, armorClass: 15 }])
    boId = listParticipants(db, encounterId)[0]!.id as number
  })

  it('logs each change with round and reasons, newest first; no-ops are not logged', () => {
    applyCombatAction(db, encounterId, boId, { type: 'tempHp', amount: 3 })
    applyCombatAction(db, encounterId, boId, { type: 'damage', amount: 15 })
    applyCombatAction(db, encounterId, boId, { type: 'deathSave', result: 'failure' })
    applyCombatAction(db, encounterId, boId, { type: 'set', fields: { armor_class: 15 } }) // unchanged
    const log = listCombatLog(db, encounterId)
    expect(log.map(e => [e.kind, e.amount, e.round, e.participantName])).toEqual([
      ['deathSave', null, 2, 'Bo'],
      ['damage', 15, 2, 'Bo'],
      ['tempHp', 3, 2, 'Bo'],
    ])
    expect(log[1]!.details).toEqual({ absorbed: 3, down: true })
    expect(log[1]!.after).toMatchObject({ current_hp: 0, temp_hp: 0, is_ko: true })
  })

  it('undo restores the earlier state step by step', () => {
    const state = () => listParticipants(db, encounterId)[0]!
    expect(state()).toMatchObject({ current_hp: 0, death_save_failures: 1 })
    expect(undoLastCombatAction(db, encounterId)).toBe(true)
    expect(state()).toMatchObject({ current_hp: 0, death_save_failures: 0, is_ko: 1 })
    expect(undoLastCombatAction(db, encounterId)).toBe(true)
    expect(state()).toMatchObject({ current_hp: 10, temp_hp: 3, is_ko: 0 })
    expect(listCombatLog(db, encounterId).map(e => e.undone)).toEqual([true, true, false])
    expect(undoLastCombatAction(db, encounterId)).toBe(true)
    expect(undoLastCombatAction(db, encounterId)).toBe(false)
    expect(state()).toMatchObject({ current_hp: 10, temp_hp: 0 })
  })
})
