import Database from 'better-sqlite3'
import { basename, dirname, join } from 'path'
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, copyFileSync } from 'fs'
import { getDatabasePath } from './paths'

const DB_PATH = getDatabasePath()
const DB_DIR = dirname(DB_PATH)
const BACKUP_DIR = join(DB_DIR, 'backups')

/** Automatic backups kept on disk; older ones are pruned after each new backup */
export const MAX_BACKUPS = 20
/** Only files matching this are listed, rotated or restorable - nothing else in the folder is touched */
const BACKUP_FILE_REGEX = /^dm-hero-[\w-]+\.db$/

// Ensure directories exist
if (!existsSync(DB_DIR)) {
  mkdirSync(DB_DIR, { recursive: true })
}
if (!existsSync(BACKUP_DIR)) {
  mkdirSync(BACKUP_DIR, { recursive: true })
}

let db: Database.Database | null = null

export function getDb() {
  if (!db) {
    db = new Database(DB_PATH)
    db.pragma('journal_mode = WAL') // Write-Ahead Logging for better performance
    db.pragma('foreign_keys = ON') // Enable foreign keys
    // Wait instead of throwing SQLITE_BUSY when another process/connection holds
    // a write lock — the dev server spins up two DB connections and they can
    // race on migrations (see runMigrations' BEGIN IMMEDIATE).
    db.pragma('busy_timeout = 5000')
  }
  return db
}

export function getBackupDir() {
  return BACKUP_DIR
}

/**
 * Write a consistent snapshot of `database` to `targetPath`.
 * In WAL mode the newest data lives in the -wal file, so copying the .db file
 * alone can miss everything since the last checkpoint. VACUUM INTO reads through
 * the connection and writes one self-contained file instead.
 */
export function snapshotDatabase(database: Database.Database, targetPath: string) {
  if (existsSync(targetPath)) rmSync(targetPath) // VACUUM INTO refuses to overwrite
  database.prepare('VACUUM INTO ?').run(targetPath)
}

export function createBackup(database?: Database.Database) {
  if (!database && !existsSync(DB_PATH)) {
    console.log('No database to backup yet.')
    return null
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupPath = join(BACKUP_DIR, `dm-hero-${timestamp}.db`)

  try {
    snapshotDatabase(database ?? getDb(), backupPath)
    console.log(`✅ Backup created: ${backupPath}`)
    pruneBackups()
    return backupPath
  }
  catch (error) {
    console.error('❌ Backup failed:', error)
    return null
  }
}

export interface BackupInfo {
  name: string
  size: number
  createdAt: string
}

/** Backups in the backup folder, newest first */
export function listBackups(): BackupInfo[] {
  if (!existsSync(BACKUP_DIR)) return []
  return readdirSync(BACKUP_DIR)
    .filter(name => BACKUP_FILE_REGEX.test(name))
    .map((name) => {
      const stat = statSync(join(BACKUP_DIR, name))
      return { name, size: stat.size, createdAt: stat.mtime.toISOString() }
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.name.localeCompare(a.name))
}

/** Keep the newest MAX_BACKUPS backups, delete the rest */
export function pruneBackups(keep = MAX_BACKUPS) {
  for (const old of listBackups().slice(keep)) {
    try {
      rmSync(join(BACKUP_DIR, old.name))
    }
    catch (error) {
      console.error(`❌ Could not delete old backup ${old.name}:`, error)
    }
  }
}

/** Resolve a backup name from the API to a path inside the backup folder, or null */
export function resolveBackupPath(name: string): string | null {
  if (typeof name !== 'string' || basename(name) !== name || !BACKUP_FILE_REGEX.test(name)) return null
  const path = join(BACKUP_DIR, name)
  return existsSync(path) ? path : null
}

/**
 * Open a candidate database read-only and check it is a healthy DM Hero database.
 * Returns the schema version on success, or an error message.
 */
export function checkDatabaseFile(path: string): { ok: true, version: number } | { ok: false, error: string } {
  let candidate: Database.Database | null = null
  try {
    candidate = new Database(path, { readonly: true, fileMustExist: true })
    const result = candidate.pragma('integrity_check', { simple: true })
    if (result !== 'ok') return { ok: false, error: `Integrity check failed: ${String(result)}` }
    const hasCampaigns = candidate
      .prepare('SELECT 1 FROM sqlite_master WHERE type = \'table\' AND name = \'campaigns\'')
      .get()
    if (!hasCampaigns) return { ok: false, error: 'Not a DM Hero database' }
    return { ok: true, version: getCurrentVersion(candidate) }
  }
  catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
  finally {
    candidate?.close()
  }
}

/**
 * Replace the live database with a backup file.
 * The current database is backed up first, so a restore can itself be undone.
 * The caller must run migrations afterwards (the backup may be older).
 */
export function restoreDatabaseFrom(sourcePath: string): { safetyBackup: string | null } {
  const check = checkDatabaseFile(sourcePath)
  if (!check.ok) throw new Error(check.error)

  const safetyBackup = createBackup()
  if (!safetyBackup) throw new Error('Could not back up the current database before restoring')

  // Copy into a temp file next to the DB first, then swap it in with a rename,
  // so a failed copy never leaves a half-written database behind
  const tempPath = `${DB_PATH}.restore-tmp`
  copyFileSync(sourcePath, tempPath)

  closeDb()
  try {
    for (const suffix of ['-wal', '-shm']) {
      if (existsSync(DB_PATH + suffix)) rmSync(DB_PATH + suffix)
    }
    renameSync(tempPath, DB_PATH)
  }
  finally {
    if (existsSync(tempPath)) rmSync(tempPath)
    getDb()
  }
  return { safetyBackup }
}

export function closeDb() {
  if (db) {
    db.close()
    db = null
  }
}

export function getCurrentVersion(database: Database.Database): number {
  try {
    const result = database
      .prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')
      .get() as { version: number } | undefined
    return result?.version || 0
  }
  catch {
    // Table doesn't exist yet
    return 0
  }
}

export function setVersion(database: Database.Database, version: number) {
  database
    .prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)')
    .run(version, new Date().toISOString())
}
