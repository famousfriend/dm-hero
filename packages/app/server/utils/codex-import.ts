import type Database from 'better-sqlite3'
import { CODEX_KINDS, buildUid, slugify } from '../../types/codex'
import { BOOKMARK_SOURCE, seedCodex, type CodexDataset } from './codex'
import { convertFiveETools, isFiveEToolsFile } from './codex-5etools'
import { CodexUserError, HOMEBREW_SOURCE } from './codex-user'

/*
 * Reference files the DM supplies (DM Command Center M9.2): our own dataset
 * format, or 5e.tools-style JSON (homebrew or data files). Each file becomes
 * one source with its own code, so its entries are addressed as
 * "spell:storm lance|mybrew" and can be removed together. Imported text stays
 * on this computer; it is never part of campaign exports.
 */

const RESERVED = new Set(['srd51', 'srd', HOMEBREW_SOURCE, BOOKMARK_SOURCE])
const MAX_ENTRIES = 20_000
const MAX_BODY = 100_000

export interface CodexSourceInfo {
  code: string
  title: string
  origin: string
  license: string
  entryCount: number
  importedAt: string
}

export interface ImportResult {
  code: string
  title: string
  imported: number
  /** Names already in the library from another source */
  alreadyThere: number
  /** Entries that couldn't be read */
  skipped: number
  /** Kinds of content the importer doesn't read (e.g. "class", "race") */
  ignored: string[]
}

export function listCodexSources(db: Database.Database): CodexSourceInfo[] {
  const rows = db.prepare(`
    SELECT s.code, s.title, s.origin, s.license, s.imported_at,
      (SELECT COUNT(*) FROM ref_entries e WHERE e.source_id = s.id AND e.deleted_at IS NULL) AS entry_count
    FROM ref_sources s ORDER BY s.origin = 'bundled' DESC, s.origin, s.title COLLATE NOCASE
  `).all() as Array<{ code: string, title: string, origin: string, license: string, imported_at: string, entry_count: number }>
  return rows.map(r => ({
    code: r.code,
    title: r.title,
    origin: r.origin,
    license: r.license,
    entryCount: r.entry_count,
    importedAt: r.imported_at,
  }))
}

/** "My Homebrew!" -> "myhomebrew"; codes go into uids, so letters and digits only */
const cleanCode = (value: unknown) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12)

function cleanEntries(entries: CodexDataset['entries'], code: string) {
  return entries
    .filter(e => CODEX_KINDS.includes(e.kind as never) && slugify(String(e.name ?? '')))
    .map(e => ({
      kind: e.kind,
      name: String(e.name).trim().slice(0, 120),
      book: code,
      summary: String(e.summary ?? '').slice(0, 200),
      body: String(e.body ?? '').slice(0, MAX_BODY),
      data: e.data && typeof e.data === 'object' ? e.data : {},
    }))
}

/**
 * Imports one file. `code` and `title` override what the file says.
 * Re-importing the same code updates that source: changed entries are
 * replaced and entries no longer in the file are removed from search.
 */
export function importCodexFile(db: Database.Database, json: unknown, options: { code?: unknown, title?: unknown } = {}): ImportResult {
  if (!json || typeof json !== 'object') throw new CodexUserError(400, 'The file is not JSON')
  const file = json as Record<string, unknown>

  let entries: CodexDataset['entries']
  let skipped = 0
  let ignored: string[] = []
  let fileCode = ''
  let fileTitle = ''
  let attribution: string | null = null

  if (Array.isArray(file.entries) && file.source && typeof file.source === 'object') {
    // Our own dataset format (like the bundled SRD file)
    const source = file.source as Record<string, unknown>
    entries = file.entries as CodexDataset['entries']
    fileCode = String(source.code ?? '')
    fileTitle = String(source.title ?? '')
    attribution = typeof source.attribution === 'string' ? source.attribution : null
  }
  else if (isFiveEToolsFile(file)) {
    const converted = convertFiveETools(file)
    entries = converted.entries
    skipped = converted.skipped
    ignored = converted.ignored
    fileCode = converted.meta.abbreviation ?? ''
    fileTitle = converted.meta.title ?? ''
    attribution = converted.meta.author ? `By ${converted.meta.author}` : null
  }
  else {
    throw new CodexUserError(400, 'No spells, monsters, items, feats or conditions found in this file')
  }

  const code = cleanCode(options.code) || cleanCode(fileCode)
  if (!code) throw new CodexUserError(400, 'Give the import a short code, like MYBREW')
  if (RESERVED.has(code)) throw new CodexUserError(400, `"${code}" is already used by the app; choose another code`)
  const existing = db.prepare('SELECT origin FROM ref_sources WHERE code = ?').get(code) as { origin: string } | undefined
  if (existing && existing.origin !== 'import') throw new CodexUserError(400, `"${code}" is already used by the app; choose another code`)
  if (entries.length > MAX_ENTRIES) throw new CodexUserError(400, `Too many entries (more than ${MAX_ENTRIES})`)

  const clean = cleanEntries(entries, code)
  skipped += entries.length - clean.length

  // Never take over an entry that belongs to another source (e.g. SRD Fireball)
  const owner = db.prepare(`
    SELECT s.code FROM ref_entries e JOIN ref_sources s ON s.id = e.source_id
    WHERE e.ref_uid = ? AND e.deleted_at IS NULL
  `)
  const seen = new Set<string>()
  const own = clean.filter((e) => {
    const uid = buildUid(e.kind, e.name, code)
    if (seen.has(uid)) return false
    seen.add(uid)
    const row = owner.get(uid) as { code: string } | undefined
    return !row || row.code === code
  })
  const alreadyThere = seen.size - own.length
  if (!own.length) throw new CodexUserError(400, 'Nothing new to import from this file')

  const title = String(options.title ?? '').trim().slice(0, 120) || fileTitle.trim().slice(0, 120) || code.toUpperCase()
  seedCodex(db, {
    source: { code, title, license: 'Stays on this computer', attribution: attribution ?? '' },
    entries: own,
  }, 'import')
  return { code, title, imported: own.length, alreadyThere, skipped, ignored }
}

/** Removes an imported source and its entries. Links and tokens keep showing the names. */
export function deleteImportedSource(db: Database.Database, code: string): void {
  const source = db.prepare('SELECT id, origin FROM ref_sources WHERE code = ?').get(code) as { id: number, origin: string } | undefined
  if (!source || source.origin !== 'import') throw new CodexUserError(404, 'Import not found')
  db.transaction(() => {
    db.prepare('DELETE FROM ref_entries WHERE source_id = ?').run(source.id)
    db.prepare('DELETE FROM ref_sources WHERE id = ?').run(source.id)
  })()
}

/**
 * GET    /api/codex/sources                  every source with its entry count
 * POST   /api/codex/import { data, code?, title? }
 * DELETE /api/codex/sources?code=            remove an import
 * Returns undefined for other paths (handled by handleCodexUserRequest).
 */
export function handleCodexImportRequest(
  db: Database.Database,
  request: { method: string, segments: string[], query: Record<string, unknown>, body: Record<string, unknown> | null },
): unknown {
  const route = `${request.method} ${request.segments.join('/')}`
  if (route === 'GET sources') return listCodexSources(db)
  if (route === 'POST import') {
    const body = request.body ?? {}
    return importCodexFile(db, body.data, { code: body.code, title: body.title })
  }
  if (route === 'DELETE sources') {
    deleteImportedSource(db, String(request.query.code ?? ''))
    return { success: true }
  }
  return undefined
}
