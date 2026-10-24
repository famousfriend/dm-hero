import type Database from 'better-sqlite3'
import { NOTE_VISIBILITIES, type JournalNpc, type JournalPlace, type JournalQuest, type JournalQuestStatus, type JournalSource, type NoteVisibility, type PlayerNote } from '@dmcc/character-core'
import { importPlayerPack } from './player-pack'
import { RouteError, type RouteRequest } from './route-error'

interface NoteRow {
  id: number
  character_id: number
  title: string
  body: string
  visibility: NoteVisibility
  created_at: string
  updated_at: string
}

interface EntryRow {
  id: number
  character_id: number
  place_id?: number | null
  source: JournalSource
  name: string
  description: string
  player_notes: string
  created_at: string
  updated_at: string
}

const toNote = (r: NoteRow): PlayerNote => ({
  id: r.id, characterId: r.character_id, title: r.title, body: r.body, visibility: r.visibility, createdAt: r.created_at, updatedAt: r.updated_at,
})

const toPlace = (r: EntryRow): JournalPlace => ({
  id: r.id, characterId: r.character_id, source: r.source, name: r.name, description: r.description, playerNotes: r.player_notes, createdAt: r.created_at, updatedAt: r.updated_at,
})

const toNpc = (r: EntryRow): JournalNpc => ({ ...toPlace(r), placeId: r.place_id ?? null })

function str(body: Record<string, unknown>, key: string, max = 20000): string | undefined {
  const value = body[key]
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new RouteError(400, `Invalid ${key}`)
  if (value.length > max) throw new RouteError(400, `${key} is too long`)
  return value
}

function characterIdOf(db: Database.Database, input: unknown): number {
  const id = Number(input)
  if (!Number.isInteger(id) || !db.prepare('SELECT 1 FROM characters WHERE id = ?').get(id)) throw new RouteError(400, 'Unknown character')
  return id
}

function placeIdOf(db: Database.Database, characterId: number, input: unknown): number | null {
  if (input === null || input === undefined || input === '') return null
  const id = Number(input)
  if (!Number.isInteger(id) || !db.prepare('SELECT 1 FROM places WHERE id = ? AND character_id = ?').get(id, characterId)) {
    throw new RouteError(400, 'Unknown place')
  }
  return id
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

export function listNotes(db: Database.Database, characterId: number): PlayerNote[] {
  return (db.prepare('SELECT * FROM notes WHERE character_id = ? ORDER BY updated_at DESC, id DESC').all(characterId) as NoteRow[]).map(toNote)
}

function getNote(db: Database.Database, id: number): PlayerNote {
  const row = db.prepare('SELECT * FROM notes WHERE id = ?').get(id) as NoteRow | undefined
  if (!row) throw new RouteError(404, 'Note not found')
  return toNote(row)
}

function visibilityOf(input: unknown): NoteVisibility | undefined {
  if (input === undefined) return undefined
  if (!NOTE_VISIBILITIES.includes(input as NoteVisibility)) throw new RouteError(400, 'Invalid visibility')
  return input as NoteVisibility
}

export function createNote(db: Database.Database, body: Record<string, unknown>): PlayerNote {
  const characterId = characterIdOf(db, body.characterId)
  const title = (str(body, 'title', 200) ?? '').trim()
  const text = str(body, 'body') ?? ''
  if (!title && !text.trim()) throw new RouteError(400, 'A note needs a title or text')
  const id = Number(db.prepare('INSERT INTO notes (character_id, title, body, visibility) VALUES (?, ?, ?, ?)')
    .run(characterId, title, text, visibilityOf(body.visibility) ?? 'private').lastInsertRowid)
  return getNote(db, id)
}

export function updateNote(db: Database.Database, id: number, body: Record<string, unknown>): PlayerNote {
  const note = getNote(db, id)
  const title = str(body, 'title', 200)?.trim() ?? note.title
  const text = str(body, 'body') ?? note.body
  const visibility = visibilityOf(body.visibility) ?? note.visibility
  db.prepare('UPDATE notes SET title = ?, body = ?, visibility = ?, updated_at = datetime(\'now\') WHERE id = ?').run(title, text, visibility, id)
  return getNote(db, id)
}

// ---------------------------------------------------------------------------
// Places and NPCs
// ---------------------------------------------------------------------------

type EntryTable = 'places' | 'npcs'

function getEntry(db: Database.Database, table: EntryTable, id: number): EntryRow {
  const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as EntryRow | undefined
  if (!row) throw new RouteError(404, table === 'places' ? 'Place not found' : 'NPC not found')
  return row
}

export function listPlaces(db: Database.Database, characterId: number): JournalPlace[] {
  return (db.prepare('SELECT * FROM places WHERE character_id = ? ORDER BY name COLLATE NOCASE').all(characterId) as EntryRow[]).map(toPlace)
}

export function listNpcs(db: Database.Database, characterId: number): JournalNpc[] {
  return (db.prepare('SELECT * FROM npcs WHERE character_id = ? ORDER BY name COLLATE NOCASE').all(characterId) as EntryRow[]).map(toNpc)
}

/**
 * Player-made entry. Entries from the DM come in only through a player pack
 * (importPlayerPack), so a player cannot pass their own text off as the DM's.
 */
function createEntry(db: Database.Database, table: EntryTable, body: Record<string, unknown>) {
  const characterId = characterIdOf(db, body.characterId)
  const name = (str(body, 'name', 200) ?? '').trim()
  if (!name) throw new RouteError(400, 'Name is required')
  const description = str(body, 'description') ?? ''
  const playerNotes = str(body, 'playerNotes') ?? ''
  const result = table === 'npcs'
    ? db.prepare('INSERT INTO npcs (character_id, place_id, name, description, player_notes) VALUES (?, ?, ?, ?, ?)')
        .run(characterId, placeIdOf(db, characterId, body.placeId), name, description, playerNotes)
    : db.prepare('INSERT INTO places (character_id, name, description, player_notes) VALUES (?, ?, ?, ?)')
        .run(characterId, name, description, playerNotes)
  const row = getEntry(db, table, Number(result.lastInsertRowid))
  return table === 'npcs' ? toNpc(row) : toPlace(row)
}

/** On a DM entry only the player's notes (and, for an NPC, where they met) change */
function updateEntry(db: Database.Database, table: EntryTable, id: number, body: Record<string, unknown>) {
  const row = getEntry(db, table, id)
  const own = row.source === 'player'
  if (!own && (body.name !== undefined || body.description !== undefined)) {
    throw new RouteError(403, 'Name and description come from your DM')
  }
  const name = own ? (str(body, 'name', 200)?.trim() || row.name) : row.name
  const description = own ? (str(body, 'description') ?? row.description) : row.description
  const playerNotes = str(body, 'playerNotes') ?? row.player_notes
  if (table === 'npcs') {
    const placeId = 'placeId' in body ? placeIdOf(db, row.character_id, body.placeId) : row.place_id ?? null
    db.prepare('UPDATE npcs SET name = ?, description = ?, player_notes = ?, place_id = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .run(name, description, playerNotes, placeId, id)
    return toNpc(getEntry(db, table, id))
  }
  db.prepare('UPDATE places SET name = ?, description = ?, player_notes = ?, updated_at = datetime(\'now\') WHERE id = ?')
    .run(name, description, playerNotes, id)
  return toPlace(getEntry(db, table, id))
}

// ---------------------------------------------------------------------------
// Quests (only from the DM, through a player pack)
// ---------------------------------------------------------------------------

interface QuestRow {
  id: number
  character_id: number
  name: string
  description: string
  status: JournalQuestStatus
  reward: string
  player_notes: string
  created_at: string
  updated_at: string
}

const toQuest = (r: QuestRow): JournalQuest => ({
  id: r.id, characterId: r.character_id, name: r.name, description: r.description, status: r.status, reward: r.reward, playerNotes: r.player_notes, createdAt: r.created_at, updatedAt: r.updated_at,
})

const QUEST_ORDER = 'CASE status WHEN \'active\' THEN 0 WHEN \'open\' THEN 1 WHEN \'done\' THEN 2 ELSE 3 END'

export function listQuests(db: Database.Database, characterId: number): JournalQuest[] {
  return (db.prepare(`SELECT * FROM quests WHERE character_id = ? ORDER BY ${QUEST_ORDER}, name COLLATE NOCASE`).all(characterId) as QuestRow[]).map(toQuest)
}

function getQuest(db: Database.Database, id: number): JournalQuest {
  const row = db.prepare('SELECT * FROM quests WHERE id = ?').get(id) as QuestRow | undefined
  if (!row) throw new RouteError(404, 'Quest not found')
  return toQuest(row)
}

function updateQuest(db: Database.Database, id: number, body: Record<string, unknown>): JournalQuest {
  const quest = getQuest(db, id)
  if (Object.keys(body).some(key => key !== 'playerNotes')) throw new RouteError(403, 'Quests come from your DM; only your notes can change')
  db.prepare('UPDATE quests SET player_notes = ?, updated_at = datetime(\'now\') WHERE id = ?').run(str(body, 'playerNotes') ?? quest.playerNotes, id)
  return getQuest(db, id)
}

/*
 *   GET    /api/journal?characterId=1         { notes, places, npcs } of a character
 *   POST   /api/journal/notes                 { characterId, title, body, visibility }
 *   POST   /api/journal/places | npcs         { characterId, name, description, playerNotes, placeId? }
 *   PATCH | DELETE /api/journal/notes|places|npcs|quests/:id   (quests: playerNotes only)
 *   POST   /api/journal/import-pack           { characterId, pack, apply } player pack from DM Command Center;
 *                                             apply false only previews what would be added and updated
 */
export function handleJournal(db: Database.Database, req: RouteRequest) {
  const [kind, idText, ...rest] = req.segments
  if (rest.length) throw new RouteError(404, 'Not found')
  if (!kind) {
    if (req.method !== 'GET') throw new RouteError(405, 'Method not allowed')
    const characterId = characterIdOf(db, req.query?.characterId)
    return { notes: listNotes(db, characterId), places: listPlaces(db, characterId), npcs: listNpcs(db, characterId), quests: listQuests(db, characterId) }
  }
  const body = req.body ?? {}
  if (kind === 'import-pack' && !idText) {
    if (req.method !== 'POST') throw new RouteError(405, 'Method not allowed')
    return importPlayerPack(db, characterIdOf(db, body.characterId), body.pack, body.apply === true)
  }
  if (kind !== 'notes' && kind !== 'places' && kind !== 'npcs' && kind !== 'quests') throw new RouteError(404, 'Not found')
  if (!idText) {
    if (req.method !== 'POST' || kind === 'quests') throw new RouteError(405, 'Method not allowed')
    return kind === 'notes' ? createNote(db, body) : createEntry(db, kind, body)
  }
  const id = Number(idText)
  if (!Number.isInteger(id)) throw new RouteError(404, 'Not found')
  if (req.method === 'PATCH') {
    if (kind === 'notes') return updateNote(db, id, body)
    return kind === 'quests' ? updateQuest(db, id, body) : updateEntry(db, kind, id, body)
  }
  if (req.method === 'DELETE') {
    if (kind === 'notes') getNote(db, id)
    else if (kind === 'quests') getQuest(db, id)
    else getEntry(db, kind, id)
    db.prepare(`DELETE FROM ${kind} WHERE id = ?`).run(id)
    return { ok: true }
  }
  throw new RouteError(405, 'Method not allowed')
}
