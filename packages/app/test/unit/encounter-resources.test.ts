import { describe, it, expect, beforeAll } from 'vitest'
import type Database from 'better-sqlite3'
import { getTestDb } from '../utils/test-db'
import { addParticipants, getParticipant, listParticipants } from '../../server/utils/encounter-participants'
import { applyResourceOp, parseMonsterResources } from '../../server/utils/encounter-resources'
import { applyCombatAction } from '../../server/utils/encounter-actions'
import type { EncounterResource } from '../../types/encounter'

const DRAGON = `**Armor Class** 19

***Amphibious.*** The dragon can breathe air and water.

***Legendary Resistance (3/Day).*** If the dragon fails a saving throw, it can choose to succeed instead.

### Actions

***Bite.*** Melee Weapon Attack: +11 to hit.

***Acid Breath (Recharge 5-6).*** The dragon exhales acid.

***Change Shape (Recharges after a Short or Long Rest).*** It turns into a newt.

***Spit (Recharge 6).*** Ptui.

***Claw (Humanoid Form Only).*** Not limited.

### Legendary Actions

***Wing Attack (Costs 2 Actions).*** The dragon beats its wings.`

describe('reading limited-use abilities from a stat block', () => {
  it('finds X/Day, recharge, per-rest and legendary actions, and nothing else', () => {
    expect(parseMonsterResources(DRAGON)).toEqual([
      { name: 'Legendary Resistance', kind: 'uses', max_uses: 3 },
      { name: 'Acid Breath', kind: 'recharge', max_uses: 1, recharge_min: 5 },
      { name: 'Change Shape', kind: 'uses', max_uses: 1 },
      { name: 'Spit', kind: 'recharge', max_uses: 1, recharge_min: 6 },
      { name: 'Legendary Actions', kind: 'legendary', max_uses: 3 },
    ])
    expect(parseMonsterResources('***Bite.*** Ouch.')).toEqual([])
    expect(parseMonsterResources(null)).toEqual([])
  })
})

describe('abilities in a fight', () => {
  let db: Database.Database
  let encounterId: number
  const resourcesOf = (id: number) => (getParticipant(db, encounterId, id)!.resources as EncounterResource[])

  beforeAll(() => {
    db = getTestDb()
    const campaignId = Number(db.prepare('INSERT INTO campaigns (name) VALUES (?)').run('Lair').lastInsertRowid)
    encounterId = Number(db.prepare('INSERT INTO encounters (campaign_id, name) VALUES (?, ?)').run(campaignId, 'Lair').lastInsertRowid)
    const sourceId = Number(
      db.prepare('INSERT INTO ref_sources (code, title, license, origin) VALUES (\'test-res\', \'Test\', \'test\', \'user\')').run().lastInsertRowid,
    )
    db.prepare('INSERT INTO ref_entries (ref_uid, kind, name, source_id, data_json, body_md) VALUES (?, ?, ?, ?, ?, ?)')
      .run('monster:dragon|test', 'monster', 'Dragon', sourceId, JSON.stringify({ hp: 195, ac: 19 }), DRAGON)
  })

  it('gives every copy of a Codex monster its own abilities', () => {
    addParticipants(db, encounterId, [{ refUid: 'monster:dragon|test', count: 2 }])
    const [a, b] = listParticipants(db, encounterId)
    expect((a!.resources as EncounterResource[]).map(r => [r.name, r.used])).toHaveLength(5)
    expect((a!.resources as EncounterResource[])[0]!.id).not.toBe((b!.resources as EncounterResource[])[0]!.id)
  })

  it('uses, restores, adds and removes abilities', () => {
    const id = listParticipants(db, encounterId)[0]!.id as number
    const breath = resourcesOf(id).find(r => r.name === 'Acid Breath')!
    applyResourceOp(db, id, { op: 'set', id: breath.id, used: 5 })
    expect(resourcesOf(id).find(r => r.id === breath.id)!.used).toBe(1) // capped at max

    applyResourceOp(db, id, { op: 'add', name: 'Fire Bolt', kind: 'uses', max_uses: 2 })
    expect(resourcesOf(id).at(-1)).toMatchObject({ name: 'Fire Bolt', kind: 'uses', max_uses: 2, used: 0 })

    applyResourceOp(db, id, { op: 'remove', id: breath.id })
    expect(resourcesOf(id).some(r => r.id === breath.id)).toBe(false)

    expect(() => applyResourceOp(db, id, { op: 'add', name: ' ', kind: 'uses' })).toThrow(/Name/)
    expect(() => applyResourceOp(db, id, { op: 'add', name: 'X', kind: 'recharge', recharge_min: 9 })).toThrow(/Recharge/)
    const other = listParticipants(db, encounterId)[1]!.id as number
    expect(() => applyResourceOp(db, other, { op: 'remove', id: resourcesOf(id)[0]!.id })).toThrow(/not found/)
  })

  it('keeps effects and abilities on the participant after damage', () => {
    const id = listParticipants(db, encounterId)[0]!.id as number
    db.prepare('INSERT INTO encounter_effects (participant_id, name, duration_type) VALUES (?, ?, ?)').run(id, 'Frightened', 'infinite')
    const after = applyCombatAction(db, encounterId, id, { type: 'damage', amount: 10 })!
    expect((after.effects as Array<{ name: string }>).map(e => e.name)).toEqual(['Frightened'])
    expect((after.resources as EncounterResource[]).length).toBeGreaterThan(0)
  })
})
