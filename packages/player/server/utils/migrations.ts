import type Database from 'better-sqlite3'

interface Migration {
  version: number
  up: (db: Database.Database) => void
}

const migrations: Migration[] = [
  {
    version: 1,
    up: (db) => {
      db.exec(`
        CREATE TABLE campaigns (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          dm_name TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE characters (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          campaign_id INTEGER REFERENCES campaigns(id) ON DELETE SET NULL,
          ddb_character_id TEXT,
          -- LayeredRecord<PlayerSheet> as JSON: source / local / dm per field
          values_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
      `)
    },
  },
]

export function runMigrations(db: Database.Database) {
  const current = db.pragma('user_version', { simple: true }) as number
  for (const migration of migrations) {
    if (migration.version <= current) continue
    db.transaction(() => {
      migration.up(db)
      db.pragma(`user_version = ${migration.version}`)
    })()
  }
}
