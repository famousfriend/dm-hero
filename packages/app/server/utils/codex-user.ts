import type Database from 'better-sqlite3'
import { CODEX_KINDS, CODEX_UID_REGEX, buildUid, slugify, type CodexEntry } from '../../types/codex'
import { BOOKMARK_SOURCE, BookmarkError, deleteBookmark, getCodexEntry, getCodexUsages, saveBookmark } from './codex'

/*
 * The DM's own reference content (DM Command Center M9):
 * - homebrew entries: global, source "hb", edited in place
 * - campaign edits: per-campaign changes to any entry, stored in ref_overrides;
 *   the original entry is never modified, so "Reset" always gets it back.
 */

export const HOMEBREW_SOURCE = 'hb'

export class CodexUserError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message)
  }
}

export interface CodexEditInput {
  kind?: unknown
  name?: unknown
  summary?: unknown
  body?: unknown
  /** Monster numbers the fight tracker uses */
  hp?: unknown
  ac?: unknown
  cr?: unknown
}

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '')

function number(value: unknown, min: number, max: number): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const n = Number(value)
  if (!Number.isFinite(n) || n < min || n > max) throw new CodexUserError(400, 'Numbers are out of range')
  return n
}

/** hp/ac/cr from the form; only for monsters, only the fields that were filled in. */
function monsterNumbers(kind: string, input: CodexEditInput): Record<string, number> {
  if (kind !== 'monster') return {}
  const values = {
    hp: number(input.hp, 0, 10000),
    ac: number(input.ac, 0, 50),
    cr: number(input.cr, 0, 30),
  }
  return Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined)) as Record<string, number>
}

function parseData(json: string | null): Record<string, unknown> {
  if (!json) return {}
  try {
    return JSON.parse(json) as Record<string, unknown>
  }
  catch {
    return {}
  }
}

function ensureHomebrewSource(db: Database.Database): number {
  const existing = db.prepare('SELECT id FROM ref_sources WHERE code = ?').get(HOMEBREW_SOURCE) as { id: number } | undefined
  if (existing) return existing.id
  return Number(
    db
      .prepare(
        `INSERT INTO ref_sources (code, title, license, attribution, origin)
         VALUES (?, 'Homebrew', 'Your own content', NULL, 'user')`,
      )
      .run(HOMEBREW_SOURCE).lastInsertRowid,
  )
}

// ============================================================================
// Homebrew
// ============================================================================

/** Creates a homebrew entry, or updates one when `uid` is given. Returns the entry. */
export function saveHomebrew(db: Database.Database, input: CodexEditInput & { uid?: unknown }): CodexEntry {
  const name = text(input.name, 120)
  if (!slugify(name)) throw new CodexUserError(400, 'Name is required')
  const summary = text(input.summary, 200) || null
  const body = text(input.body, 100_000) || null
  const sourceId = ensureHomebrewSource(db)

  if (typeof input.uid === 'string' && input.uid) {
    const row = db.prepare('SELECT kind, data_json, source_id FROM ref_entries WHERE ref_uid = ?').get(input.uid) as
      { kind: string, data_json: string | null, source_id: number } | undefined
    if (!row || row.source_id !== sourceId) throw new CodexUserError(404, 'Homebrew entry not found')
    // The uid stays the same on rename, so links and tokens keep working
    const data = { ...parseData(row.data_json), ...monsterNumbers(row.kind, input) }
    db.prepare(`
      UPDATE ref_entries SET name = ?, summary = ?, body_md = ?, data_json = ?, deleted_at = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE ref_uid = ?
    `).run(name, summary, body, JSON.stringify(data), input.uid)
    return getCodexEntry(db, input.uid)!
  }

  const kind = String(input.kind ?? '')
  if (!CODEX_KINDS.includes(kind as never)) throw new CodexUserError(400, 'Unknown kind')
  const uid = buildUid(kind, name, HOMEBREW_SOURCE)
  const existing = db.prepare('SELECT deleted_at FROM ref_entries WHERE ref_uid = ?').get(uid) as { deleted_at: string | null } | undefined
  if (existing && !existing.deleted_at) throw new CodexUserError(409, 'A homebrew entry with this name already exists')
  // A deleted entry with the same name comes back (its old links point at it again)
  db.prepare(`
    INSERT INTO ref_entries (ref_uid, kind, name, source_id, summary, body_md, data_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(ref_uid) DO UPDATE SET name = excluded.name, summary = excluded.summary, body_md = excluded.body_md,
      data_json = excluded.data_json, deleted_at = NULL, updated_at = CURRENT_TIMESTAMP
  `).run(uid, kind, name, sourceId, summary, body, JSON.stringify(monsterNumbers(kind, input)))
  return getCodexEntry(db, uid)!
}

/** Removes a homebrew entry from search; links and tokens keep its name. */
export function deleteHomebrew(db: Database.Database, uid: string): void {
  const result = db
    .prepare(
      `UPDATE ref_entries SET deleted_at = CURRENT_TIMESTAMP
       WHERE ref_uid = ? AND deleted_at IS NULL AND source_id = (SELECT id FROM ref_sources WHERE code = ?)`,
    )
    .run(uid, HOMEBREW_SOURCE)
  if (result.changes === 0) throw new CodexUserError(404, 'Homebrew entry not found')
}

// ============================================================================
// Campaign edits
// ============================================================================

interface OverrideRow {
  name: string | null
  summary: string | null
  body_md: string | null
  data_json: string | null
}

/** The entry as this campaign sees it: its edits on top of the original. */
export function applyCampaignEdits(db: Database.Database, entry: CodexEntry, campaignId: number | null | undefined): CodexEntry {
  if (!campaignId) return entry
  const row = db.prepare('SELECT name, summary, body_md, data_json FROM ref_overrides WHERE campaign_id = ? AND ref_uid = ?')
    .get(campaignId, entry.uid) as OverrideRow | undefined
  if (!row) return entry
  return {
    ...entry,
    name: row.name ?? entry.name,
    summary: row.summary ?? entry.summary,
    body: row.body_md ?? entry.body,
    data: row.data_json ? { ...(entry.data ?? {}), ...parseData(row.data_json) } : entry.data,
    editedInCampaign: true,
  }
}

function requireCampaign(db: Database.Database, campaignId: unknown): number {
  const id = Number(campaignId)
  if (!Number.isInteger(id) || !db.prepare('SELECT id FROM campaigns WHERE id = ? AND deleted_at IS NULL').get(id)) {
    throw new CodexUserError(404, 'Campaign not found')
  }
  return id
}

function requireEditable(db: Database.Database, uid: unknown): CodexEntry {
  const entry = typeof uid === 'string' && CODEX_UID_REGEX.test(uid) ? getCodexEntry(db, uid) : null
  if (!entry || entry.deletedAt) throw new CodexUserError(404, 'Reference not found')
  // Bookmarks have no text to change; homebrew is edited directly
  if (entry.sourceCode === BOOKMARK_SOURCE || entry.sourceCode === HOMEBREW_SOURCE) {
    throw new CodexUserError(400, 'Edit this entry directly')
  }
  return entry
}

/**
 * Saves this campaign's version of an entry. Only fields that differ from the
 * original are stored, so later dataset updates still reach the rest; when
 * nothing differs the edit is removed. Returns the entry as the campaign sees it.
 */
export function saveCampaignEdit(db: Database.Database, campaignId: unknown, uid: unknown, input: CodexEditInput): CodexEntry {
  const campaign = requireCampaign(db, campaignId)
  const original = requireEditable(db, uid)
  // A field left out keeps the original; an emptied one is stored as ''
  const changed = (value: unknown, max: number, base: string | null) => {
    if (value === undefined) return null
    const clean = text(value, max)
    return clean !== (base ?? '') ? clean : null
  }

  if (!slugify(text(input.name, 120))) throw new CodexUserError(400, 'Name is required')
  const fields = {
    name: changed(input.name, 120, original.name),
    summary: changed(input.summary, 200, original.summary),
    body: changed(input.body, 100_000, original.body),
  }
  const numbers = Object.fromEntries(
    Object.entries(monsterNumbers(original.kind, input)).filter(([key, value]) => original.data?.[key] !== value),
  )
  const data = Object.keys(numbers).length ? JSON.stringify(numbers) : null

  if (fields.name === null && fields.summary === null && fields.body === null && data === null) {
    db.prepare('DELETE FROM ref_overrides WHERE campaign_id = ? AND ref_uid = ?').run(campaign, original.uid)
  }
  else {
    db.prepare(`
      INSERT INTO ref_overrides (campaign_id, ref_uid, name, summary, body_md, data_json) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(campaign_id, ref_uid) DO UPDATE SET name = excluded.name, summary = excluded.summary,
        body_md = excluded.body_md, data_json = excluded.data_json, updated_at = CURRENT_TIMESTAMP
    `).run(campaign, original.uid, fields.name, fields.summary, fields.body, data)
  }
  return applyCampaignEdits(db, original, campaign)
}

/** Back to the original text for this campaign. */
export function resetCampaignEdit(db: Database.Database, campaignId: unknown, uid: unknown): CodexEntry {
  const campaign = requireCampaign(db, campaignId)
  const original = requireEditable(db, uid)
  db.prepare('DELETE FROM ref_overrides WHERE campaign_id = ? AND ref_uid = ?').run(campaign, original.uid)
  return original
}

// ============================================================================
// Route: /api/codex/** (one route file keeps the Nitro route count down)
// ============================================================================

interface CodexUserRequest {
  method: string
  segments: string[]
  query: Record<string, unknown>
  body: Record<string, unknown> | null
}

/**
 * POST   /api/codex/bookmarks { kind, name, book, url }      link-only entry (M3)
 * DELETE /api/codex/bookmarks?uid=
 * POST   /api/codex/homebrew { uid?, kind, name, summary, body, hp, ac, cr }  create or update
 * DELETE /api/codex/homebrew?uid=
 * PUT    /api/codex/campaign-edit { campaignId, uid, name, summary, body, hp, ac, cr }
 * DELETE /api/codex/campaign-edit?campaignId=&uid=        reset to the original
 * GET    /api/codex/usages?uid=&campaignId=                 where an entry is linked
 */
export function handleCodexUserRequest(db: Database.Database, request: CodexUserRequest): unknown {
  const { method, segments, query } = request
  const body = request.body ?? {}
  const route = `${method} ${segments.join('/')}`

  switch (route) {
    case 'POST bookmarks':
      try {
        return saveBookmark(db, body as never)
      }
      catch (error) {
        if (error instanceof BookmarkError) throw new CodexUserError(400, error.message)
        throw error
      }
    case 'DELETE bookmarks':
      if (typeof query.uid !== 'string' || !deleteBookmark(db, query.uid)) throw new CodexUserError(404, 'Bookmark not found')
      return { success: true }
    case 'POST homebrew':
      return saveHomebrew(db, body)
    case 'DELETE homebrew':
      deleteHomebrew(db, String(query.uid ?? ''))
      return { success: true }
    case 'PUT campaign-edit':
      return saveCampaignEdit(db, body.campaignId, body.uid, body)
    case 'DELETE campaign-edit':
      return resetCampaignEdit(db, query.campaignId, query.uid)
    case 'GET usages':
      if (typeof query.uid !== 'string' || !query.uid || !query.campaignId) throw new CodexUserError(400, 'uid and campaignId are required')
      return getCodexUsages(db, Number(query.campaignId), query.uid)
    default:
      throw new CodexUserError(404, 'Not found')
  }
}
