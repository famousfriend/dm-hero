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
  {
    // Journal: notes, places and NPCs per character (see character-core/src/journal.ts)
    version: 2,
    up: (db) => {
      db.exec(`
        CREATE TABLE notes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
          title TEXT NOT NULL DEFAULT '',
          body TEXT NOT NULL DEFAULT '',
          visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'party')),
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX idx_notes_character ON notes(character_id);
        CREATE TABLE places (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
          source TEXT NOT NULL DEFAULT 'player' CHECK (source IN ('player', 'dm')),
          name TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          player_notes TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX idx_places_character ON places(character_id);
        CREATE TABLE npcs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
          place_id INTEGER REFERENCES places(id) ON DELETE SET NULL,
          source TEXT NOT NULL DEFAULT 'player' CHECK (source IN ('player', 'dm')),
          name TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          player_notes TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX idx_npcs_character ON npcs(character_id);
      `)
    },
  },
  {
    // Player packs from DM Command Center: dm_ref is the DM's stable reference,
    // so importing a newer pack updates entries instead of duplicating them
    version: 3,
    up: (db) => {
      db.exec(`
        ALTER TABLE campaigns ADD COLUMN dm_ref TEXT;
        CREATE UNIQUE INDEX idx_campaigns_dm_ref ON campaigns(dm_ref) WHERE dm_ref IS NOT NULL;
        ALTER TABLE places ADD COLUMN dm_ref TEXT;
        CREATE UNIQUE INDEX idx_places_dm_ref ON places(character_id, dm_ref) WHERE dm_ref IS NOT NULL;
        ALTER TABLE npcs ADD COLUMN dm_ref TEXT;
        CREATE UNIQUE INDEX idx_npcs_dm_ref ON npcs(character_id, dm_ref) WHERE dm_ref IS NOT NULL;
        CREATE TABLE quests (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
          dm_ref TEXT NOT NULL,
          name TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'active', 'done', 'failed')),
          reward TEXT NOT NULL DEFAULT '',
          player_notes TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE (character_id, dm_ref)
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
