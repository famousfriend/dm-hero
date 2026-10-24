import type Database from 'better-sqlite3'
import { EMPTY_PLAYER_SHEET, setLayer, type LayeredRecord, type PlayerCampaign, type PlayerCharacter, type PlayerSheet } from '@dmcc/character-core'

export class RouteError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message)
  }
}

export interface RouteRequest {
  method: string
  /** Path below /api/<feature>, split on "/" */
  segments: string[]
  body: Record<string, unknown> | null
}

interface CharacterRow {
  id: number
  campaign_id: number | null
  ddb_character_id: string | null
  values_json: string
  created_at: string
  updated_at: string
}

function toCharacter(row: CharacterRow): PlayerCharacter {
  let values: LayeredRecord<PlayerSheet> = {}
  try {
    values = JSON.parse(row.values_json)
  }
  catch {
    // A broken row still lists, with empty values
  }
  return {
    id: row.id,
    campaignId: row.campaign_id,
    ddbCharacterId: row.ddb_character_id,
    values,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const SHEET_KEYS = Object.keys(EMPTY_PLAYER_SHEET) as (keyof PlayerSheet)[]

/** Only known fields with the right type are written, as the player's own (local) layer */
function localEdits(input: unknown): Partial<PlayerSheet> {
  const out: Record<string, unknown> = {}
  if (!input || typeof input !== 'object') return out
  for (const key of SHEET_KEYS) {
    const value = (input as Record<string, unknown>)[key]
    if (value === undefined) continue
    const expected = typeof EMPTY_PLAYER_SHEET[key]
    if (value === null || typeof value === expected) out[key] = value
    else throw new RouteError(400, `Invalid value for ${key}`)
  }
  if (typeof out.name === 'string' && !out.name.trim()) throw new RouteError(400, 'Name is required')
  return out as Partial<PlayerSheet>
}

function campaignIdOf(db: Database.Database, input: unknown): number | null {
  if (input === null || input === undefined) return null
  const id = Number(input)
  if (!Number.isInteger(id) || !db.prepare('SELECT 1 FROM campaigns WHERE id = ?').get(id)) {
    throw new RouteError(400, 'Unknown campaign')
  }
  return id
}

export function listCharacters(db: Database.Database): PlayerCharacter[] {
  return (db.prepare('SELECT * FROM characters ORDER BY id').all() as CharacterRow[]).map(toCharacter)
}

export function getCharacter(db: Database.Database, id: number): PlayerCharacter | null {
  const row = db.prepare('SELECT * FROM characters WHERE id = ?').get(id) as CharacterRow | undefined
  return row ? toCharacter(row) : null
}

export function createCharacter(db: Database.Database, body: Record<string, unknown>): PlayerCharacter {
  const edits = localEdits(body.values)
  if (!edits.name) throw new RouteError(400, 'Name is required')
  let values: LayeredRecord<PlayerSheet> = {}
  for (const [key, value] of Object.entries(edits) as [keyof PlayerSheet, never][]) {
    values = setLayer(values, key, 'local', value)
  }
  const result = db.prepare('INSERT INTO characters (campaign_id, values_json) VALUES (?, ?)')
    .run(campaignIdOf(db, body.campaignId), JSON.stringify(values))
  const created = getCharacter(db, Number(result.lastInsertRowid))!
  if (getActiveCharacterId(db) === null) setActiveCharacterId(db, created.id)
  return created
}

/** PATCH: { values?: { field: value | null } } sets (null clears) the player's own layer; { campaignId? } */
export function updateCharacter(db: Database.Database, id: number, body: Record<string, unknown>): PlayerCharacter {
  const character = getCharacter(db, id)
  if (!character) throw new RouteError(404, 'Character not found')
  let values = character.values
  for (const [key, value] of Object.entries(localEdits(body.values)) as [keyof PlayerSheet, never][]) {
    values = setLayer(values, key, 'local', value ?? undefined)
  }
  const campaignId = 'campaignId' in body ? campaignIdOf(db, body.campaignId) : character.campaignId
  db.prepare('UPDATE characters SET values_json = ?, campaign_id = ?, updated_at = datetime(\'now\') WHERE id = ?')
    .run(JSON.stringify(values), campaignId, id)
  return getCharacter(db, id)!
}

export function deleteCharacter(db: Database.Database, id: number) {
  if (!db.prepare('DELETE FROM characters WHERE id = ?').run(id).changes) throw new RouteError(404, 'Character not found')
  // The setting still names the deleted character: move it to the next one
  if (getActiveCharacterId(db) === null) {
    const next = db.prepare('SELECT id FROM characters ORDER BY id LIMIT 1').get() as { id: number } | undefined
    setActiveCharacterId(db, next?.id ?? null)
  }
}

export function getActiveCharacterId(db: Database.Database): number | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = \'active_character\'').get() as { value: string } | undefined
  const id = row ? Number(row.value) : Number.NaN
  return Number.isInteger(id) && getCharacter(db, id) ? id : null
}

export function setActiveCharacterId(db: Database.Database, id: number | null) {
  if (id === null) {
    db.prepare('DELETE FROM settings WHERE key = \'active_character\'').run()
    return
  }
  if (!getCharacter(db, id)) throw new RouteError(404, 'Character not found')
  db.prepare('INSERT INTO settings (key, value) VALUES (\'active_character\', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(String(id))
}

interface CampaignRow {
  id: number
  name: string
  dm_name: string
  created_at: string
}

const toCampaign = (row: CampaignRow): PlayerCampaign => ({ id: row.id, name: row.name, dmName: row.dm_name, createdAt: row.created_at })

function text(input: unknown, field: string, required: boolean): string | undefined {
  if (input === undefined && !required) return undefined
  if (typeof input !== 'string' || (required && !input.trim())) throw new RouteError(400, `${field} is required`)
  return input.trim()
}

export function listCampaigns(db: Database.Database): PlayerCampaign[] {
  return (db.prepare('SELECT * FROM campaigns ORDER BY name COLLATE NOCASE').all() as CampaignRow[]).map(toCampaign)
}

export function createCampaign(db: Database.Database, body: Record<string, unknown>): PlayerCampaign {
  const name = text(body.name, 'Name', true)!
  const dmName = text(body.dmName ?? '', 'DM name', false) ?? ''
  const id = Number(db.prepare('INSERT INTO campaigns (name, dm_name) VALUES (?, ?)').run(name, dmName).lastInsertRowid)
  return toCampaign(db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id) as CampaignRow)
}

export function updateCampaign(db: Database.Database, id: number, body: Record<string, unknown>): PlayerCampaign {
  const row = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id) as CampaignRow | undefined
  if (!row) throw new RouteError(404, 'Campaign not found')
  const name = text(body.name, 'Name', false) || row.name
  const dmName = text(body.dmName, 'DM name', false) ?? row.dm_name
  db.prepare('UPDATE campaigns SET name = ?, dm_name = ? WHERE id = ?').run(name, dmName, id)
  return toCampaign({ ...row, name, dm_name: dmName })
}

export function deleteCampaign(db: Database.Database, id: number) {
  if (!db.prepare('DELETE FROM campaigns WHERE id = ?').run(id).changes) throw new RouteError(404, 'Campaign not found')
}

/*
 *   GET    /api/characters              list + active id
 *   POST   /api/characters              { values: { name, ... }, campaignId? }
 *   PUT    /api/characters/active       { id }
 *   GET | PATCH | DELETE /api/characters/:id
 */
export function handleCharacters(db: Database.Database, req: RouteRequest) {
  const [first, ...rest] = req.segments
  if (rest.length) throw new RouteError(404, 'Not found')
  if (!first) {
    if (req.method === 'GET') return { characters: listCharacters(db), activeId: getActiveCharacterId(db) }
    if (req.method === 'POST') return createCharacter(db, req.body ?? {})
  }
  else if (first === 'active') {
    if (req.method === 'PUT') {
      const id = req.body?.id === null ? null : Number(req.body?.id)
      if (id !== null && !Number.isInteger(id)) throw new RouteError(400, 'Invalid id')
      setActiveCharacterId(db, id)
      return { activeId: getActiveCharacterId(db) }
    }
  }
  else {
    const id = Number(first)
    if (!Number.isInteger(id)) throw new RouteError(404, 'Not found')
    if (req.method === 'GET') {
      const character = getCharacter(db, id)
      if (!character) throw new RouteError(404, 'Character not found')
      return character
    }
    if (req.method === 'PATCH') return updateCharacter(db, id, req.body ?? {})
    if (req.method === 'DELETE') {
      deleteCharacter(db, id)
      return { ok: true }
    }
  }
  throw new RouteError(405, 'Method not allowed')
}

/*
 *   GET    /api/campaigns
 *   POST   /api/campaigns               { name, dmName? }
 *   PATCH | DELETE /api/campaigns/:id
 */
export function handleCampaigns(db: Database.Database, req: RouteRequest) {
  const [first, ...rest] = req.segments
  if (rest.length) throw new RouteError(404, 'Not found')
  if (!first) {
    if (req.method === 'GET') return listCampaigns(db)
    if (req.method === 'POST') return createCampaign(db, req.body ?? {})
  }
  else {
    const id = Number(first)
    if (!Number.isInteger(id)) throw new RouteError(404, 'Not found')
    if (req.method === 'PATCH') return updateCampaign(db, id, req.body ?? {})
    if (req.method === 'DELETE') {
      deleteCampaign(db, id)
      return { ok: true }
    }
  }
  throw new RouteError(405, 'Method not allowed')
}
