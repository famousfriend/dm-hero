import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'
import srdDataset from '../codex-data/srd-5.1.json'
import { createLevenshtein } from './levenshtein'
import {
  CODEX_KINDS,
  buildUid,
  externalUrl,
  nameFromSlug,
  parseUid,
  extractCodexUids,
  slugify,
  type CodexEntry,
  type CodexEntrySummary,
} from '../../types/codex'

// ============================================================================
// Bundled dataset (SRD 5.1, CC-BY-4.0)
// ============================================================================

export interface CodexDataset {
  source: { code: string, title: string, license: string, attribution: string }
  entries: Array<{
    kind: string
    name: string
    book: string | null
    summary: string
    body: string
    data: Record<string, unknown>
  }>
}

/**
 * Loads a bundled dataset into ref_entries. Idempotent: skipped when the stored
 * dataset hash matches, otherwise entries are upserted by ref_uid (existing ids,
 * and therefore links and FTS rows, are kept).
 */
export function seedCodex(
  db: Database.Database,
  dataset: CodexDataset = srdDataset as CodexDataset,
  origin: 'bundled' | 'import' = 'bundled',
): void {
  const version = createHash('sha1').update(JSON.stringify(dataset)).digest('hex').slice(0, 12)
  const existing = db
    .prepare('SELECT id, version FROM ref_sources WHERE code = ?')
    .get(dataset.source.code) as { id: number, version: string | null } | undefined
  if (existing?.version === version) return

  const { code, title, license, attribution } = dataset.source
  db.transaction(() => {
    let sourceId = existing?.id
    if (sourceId === undefined) {
      sourceId = Number(
        db
          .prepare(
            `INSERT INTO ref_sources (code, title, license, attribution, origin, version)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(code, title, license, attribution, origin, version).lastInsertRowid,
      )
    }
    else {
      db.prepare(
        `UPDATE ref_sources SET title = ?, license = ?, attribution = ?, version = ?,
         imported_at = CURRENT_TIMESTAMP WHERE id = ?`,
      ).run(title, license, attribution, version, sourceId)
    }

    const upsert = db.prepare(`
      INSERT INTO ref_entries (ref_uid, kind, name, source_id, summary, body_md, data_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(ref_uid) DO UPDATE SET
        kind = excluded.kind, name = excluded.name, source_id = excluded.source_id,
        summary = excluded.summary, body_md = excluded.body_md, data_json = excluded.data_json,
        deleted_at = NULL, updated_at = CURRENT_TIMESTAMP
    `)
    const seen = new Set<string>()
    for (const e of dataset.entries) {
      const uid = buildUid(e.kind, e.name, e.book || 'srd')
      seen.add(uid)
      upsert.run(uid, e.kind, e.name, sourceId, e.summary, e.body, JSON.stringify(e.data))
    }

    // Entries dropped from a newer dataset are soft-deleted, so tokens still resolve to a name
    const stale = db
      .prepare('SELECT id, ref_uid FROM ref_entries WHERE source_id = ? AND deleted_at IS NULL')
      .all(sourceId) as Array<{ id: number, ref_uid: string }>
    const softDelete = db.prepare('UPDATE ref_entries SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?')
    for (const row of stale) {
      if (!seen.has(row.ref_uid)) softDelete.run(row.id)
    }
  })()
}

// ============================================================================
// Search
// ============================================================================

interface EntryRow {
  id: number
  ref_uid: string
  kind: string
  name: string
  summary: string | null
  source_code: string
}

const levenshtein = createLevenshtein()

function toSummary(row: EntryRow): CodexEntrySummary {
  return { uid: row.ref_uid, kind: row.kind, name: row.name, summary: row.summary, sourceCode: row.source_code }
}

/**
 * Prefix full-text search over name/summary/body, name matches first.
 * Falls back to typo-tolerant name matching when nothing matches ("firebal").
 */
export function searchCodex(
  db: Database.Database,
  query: string,
  options: { kind?: string, limit?: number } = {},
): CodexEntrySummary[] {
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 50)
  const q = slugify(query)
  if (!q) return []
  const kindFilter = options.kind ? 'AND e.kind = @kind' : ''
  const params = { q, kind: options.kind, limit }

  const terms = q.split(' ').filter(Boolean)
  const match = terms.map(t => `"${t.replace(/"/g, '""')}"*`).join(' ')
  const rows = db
    .prepare(
      `
      SELECT e.id, e.ref_uid, e.kind, e.name, e.summary, s.code AS source_code
      FROM ref_entries_fts f
      JOIN ref_entries e ON e.id = f.rowid
      JOIN ref_sources s ON s.id = e.source_id
      WHERE ref_entries_fts MATCH @match AND e.deleted_at IS NULL ${kindFilter}
      ORDER BY
        CASE
          WHEN lower(e.name) = @q THEN 0
          WHEN lower(e.name) LIKE @q || '%' THEN 1
          WHEN lower(e.name) LIKE '%' || @q || '%' THEN 2
          ELSE 3
        END,
        bm25(ref_entries_fts, 10.0, 2.0, 1.0),
        e.name
      LIMIT @limit
    `,
    )
    .all({ ...params, match }) as EntryRow[]
  if (rows.length > 0) return rows.map(toSummary)

  // Typo fallback: compare against names (and same-length name prefixes)
  const maxDistance = Math.max(1, Math.floor(q.length / 4))
  const all = db
    .prepare(
      `
      SELECT e.id, e.ref_uid, e.kind, e.name, e.summary, s.code AS source_code
      FROM ref_entries e JOIN ref_sources s ON s.id = e.source_id
      WHERE e.deleted_at IS NULL ${kindFilter}
    `,
    )
    .all(params) as EntryRow[]
  return all
    .map((row) => {
      const name = slugify(row.name)
      const distance = Math.min(levenshtein(q, name), levenshtein(q, name.slice(0, q.length)) + 1)
      return { row, distance }
    })
    .filter(r => r.distance <= maxDistance)
    .sort((a, b) => a.distance - b.distance || a.row.name.localeCompare(b.row.name))
    .slice(0, limit)
    .map(r => toSummary(r.row))
}

export function getCodexEntry(db: Database.Database, uid: string): CodexEntry | null {
  const row = db
    .prepare(
      `
      SELECT e.ref_uid, e.kind, e.name, e.summary, e.body_md, e.data_json, e.deleted_at,
             s.code AS source_code, s.title AS source_title, s.license, s.attribution
      FROM ref_entries e JOIN ref_sources s ON s.id = e.source_id
      WHERE e.ref_uid = ?
    `,
    )
    .get(uid) as
    | (EntryRow & { body_md: string | null, data_json: string | null, deleted_at: string | null, source_title: string, license: string, attribution: string | null })
    | undefined
  if (!row) return null
  return {
    uid: row.ref_uid,
    kind: row.kind,
    name: row.name,
    summary: row.summary,
    sourceCode: row.source_code,
    body: row.body_md,
    data: row.data_json ? JSON.parse(row.data_json) : null,
    externalUrl: bookmarkUrl(row.data_json) ?? externalUrl(row.ref_uid),
    sourceTitle: row.source_title,
    license: row.license,
    attribution: row.attribution,
    deletedAt: row.deleted_at,
  }
}

// ============================================================================
// Usage links ("Used in")
// ============================================================================

export type CodexOwnerType = 'session' | 'document' | 'entity' | 'encounter'

/** Mirrors syncSessionMentions: token links of one owner follow its markdown. */
export function syncRefLinks(
  db: Database.Database,
  campaignId: number,
  ownerType: CodexOwnerType,
  ownerId: number,
  markdown: string | null | undefined,
): void {
  const uids = new Set(extractCodexUids(markdown))
  const current = db
    .prepare('SELECT ref_uid FROM ref_links WHERE owner_type = ? AND owner_id = ? AND origin = \'token\'')
    .all(ownerType, ownerId) as Array<{ ref_uid: string }>
  const currentUids = new Set(current.map(r => r.ref_uid))

  const remove = db.prepare(
    'DELETE FROM ref_links WHERE owner_type = ? AND owner_id = ? AND ref_uid = ? AND origin = \'token\'',
  )
  const add = db.prepare(
    'INSERT OR IGNORE INTO ref_links (campaign_id, ref_uid, owner_type, owner_id, origin) VALUES (?, ?, ?, ?, \'token\')',
  )
  for (const uid of currentUids) {
    if (!uids.has(uid)) remove.run(ownerType, ownerId, uid)
  }
  for (const uid of uids) {
    if (!currentUids.has(uid)) add.run(campaignId, uid, ownerType, ownerId)
  }
}

export interface CodexUsage {
  ownerType: CodexOwnerType
  ownerId: number
  title: string
  entityId?: number
  entityType?: string
}

/** Sessions and entity documents in a campaign whose notes contain the reference. */
export function getCodexUsages(db: Database.Database, campaignId: number, uid: string): CodexUsage[] {
  const sessions = db
    .prepare(
      `
      SELECT s.id, s.title, s.session_number
      FROM ref_links l JOIN sessions s ON s.id = l.owner_id
      WHERE l.owner_type = 'session' AND l.campaign_id = ? AND l.ref_uid = ? AND s.deleted_at IS NULL
      ORDER BY s.session_number DESC, s.id DESC
    `,
    )
    .all(campaignId, uid) as Array<{ id: number, title: string | null, session_number: number | null }>
  const documents = db
    .prepare(
      `
      SELECT d.id, d.title, e.id AS entity_id, e.name AS entity_name, lower(t.name) AS entity_type
      FROM ref_links l
      JOIN entity_documents d ON d.id = l.owner_id
      JOIN entities e ON e.id = d.entity_id
      JOIN entity_types t ON t.id = e.type_id
      WHERE l.owner_type = 'document' AND l.campaign_id = ? AND l.ref_uid = ? AND e.deleted_at IS NULL
      ORDER BY e.name, d.title
    `,
    )
    .all(campaignId, uid) as Array<{ id: number, title: string, entity_id: number, entity_name: string, entity_type: string }>

  const entities = db
    .prepare(
      `
      SELECT e.id, e.name, lower(t.name) AS entity_type
      FROM ref_links l
      JOIN entities e ON e.id = l.owner_id
      JOIN entity_types t ON t.id = e.type_id
      WHERE l.owner_type = 'entity' AND l.campaign_id = ? AND l.ref_uid = ? AND e.deleted_at IS NULL
      ORDER BY e.name
    `,
    )
    .all(campaignId, uid) as Array<{ id: number, name: string, entity_type: string }>
  const encounters = db
    .prepare(
      `
      SELECT en.id, en.name
      FROM ref_links l JOIN encounters en ON en.id = l.owner_id
      WHERE l.owner_type = 'encounter' AND l.campaign_id = ? AND l.ref_uid = ? AND en.deleted_at IS NULL
      ORDER BY en.name
    `,
    )
    .all(campaignId, uid) as Array<{ id: number, name: string }>

  return [
    ...entities.map(e => ({
      ownerType: 'entity' as const,
      ownerId: e.id,
      title: e.name,
      entityId: e.id,
      entityType: e.entity_type,
    })),
    ...encounters.map(e => ({ ownerType: 'encounter' as const, ownerId: e.id, title: e.name })),
    ...sessions.map(s => ({
      ownerType: 'session' as const,
      ownerId: s.id,
      title: s.title || `#${s.session_number ?? s.id}`,
    })),
    ...documents.map(d => ({
      ownerType: 'document' as const,
      ownerId: d.id,
      title: `${d.entity_name}: ${d.title}`,
      entityId: d.entity_id,
      entityType: d.entity_type,
    })),
  ]
}

// ============================================================================
// Linked references (picked by hand on NPCs, locations, encounters ...)
// ============================================================================

export type CodexLinkOwnerType = 'entity' | 'encounter'

export interface CodexLinkedEntry extends CodexEntrySummary {
  /** false when the uid no longer resolves (e.g. a deleted bookmark) */
  available: boolean
}

/** Campaign of a link owner, or null when it does not exist. */
export function getLinkOwnerCampaign(db: Database.Database, ownerType: CodexLinkOwnerType, ownerId: number): number | null {
  const row = (
    ownerType === 'entity'
      ? db.prepare('SELECT campaign_id FROM entities WHERE id = ? AND deleted_at IS NULL').get(ownerId)
      : db.prepare('SELECT campaign_id FROM encounters WHERE id = ? AND deleted_at IS NULL').get(ownerId)
  ) as { campaign_id: number } | undefined
  return row?.campaign_id ?? null
}

export function listManualLinks(db: Database.Database, ownerType: CodexLinkOwnerType, ownerId: number): CodexLinkedEntry[] {
  const rows = db
    .prepare(
      `
      SELECT l.ref_uid, e.kind, e.name, e.summary, s.code AS source_code, e.deleted_at
      FROM ref_links l
      LEFT JOIN ref_entries e ON e.ref_uid = l.ref_uid
      LEFT JOIN ref_sources s ON s.id = e.source_id
      WHERE l.owner_type = ? AND l.owner_id = ? AND l.origin = 'manual'
      ORDER BY l.id
    `,
    )
    .all(ownerType, ownerId) as Array<{
    ref_uid: string
    kind: string | null
    name: string | null
    summary: string | null
    source_code: string | null
    deleted_at: string | null
  }>
  return rows.map((row) => {
    const parsed = parseUid(row.ref_uid)
    return {
      uid: row.ref_uid,
      kind: row.kind ?? parsed?.kind ?? 'rule',
      name: row.name ?? (parsed ? nameFromSlug(parsed.slug) : row.ref_uid),
      summary: row.summary,
      sourceCode: row.source_code ?? parsed?.source ?? '',
      available: row.name !== null && row.deleted_at === null,
    }
  })
}

export function addManualLink(
  db: Database.Database,
  campaignId: number,
  ownerType: CodexLinkOwnerType,
  ownerId: number,
  uid: string,
): void {
  db.prepare(
    'INSERT OR IGNORE INTO ref_links (campaign_id, ref_uid, owner_type, owner_id, origin) VALUES (?, ?, ?, ?, \'manual\')',
  ).run(campaignId, uid, ownerType, ownerId)
}

export function removeManualLink(db: Database.Database, ownerType: CodexLinkOwnerType, ownerId: number, uid: string): void {
  db.prepare('DELETE FROM ref_links WHERE owner_type = ? AND owner_id = ? AND ref_uid = ? AND origin = \'manual\'').run(
    ownerType,
    ownerId,
    uid,
  )
}

// ============================================================================
// Bookmarks: link-only entries for books we may not bundle (PHB, XGE ...).
// Only a name, the book code and a URL are stored - never rules text.
// ============================================================================

export const BOOKMARK_SOURCE = 'bookmark'

export interface BookmarkInput {
  kind: string
  name: string
  book: string
  url: string
}

export class BookmarkError extends Error {}

function bookmarkUrl(dataJson: string | null): string | null {
  if (!dataJson) return null
  try {
    const url = (JSON.parse(dataJson) as { url?: unknown }).url
    return typeof url === 'string' ? url : null
  }
  catch {
    return null
  }
}

function ensureBookmarkSource(db: Database.Database): number {
  const existing = db.prepare('SELECT id FROM ref_sources WHERE code = ?').get(BOOKMARK_SOURCE) as { id: number } | undefined
  if (existing) return existing.id
  return Number(
    db
      .prepare(
        `INSERT INTO ref_sources (code, title, license, attribution, origin)
         VALUES (?, 'Bookmarks', 'Link only (no text stored)', NULL, 'user')`,
      )
      .run(BOOKMARK_SOURCE).lastInsertRowid,
  )
}

/** Creates (or updates) a bookmark and returns it. Existing bundled entries are returned unchanged. */
export function saveBookmark(db: Database.Database, input: BookmarkInput): CodexEntrySummary {
  const name = String(input.name ?? '').trim().slice(0, 120)
  const book = String(input.book ?? '').trim().toLowerCase()
  const url = String(input.url ?? '').trim()
  if (!CODEX_KINDS.includes(input.kind as never)) throw new BookmarkError('Unknown kind')
  if (!slugify(name)) throw new BookmarkError('Name is required')
  if (!/^[a-z0-9]{1,12}$/.test(book)) throw new BookmarkError('Book code must be letters or digits, like XGE')
  let parsedUrl: URL
  try {
    parsedUrl = new URL(url)
  }
  catch {
    throw new BookmarkError('Link must be a web address')
  }
  if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') throw new BookmarkError('Link must be a web address')

  const uid = buildUid(input.kind, name, book)
  const sourceId = ensureBookmarkSource(db)
  const existing = db.prepare('SELECT source_id FROM ref_entries WHERE ref_uid = ?').get(uid) as { source_id: number } | undefined
  if (existing && existing.source_id !== sourceId) {
    // Already in a bundled dataset: nothing to bookmark
    const row = getCodexEntry(db, uid)!
    return { uid: row.uid, kind: row.kind, name: row.name, summary: row.summary, sourceCode: row.sourceCode }
  }
  db.prepare(
    `
    INSERT INTO ref_entries (ref_uid, kind, name, source_id, summary, body_md, data_json)
    VALUES (?, ?, ?, ?, NULL, NULL, ?)
    ON CONFLICT(ref_uid) DO UPDATE SET name = excluded.name, data_json = excluded.data_json,
      deleted_at = NULL, updated_at = CURRENT_TIMESTAMP
  `,
  ).run(uid, input.kind, name, sourceId, JSON.stringify({ url: parsedUrl.toString(), book }))
  return { uid, kind: input.kind, name, summary: null, sourceCode: BOOKMARK_SOURCE }
}

/** Removes a bookmark from search. Links and tokens keep working and show its name from the uid. */
export function deleteBookmark(db: Database.Database, uid: string): boolean {
  const result = db
    .prepare(
      `UPDATE ref_entries SET deleted_at = CURRENT_TIMESTAMP
       WHERE ref_uid = ? AND deleted_at IS NULL
         AND source_id = (SELECT id FROM ref_sources WHERE code = ?)`,
    )
    .run(uid, BOOKMARK_SOURCE)
  return result.changes > 0
}
