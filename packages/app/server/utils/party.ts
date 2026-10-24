import type Database from 'better-sqlite3'
import {
  PARTY_FIELDS,
  mergePartyStats,
  type PartyField,
  type PartyMember,
  type PartyStats,
} from '../../types/party'
import { fillEmptyDescription, saveDdbAvatar, writeDdbStatBlock } from './ddb-sheet'
import { DdbFetchError, fetchDdbCharacter, mapDdbCharacter, unwrapDdbResponse, type DdbCharacter, type MappedCharacter } from '@dmcc/character-core'

interface PartyRow {
  entity_id: number
  name: string
  metadata: string | null
  ddb_character_id: string | null
  ddb_stats_json: string | null
  ddb_explain_json: string | null
  ddb_fetched_at: string | null
  ddb_error: string | null
  manual_json: string | null
}

const parse = <T>(json: string | null, fallback: T): T => {
  if (!json) return fallback
  try {
    return JSON.parse(json) as T
  }
  catch {
    return fallback
  }
}

function toMember(row: PartyRow): PartyMember {
  const ddb = parse<PartyStats | null>(row.ddb_stats_json, null)
  const manual = parse<Partial<PartyStats>>(row.manual_json, {})
  const metadata = parse<{ player_name?: string }>(row.metadata, {})
  return {
    entityId: row.entity_id,
    entityName: row.name,
    playerName: metadata.player_name || null,
    ddbCharacterId: row.ddb_character_id,
    ddb,
    ddbExplain: parse(row.ddb_explain_json, {}),
    ddbFetchedAt: row.ddb_fetched_at,
    ddbError: row.ddb_error,
    manual,
    effective: mergePartyStats(ddb, manual, row.name),
  }
}

const MEMBER_SELECT = `
  SELECT e.id AS entity_id, e.name, e.metadata,
         p.ddb_character_id, p.ddb_stats_json, p.ddb_explain_json, p.ddb_fetched_at, p.ddb_error, p.manual_json
  FROM entities e
  JOIN entity_types t ON t.id = e.type_id AND t.name = 'Player'
  LEFT JOIN party_status p ON p.entity_id = e.id
`

/** All active (not deleted, not archived) player characters of a campaign. */
export function listParty(db: Database.Database, campaignId: number): PartyMember[] {
  const rows = db
    .prepare(`${MEMBER_SELECT} WHERE e.campaign_id = ? AND e.deleted_at IS NULL AND e.archived_at IS NULL ORDER BY e.name`)
    .all(campaignId) as PartyRow[]
  return rows.map(toMember)
}

export function getPartyMember(db: Database.Database, entityId: number): PartyMember | null {
  const row = db.prepare(`${MEMBER_SELECT} WHERE e.id = ? AND e.deleted_at IS NULL`).get(entityId) as PartyRow | undefined
  return row ? toMember(row) : null
}

function ensureRow(db: Database.Database, entityId: number) {
  db.prepare('INSERT OR IGNORE INTO party_status (entity_id) VALUES (?)').run(entityId)
}

/** Keeps only known fields with a plausible type; null/undefined removes a manual value. */
export function sanitizeManual(input: unknown): Partial<PartyStats> {
  const result: Record<string, unknown> = {}
  if (!input || typeof input !== 'object') return result
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!PARTY_FIELDS.includes(key as PartyField) || value === null || value === undefined) continue
    switch (key as PartyField) {
      case 'name':
      case 'classLabel':
        if (typeof value === 'string') result[key] = value.slice(0, 200)
        break
      case 'inspiration':
        if (typeof value === 'boolean') result[key] = value
        break
      case 'conditions':
        if (Array.isArray(value)) result[key] = value.filter(v => typeof v === 'string').map(v => v.slice(0, 60)).slice(0, 30)
        break
      case 'spellSlots':
        if (Array.isArray(value)) {
          result[key] = value
            .filter(s => s && typeof s === 'object')
            .map(s => ({
              level: Math.trunc(Number(s.level)),
              used: Math.max(0, Math.trunc(Number(s.used) || 0)),
              max: Math.max(0, Math.trunc(Number(s.max) || 0)),
            }))
            .filter(s => s.level >= 1 && s.level <= 9)
        }
        break
      default: {
        const n = Number(value)
        if (Number.isFinite(n)) result[key] = Math.trunc(n)
      }
    }
  }
  return result as Partial<PartyStats>
}

/**
 * Updates the link and/or manual values. `manual` is a patch: a field set to null
 * goes back to the D&D Beyond value.
 */
export function updatePartyMember(
  db: Database.Database,
  entityId: number,
  changes: { ddbCharacterId?: string | null, manual?: Record<string, unknown> },
): void {
  ensureRow(db, entityId)
  if (changes.ddbCharacterId !== undefined) {
    const current = db.prepare('SELECT ddb_character_id FROM party_status WHERE entity_id = ?').get(entityId) as {
      ddb_character_id: string | null
    }
    if (current.ddb_character_id !== changes.ddbCharacterId) {
      // A different sheet: the old numbers belong to someone else
      db.prepare(
        `UPDATE party_status SET ddb_character_id = ?, ddb_stats_json = NULL, ddb_explain_json = NULL,
         ddb_fetched_at = NULL, ddb_error = NULL, ddb_attempted_at = NULL, updated_at = CURRENT_TIMESTAMP
         WHERE entity_id = ?`,
      ).run(changes.ddbCharacterId, entityId)
    }
  }
  if (changes.manual) {
    const row = db.prepare('SELECT manual_json FROM party_status WHERE entity_id = ?').get(entityId) as {
      manual_json: string
    }
    const reverted = new Set(Object.keys(changes.manual).filter(key => changes.manual![key] === null))
    const merged = Object.fromEntries(
      Object.entries(parse<Record<string, unknown>>(row.manual_json, {})).filter(([key]) => !reverted.has(key)),
    )
    Object.assign(merged, sanitizeManual(changes.manual))
    db.prepare('UPDATE party_status SET manual_json = ?, updated_at = CURRENT_TIMESTAMP WHERE entity_id = ?').run(
      JSON.stringify(merged),
      entityId,
    )
  }
}

/** Stores a sheet from D&D Beyond (fetched or imported from a saved file). */
export function storeDdbCharacter(db: Database.Database, entityId: number, character: DdbCharacter): MappedCharacter {
  ensureRow(db, entityId)
  const mapped = mapDdbCharacter(character)
  const { stats, explain } = mapped
  db.prepare(
    `UPDATE party_status SET ddb_stats_json = ?, ddb_explain_json = ?, ddb_fetched_at = CURRENT_TIMESTAMP,
     ddb_attempted_at = CURRENT_TIMESTAMP, ddb_error = NULL,
     ddb_character_id = COALESCE(ddb_character_id, ?), updated_at = CURRENT_TIMESTAMP
     WHERE entity_id = ?`,
  ).run(JSON.stringify(stats), JSON.stringify(explain), character.id ? String(character.id) : null, entityId)
  // The full sheet also fills the player's Stat Block and an empty description
  writeDdbStatBlock(db, entityId, mapped)
  fillEmptyDescription(db, entityId, mapped)
  return mapped
}

export function importDdbJson(db: Database.Database, entityId: number, json: unknown): void {
  storeDdbCharacter(db, entityId, unwrapDdbResponse(json))
}

/** Minimum time between two automatic fetches of the same sheet. */
export const MIN_REFRESH_SECONDS = 20

/**
 * Fetches one linked sheet. On failure the last good numbers stay and the error
 * is stored for the "can't reach D&D Beyond" warning. Returns false when skipped.
 */
export async function refreshPartyMember(
  db: Database.Database,
  entityId: number,
  options: { force?: boolean, fetcher?: typeof fetchDdbCharacter } = {},
): Promise<boolean> {
  const row = db
    .prepare(
      `SELECT ddb_character_id, (strftime('%s','now') - strftime('%s', ddb_attempted_at)) AS age
       FROM party_status WHERE entity_id = ?`,
    )
    .get(entityId) as { ddb_character_id: string | null, age: number | null } | undefined
  if (!row?.ddb_character_id) return false
  if (!options.force && row.age !== null && row.age < MIN_REFRESH_SECONDS) return false

  db.prepare('UPDATE party_status SET ddb_attempted_at = CURRENT_TIMESTAMP WHERE entity_id = ?').run(entityId)
  try {
    const character = await (options.fetcher ?? fetchDdbCharacter)(row.ddb_character_id)
    const mapped = storeDdbCharacter(db, entityId, character)
    // Portrait only for real fetches (tests pass their own fetcher)
    if (!options.fetcher) await saveDdbAvatar(db, entityId, mapped.sheet.avatarUrl)
  }
  catch (error) {
    const message = error instanceof DdbFetchError || error instanceof Error ? error.message : 'Refresh failed'
    db.prepare('UPDATE party_status SET ddb_error = ? WHERE entity_id = ?').run(message, entityId)
  }
  return true
}

export async function refreshParty(
  db: Database.Database,
  campaignId: number,
  options: { force?: boolean, fetcher?: typeof fetchDdbCharacter } = {},
): Promise<void> {
  for (const member of listParty(db, campaignId)) {
    if (member.ddbCharacterId) await refreshPartyMember(db, member.entityId, options)
  }
}
