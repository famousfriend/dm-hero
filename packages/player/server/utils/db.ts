import Database from 'better-sqlite3'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { runMigrations } from './migrations'

// Electron sets DATABASE_PATH to the app's own data folder; dev uses ./data
export function getDatabasePath(): string {
  return process.env.DATABASE_PATH || join(process.cwd(), 'data', 'player-companion.db')
}

let db: Database.Database | null = null

export function openDb(path: string): Database.Database {
  if (path !== ':memory:' && !existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true })
  const database = new Database(path)
  database.pragma('journal_mode = WAL')
  database.pragma('foreign_keys = ON')
  database.pragma('busy_timeout = 5000')
  runMigrations(database)
  return database
}

export function getDb(): Database.Database {
  if (!db) db = openDb(getDatabasePath())
  return db
}
