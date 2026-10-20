import { randomBytes, timingSafeEqual } from 'node:crypto'
import type Database from 'better-sqlite3'
import { parseStatBlock, type StatBlockAction } from '../../app/utils/statBlock'
import { applyCampaignEdits } from './codex-user'
import { getCodexEntry } from './codex'
import { listParticipants } from './encounter-participants'

/*
 * The DM Command Center panel inside TaleSpire (M12b-2). TaleSpire runs it as a
 * "symbiote": a local web page in its own browser, so it calls this app from
 * another origin. It gets the running fight and writes its dice rolls into the
 * fight's action log, and nothing else. Every call needs the key that the app
 * wrote into the panel when it was installed.
 */

const KEY_SETTING = 'talespire_key'

/** The panel's key; made on first use and kept in the settings table */
export function getTaleSpireKey(db: Database.Database): string {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(KEY_SETTING) as { value: string } | undefined
  if (row?.value) return row.value
  const key = randomBytes(24).toString('hex')
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP').run(KEY_SETTING, key)
  return key
}

export function isTaleSpireKey(db: Database.Database, given: unknown): boolean {
  if (typeof given !== 'string' || !given) return false
  const expected = Buffer.from(getTaleSpireKey(db))
  const actual = Buffer.from(given)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export interface TaleSpireAction {
  name: string
  toHit: number | null
  damageDice: string | null
  save: string | null
}

export interface TaleSpireParticipant {
  id: number
  name: string
  kind: 'player' | 'monster' | 'other'
  initiative: number | null
  hp: number
  maxHp: number
  tempHp: number
  ac: number | null
  ko: boolean
  conditions: string[]
  actions: TaleSpireAction[]
  /** Spell attack bonus, if the monster casts spells with attack rolls */
  spellAttack: number | null
}

export interface TaleSpireState {
  encounter: null | {
    id: number
    name: string
    campaign: string
    round: number
    currentIndex: number
    participants: TaleSpireParticipant[]
  }
}

interface ParticipantRow {
  id: number
  ref_uid: string | null
  display_name: string
  duplicate_index: number
  entity_type: string | null
  initiative: number | null
  current_hp: number | null
  max_hp: number | null
  temp_hp: number | null
  armor_class: number | null
  is_ko: number
  death_save_successes: number
  death_save_failures: number
  effects?: Array<{ name: string }>
}

const rowsOf = (db: Database.Database, encounterId: number) => listParticipants(db, encounterId) as unknown as ParticipantRow[]
const nameOf = (p: ParticipantRow) => (p.duplicate_index > 0 ? `${p.display_name} (${p.duplicate_index + 1})` : p.display_name)

const toAction = (a: StatBlockAction): TaleSpireAction => ({ name: a.name, toHit: a.toHit, damageDice: a.damageDice, save: a.save })

/** The fight that's running now (the most recently changed one if there are several) */
export function getTaleSpireState(db: Database.Database): TaleSpireState {
  const encounter = db.prepare(`
    SELECT e.id, e.name, e.round, e.current_turn_index, e.campaign_id, c.name AS campaign
    FROM encounters e JOIN campaigns c ON c.id = e.campaign_id
    WHERE e.status = 'active' AND e.deleted_at IS NULL
    ORDER BY e.updated_at DESC, e.id DESC LIMIT 1
  `).get() as { id: number, name: string, round: number, current_turn_index: number, campaign_id: number, campaign: string } | undefined
  if (!encounter) return { encounter: null }

  const blocks = new Map<string, ReturnType<typeof parseStatBlock> | null>()
  const blockOf = (uid: string) => {
    if (!blocks.has(uid)) {
      const entry = getCodexEntry(db, uid)
      blocks.set(uid, entry ? parseStatBlock(applyCampaignEdits(db, entry, encounter.campaign_id).body ?? '') : null)
    }
    return blocks.get(uid)!
  }

  const participants = rowsOf(db, encounter.id).map((p): TaleSpireParticipant => {
    const block = p.ref_uid ? blockOf(p.ref_uid) : null
    return {
      id: p.id,
      name: nameOf(p),
      kind: p.entity_type === 'Player' ? 'player' : p.ref_uid ? 'monster' : 'other',
      initiative: p.initiative ?? null,
      hp: p.current_hp ?? 0,
      maxHp: p.max_hp ?? 0,
      tempHp: p.temp_hp ?? 0,
      ac: p.armor_class ?? null,
      ko: Boolean(p.is_ko),
      conditions: (p.effects ?? []).map(e => e.name),
      actions: block ? [...block.actions, ...block.bonusActions, ...block.reactions, ...block.legendary].map(toAction) : [],
      spellAttack: block?.spellcasting.find(s => s.attack !== null)?.attack ?? null,
    }
  })
  return {
    encounter: {
      id: encounter.id,
      name: encounter.name,
      campaign: encounter.campaign,
      round: encounter.round,
      currentIndex: encounter.current_turn_index,
      participants,
    },
  }
}

export class TaleSpireError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message)
  }
}

/** A roll made in TaleSpire, written into the fight's action log (not undoable, nothing changes) */
export function logTaleSpireRoll(db: Database.Database, input: Record<string, unknown>) {
  const encounterId = Number(input.encounterId)
  const total = Math.trunc(Number(input.total))
  const label = String(input.label ?? '').trim().slice(0, 120)
  const detail = String(input.detail ?? '').trim().slice(0, 200)
  if (!Number.isInteger(encounterId) || !Number.isFinite(total) || !label) throw new TaleSpireError(400, 'encounterId, label and total are required')
  const encounter = db.prepare('SELECT round FROM encounters WHERE id = ? AND deleted_at IS NULL').get(encounterId) as { round: number } | undefined
  if (!encounter) throw new TaleSpireError(404, 'Encounter not found')

  const participant = input.participantId != null
    ? rowsOf(db, encounterId).find(p => p.id === Number(input.participantId))
    : undefined
  const name = participant ? nameOf(participant) : 'TaleSpire'
  const state = participant
    ? JSON.stringify({ current_hp: participant.current_hp, max_hp: participant.max_hp, temp_hp: participant.temp_hp, armor_class: participant.armor_class, is_ko: Boolean(participant.is_ko), death_save_successes: participant.death_save_successes, death_save_failures: participant.death_save_failures })
    : '{}'
  db.prepare(`
    INSERT INTO encounter_log (encounter_id, participant_id, participant_name, round, kind, amount, details_json, before_json, after_json)
    VALUES (?, ?, ?, ?, 'roll', ?, ?, ?, ?)
  `).run(encounterId, participant?.id ?? null, name, encounter.round, total, JSON.stringify({ label, detail }), state, state)
  return { ok: true }
}
