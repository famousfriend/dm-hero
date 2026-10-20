import type Database from 'better-sqlite3'
import type { CombatAction, DeathSaveResult, EncounterLogEntry, LoggedState } from '~~/types/encounter'
import { getParticipant } from './encounter-participants'

/*
 * Combat actions with an action log and undo (DM Command Center M7.2).
 * Every change to a participant's HP, temp HP, KO, armor class or death saves
 * is logged with the state before and after, so the newest entry can be undone.
 *
 * Rules (D&D 5e 2014, PHB ch. 9):
 * - Damage hits temporary HP first.
 * - Dropping to 0 HP knocks out; a player character then makes death saves.
 *   If the damage left over after reaching 0 is at least the HP maximum, they die outright.
 * - Damage while at 0 HP is a failed death save (instant death if it reaches the maximum).
 * - Any healing at 0 HP brings them back and clears the death saves (not once they're dead).
 * - 3 successes: stable. 3 failures: dead. Natural 20: back with 1 HP. Natural 1: two failures.
 * - Temporary HP don't stack: the higher value is kept.
 */

export class CombatActionError extends Error {}

interface ParticipantRow extends LoggedState {
  id: number
  encounter_id: number
  display_name: string
  duplicate_index: number
  entity_type: string | null
}

const STATE_FIELDS: Array<keyof LoggedState> = [
  'current_hp',
  'max_hp',
  'temp_hp',
  'armor_class',
  'is_ko',
  'death_save_successes',
  'death_save_failures',
]

function loadRow(db: Database.Database, encounterId: number, participantId: number): ParticipantRow {
  const row = getParticipant(db, encounterId, participantId) as ParticipantRow | undefined
  if (!row) throw new CombatActionError('Participant not found')
  return { ...row, is_ko: Boolean(row.is_ko) }
}

function stateOf(row: LoggedState): LoggedState {
  const state = {} as Record<string, unknown>
  for (const field of STATE_FIELDS) state[field] = row[field]
  return state as unknown as LoggedState
}

/** Only player characters make death saves; monsters and NPCs just drop. */
const makesDeathSaves = (row: ParticipantRow) => row.entity_type === 'Player'

const amountOf = (value: unknown) => {
  const n = Math.trunc(Number(value))
  if (!Number.isFinite(n) || n < 0) throw new CombatActionError('Amount must be a positive number')
  return n
}

/** Works out the new state; pure, so the rules are easy to test. */
export function resolveAction(row: ParticipantRow, action: CombatAction): { after: LoggedState, details: Record<string, unknown> } {
  const before = stateOf(row)
  const after = { ...before }
  const details: Record<string, unknown> = {}
  const deathSaves = makesDeathSaves(row)
  const resetSaves = () => {
    after.death_save_successes = 0
    after.death_save_failures = 0
  }

  switch (action.type) {
    case 'damage': {
      const amount = amountOf(action.amount)
      const absorbed = Math.min(before.temp_hp, amount)
      const rest = amount - absorbed
      after.temp_hp = before.temp_hp - absorbed
      if (absorbed) details.absorbed = absorbed
      if (before.current_hp === 0 && rest > 0) {
        // Already down: a hit is a failed death save, or death if it's massive
        if (deathSaves && before.death_save_failures < 3) {
          after.death_save_failures = rest >= before.max_hp && before.max_hp > 0 ? 3 : Math.min(3, before.death_save_failures + 1)
          details.whileDown = true
          if (after.death_save_failures === 3) details.dead = true
        }
      }
      else {
        after.current_hp = Math.max(0, before.current_hp - rest)
        if (after.current_hp === 0 && rest > 0) {
          after.is_ko = true
          details.down = true
          if (deathSaves) {
            resetSaves()
            const overflow = rest - before.current_hp
            if (before.max_hp > 0 && overflow >= before.max_hp) {
              after.death_save_failures = 3
              details.massive = true
              details.dead = true
            }
          }
        }
      }
      break
    }
    case 'heal': {
      const amount = amountOf(action.amount)
      if (deathSaves && before.death_save_failures >= 3) throw new CombatActionError('Dead characters can\'t be healed')
      after.current_hp = before.max_hp > 0 ? Math.min(before.max_hp, before.current_hp + amount) : before.current_hp + amount
      if (before.current_hp === 0 && after.current_hp > 0) {
        after.is_ko = false
        resetSaves()
        details.revived = true
      }
      break
    }
    case 'tempHp': {
      const amount = amountOf(action.amount)
      after.temp_hp = Math.max(before.temp_hp, amount)
      if (amount < before.temp_hp) details.kept = before.temp_hp
      break
    }
    case 'deathSave': {
      if (!deathSaves || before.current_hp > 0) throw new CombatActionError('Only downed player characters make death saves')
      if (before.death_save_failures >= 3) throw new CombatActionError('Already dead')
      const result: DeathSaveResult = action.result
      if (result === 'crit') {
        after.current_hp = 1
        after.is_ko = false
        resetSaves()
        details.revived = true
      }
      else if (result === 'success') {
        after.death_save_successes = Math.min(3, before.death_save_successes + 1)
        if (after.death_save_successes === 3) details.stable = true
      }
      else if (result === 'failure' || result === 'critFail') {
        after.death_save_failures = Math.min(3, before.death_save_failures + (result === 'critFail' ? 2 : 1))
        if (after.death_save_failures === 3) details.dead = true
      }
      else {
        throw new CombatActionError('Unknown death save result')
      }
      details.result = result
      break
    }
    case 'set': {
      // Direct edits (HP fields, KO toggle, AC): logged so they can be undone too
      for (const field of STATE_FIELDS) {
        const value = action.fields[field]
        if (value === undefined || value === null) continue
        if (field === 'is_ko') after.is_ko = Boolean(value)
        else (after as unknown as Record<string, number>)[field] = Math.max(0, Math.trunc(Number(value)) || 0)
      }
      // Waking someone up by hand clears their death saves
      if (before.is_ko && !after.is_ko) resetSaves()
      break
    }
    default:
      throw new CombatActionError('Unknown action')
  }
  return { after, details }
}

const changed = (a: LoggedState, b: LoggedState) => STATE_FIELDS.some(f => a[f] !== b[f])

function writeState(db: Database.Database, participantId: number, state: LoggedState) {
  db.prepare(`
    UPDATE encounter_participants
    SET current_hp = ?, max_hp = ?, temp_hp = ?, armor_class = ?, is_ko = ?,
        death_save_successes = ?, death_save_failures = ?
    WHERE id = ?
  `).run(
    state.current_hp,
    state.max_hp,
    state.temp_hp,
    state.armor_class,
    state.is_ko ? 1 : 0,
    state.death_save_successes,
    state.death_save_failures,
    participantId,
  )
}

/** Applies an action, logs it, and returns the updated participant. No-op changes aren't logged. */
export function applyCombatAction(db: Database.Database, encounterId: number, participantId: number, action: CombatAction) {
  return db.transaction(() => {
    const row = loadRow(db, encounterId, participantId)
    const before = stateOf(row)
    const { after, details } = resolveAction(row, action)
    if (changed(before, after)) {
      writeState(db, participantId, after)
      const encounter = db.prepare('SELECT round FROM encounters WHERE id = ?').get(encounterId) as { round: number }
      db.prepare(`
        INSERT INTO encounter_log (encounter_id, participant_id, participant_name, round, kind, amount, details_json, before_json, after_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        encounterId,
        participantId,
        row.duplicate_index > 0 ? `${row.display_name} (${row.duplicate_index + 1})` : row.display_name,
        encounter.round,
        action.type === 'deathSave' ? 'deathSave' : action.type,
        'amount' in action ? amountOf(action.amount) : null,
        JSON.stringify(details),
        JSON.stringify(before),
        JSON.stringify(after),
      )
    }
    return getParticipant(db, encounterId, participantId)
  })()
}

export function listCombatLog(db: Database.Database, encounterId: number, limit = 100): EncounterLogEntry[] {
  const rows = db.prepare(`
    SELECT id, participant_id, participant_name, round, kind, amount, details_json, before_json, after_json, created_at, undone_at
    FROM encounter_log WHERE encounter_id = ? ORDER BY id DESC LIMIT ?
  `).all(encounterId, limit) as Array<Record<string, unknown>>
  return rows.map(r => ({
    id: r.id as number,
    participantId: r.participant_id as number | null,
    participantName: r.participant_name as string,
    round: r.round as number,
    kind: r.kind as EncounterLogEntry['kind'],
    amount: r.amount as number | null,
    details: JSON.parse((r.details_json as string) || '{}'),
    before: JSON.parse(r.before_json as string),
    after: JSON.parse(r.after_json as string),
    createdAt: r.created_at as string,
    undone: r.undone_at !== null,
  }))
}

/**
 * Undoes the newest entry that isn't undone yet: the participant gets its
 * earlier state back. Returns false when there is nothing to undo.
 */
export function undoLastCombatAction(db: Database.Database, encounterId: number): boolean {
  return db.transaction(() => {
    const entry = db.prepare(`
      SELECT id, participant_id, before_json FROM encounter_log
      WHERE encounter_id = ? AND undone_at IS NULL ORDER BY id DESC LIMIT 1
    `).get(encounterId) as { id: number, participant_id: number | null, before_json: string } | undefined
    if (!entry) return false
    // A removed participant has nothing to restore; the entry is still marked
    if (entry.participant_id) writeState(db, entry.participant_id, JSON.parse(entry.before_json))
    db.prepare('UPDATE encounter_log SET undone_at = CURRENT_TIMESTAMP WHERE id = ?').run(entry.id)
    return true
  })()
}
