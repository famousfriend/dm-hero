import type Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { MAX_RECAP_FILE_BYTES, fileExtension, isAllowedRecapFile, type RecapFile, type SessionRecap } from '../../types/recaps'

export class RecapInputError extends Error {}

const MAX_RECAP_LENGTH = 500_000

interface RecapFileRow {
  id: number
  session_id: number
  file_name: string
  stored_name: string
  size_bytes: number
  created_at: string
}

interface SessionRow {
  id: number
  session_number: number | null
  title: string
  date: string | null
  recap: string | null
}

const toFile = (row: RecapFileRow): RecapFile => ({
  id: row.id,
  sessionId: row.session_id,
  fileName: row.file_name,
  storedName: row.stored_name,
  sizeBytes: row.size_bytes,
  createdAt: row.created_at,
})

function filesBySession(db: Database.Database, sessionIds: number[]) {
  const result = new Map<number, RecapFile[]>()
  if (!sessionIds.length) return result
  const rows = db.prepare(`
    SELECT * FROM session_recap_files
    WHERE session_id IN (${sessionIds.map(() => '?').join(',')})
    ORDER BY created_at, id
  `).all(...sessionIds) as RecapFileRow[]
  for (const row of rows) {
    const list = result.get(row.session_id) ?? []
    list.push(toFile(row))
    result.set(row.session_id, list)
  }
  return result
}

function getSession(db: Database.Database, sessionId: number) {
  const session = db.prepare(`
    SELECT id, session_number, title, date, recap FROM sessions WHERE id = ? AND deleted_at IS NULL
  `).get(sessionId) as SessionRow | undefined
  if (!session) throw new RecapInputError('Session not found')
  return session
}

const toRecap = (session: SessionRow, files: RecapFile[]): SessionRecap => ({
  sessionId: session.id,
  sessionNumber: session.session_number,
  title: session.title,
  date: session.date,
  recap: session.recap,
  files,
})

/** Every session of a campaign with its recap, newest first */
export function listRecaps(db: Database.Database, campaignId: number): SessionRecap[] {
  const sessions = db.prepare(`
    SELECT id, session_number, title, date, recap FROM sessions
    WHERE campaign_id = ? AND deleted_at IS NULL
    ORDER BY session_number DESC, date DESC, id DESC
  `).all(campaignId) as SessionRow[]
  const files = filesBySession(db, sessions.map(s => s.id))
  return sessions.map(s => toRecap(s, files.get(s.id) ?? []))
}

export function getRecap(db: Database.Database, sessionId: number): SessionRecap {
  const session = getSession(db, sessionId)
  return toRecap(session, filesBySession(db, [sessionId]).get(sessionId) ?? [])
}

export function updateRecap(db: Database.Database, sessionId: number, recap: unknown): SessionRecap {
  getSession(db, sessionId)
  if (recap !== null && typeof recap !== 'string') throw new RecapInputError('Recap must be text')
  if (typeof recap === 'string' && recap.length > MAX_RECAP_LENGTH) throw new RecapInputError('Recap is too long')
  const value = typeof recap === 'string' && recap.trim() ? recap : null
  db.prepare('UPDATE sessions SET recap = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(value, sessionId)
  return getRecap(db, sessionId)
}

/** Saves an uploaded recap file ({ fileName, data: base64 }) into uploads/recaps/ */
export function addRecapFile(db: Database.Database, uploadDir: string, sessionId: number, input: Record<string, unknown>): RecapFile {
  getSession(db, sessionId)
  const fileName = typeof input.fileName === 'string' ? input.fileName.replace(/[\\/]/g, '_').trim().slice(0, 200) : ''
  if (!fileName) throw new RecapInputError('File name is required')
  if (!isAllowedRecapFile(fileName)) throw new RecapInputError('This file type is not supported')
  if (typeof input.data !== 'string' || !input.data) throw new RecapInputError('File is empty')
  const data = Buffer.from(input.data, 'base64')
  if (!data.length) throw new RecapInputError('File is empty')
  if (data.length > MAX_RECAP_FILE_BYTES) throw new RecapInputError('File is too large')

  const storedName = `recaps/${randomUUID()}${fileExtension(fileName)}`
  mkdirSync(join(uploadDir, 'recaps'), { recursive: true })
  writeFileSync(join(uploadDir, storedName), data)
  const id = Number(db.prepare(`
    INSERT INTO session_recap_files (session_id, file_name, stored_name, size_bytes) VALUES (?, ?, ?, ?)
  `).run(sessionId, fileName, storedName, data.length).lastInsertRowid)
  return toFile(db.prepare('SELECT * FROM session_recap_files WHERE id = ?').get(id) as RecapFileRow)
}

export function deleteRecapFile(db: Database.Database, uploadDir: string, fileId: number): boolean {
  const row = db.prepare('SELECT * FROM session_recap_files WHERE id = ?').get(fileId) as RecapFileRow | undefined
  if (!row) return false
  db.prepare('DELETE FROM session_recap_files WHERE id = ?').run(fileId)
  try {
    unlinkSync(join(uploadDir, row.stored_name))
  }
  catch {
    // Already gone - nothing to clean up
  }
  return true
}
