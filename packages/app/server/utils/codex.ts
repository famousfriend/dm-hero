import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'
import srdDataset from '../codex-data/srd-5.1.json'
import { createLevenshtein } from './levenshtein'
import {
  buildUid,
  externalUrl,
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
export function seedCodex(db: Database.Database, dataset: CodexDataset = srdDataset as CodexDataset): void {
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
             VALUES (?, ?, ?, ?, 'bundled', ?)`,
          )
          .run(code, title, license, attribution, version).lastInsertRowid,
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
      SELECT e.ref_uid, e.kind, e.name, e.summary, e.body_md, e.data_json,
             s.code AS source_code, s.title AS source_title, s.license, s.attribution
      FROM ref_entries e JOIN ref_sources s ON s.id = e.source_id
      WHERE e.ref_uid = ?
    `,
    )
    .get(uid) as
    | (EntryRow & { body_md: string | null, data_json: string | null, source_title: string, license: string, attribution: string | null })
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
    externalUrl: externalUrl(row.ref_uid),
    sourceTitle: row.source_title,
    license: row.license,
    attribution: row.attribution,
  }
}

// ============================================================================
// Usage links ("Used in")
// ============================================================================

export type CodexOwnerType = 'session' | 'document'

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

  return [
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
