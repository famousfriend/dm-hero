import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import Database from 'better-sqlite3'

// Backups of the live (WAL-mode) database file - real files in a temp folder
let dir: string
let dbModule: typeof import('../../server/utils/db')
let migrationsModule: typeof import('../../server/utils/migrations')

function countNpcs(path: string, name: string) {
  const db = new Database(path, { readonly: true })
  try {
    return (db.prepare('SELECT COUNT(*) AS n FROM entities WHERE name = ?').get(name) as { n: number }).n
  }
  finally {
    db.close()
  }
}

function addNpc(name: string) {
  const db = dbModule.getDb()
  const campaignId = db.prepare('INSERT INTO campaigns (name) VALUES (?)').run('Backup Test').lastInsertRowid
  db.prepare('INSERT INTO entities (type_id, campaign_id, name) VALUES (1, ?, ?)').run(campaignId, name)
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'dm-hero-backup-'))
  vi.stubEnv('DATABASE_PATH', join(dir, 'dm-hero.db'))
  vi.resetModules()
  dbModule = await import('../../server/utils/db')
  migrationsModule = await import('../../server/utils/migrations')
  const db = dbModule.getDb()
  await migrationsModule.runMigrations(db)
  // Keep everything in the -wal file, like a busy app between checkpoints
  db.pragma('wal_autocheckpoint = 0')
  db.pragma('wal_checkpoint(TRUNCATE)')
})

afterAll(() => {
  dbModule.closeDb()
  vi.unstubAllEnvs()
  rmSync(dir, { recursive: true, force: true })
})

describe('createBackup', () => {
  it('contains data that is still only in the WAL file', () => {
    addNpc('Wal Only')

    // The old approach (copying the .db file) misses it
    const rawCopy = join(dir, 'raw-copy.db')
    copyFileSync(join(dir, 'dm-hero.db'), rawCopy)
    expect(countNpcs(rawCopy, 'Wal Only')).toBe(0)

    const backupPath = dbModule.createBackup()
    expect(backupPath).toBeTruthy()
    expect(countNpcs(backupPath!, 'Wal Only')).toBe(1)
  })

  it('produces a file that passes the integrity check', () => {
    const backupPath = dbModule.createBackup()!
    const check = dbModule.checkDatabaseFile(backupPath)
    expect(check.ok).toBe(true)
    if (check.ok) expect(check.version).toBe(migrationsModule.migrations.at(-1)!.version)
  })

  it('keeps only the newest backups', () => {
    for (let i = 0; i < 5; i++) dbModule.createBackup()
    dbModule.pruneBackups(3)
    const files = readdirSync(dbModule.getBackupDir()).filter(f => f.endsWith('.db'))
    expect(files).toHaveLength(3)
    expect(dbModule.listBackups().map(b => b.name).sort()).toEqual(files.sort())
  })
})

describe('resolveBackupPath', () => {
  it('only accepts backup names inside the backup folder', () => {
    const [newest] = dbModule.listBackups()
    expect(dbModule.resolveBackupPath(newest!.name)).toBe(join(dbModule.getBackupDir(), newest!.name))
    for (const bad of ['../dm-hero.db', '..\\dm-hero.db', 'dm-hero.db', '/etc/passwd', 'dm-hero-x.txt', 'dm-hero-missing.db', '']) {
      expect(dbModule.resolveBackupPath(bad)).toBeNull()
    }
  })
})

describe('checkDatabaseFile', () => {
  it('rejects files that are not healthy DM Hero databases', () => {
    const garbage = join(dir, 'garbage.db')
    writeFileSync(garbage, 'definitely not sqlite')
    expect(dbModule.checkDatabaseFile(garbage).ok).toBe(false)

    const other = join(dir, 'other.db')
    new Database(other).exec('CREATE TABLE notes (id INTEGER)')
    expect(dbModule.checkDatabaseFile(other)).toEqual({ ok: false, error: 'Not a DM Hero database' })
  })
})

describe('restoreDatabaseFrom', () => {
  it('replaces the live database and keeps a safety backup of the replaced state', () => {
    const backupPath = dbModule.createBackup()!
    addNpc('After Backup')

    const { safetyBackup } = dbModule.restoreDatabaseFrom(backupPath)

    const live = dbModule.getDb()
    expect((live.prepare('SELECT COUNT(*) AS n FROM entities WHERE name = ?').get('After Backup') as { n: number }).n).toBe(0)
    expect((live.prepare('SELECT COUNT(*) AS n FROM entities WHERE name = ?').get('Wal Only') as { n: number }).n).toBe(1)
    expect(countNpcs(safetyBackup!, 'After Backup')).toBe(1)
    expect(existsSync(join(dir, 'dm-hero.db.restore-tmp'))).toBe(false)
  })

  it('refuses a broken file and leaves the live database untouched', () => {
    const garbage = join(dir, 'garbage.db')
    addNpc('Still Here')
    expect(() => dbModule.restoreDatabaseFrom(garbage)).toThrow()
    const live = dbModule.getDb()
    expect((live.prepare('SELECT COUNT(*) AS n FROM entities WHERE name = ?').get('Still Here') as { n: number }).n).toBe(1)
  })
})
