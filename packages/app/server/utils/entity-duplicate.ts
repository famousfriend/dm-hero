import type Database from 'better-sqlite3'
import { copyFileSync, existsSync } from 'fs'
import { basename, dirname, extname, join } from 'path'

/*
 * Duplicate (DM Command Center M8): copies an NPC, location, item, faction,
 * lore entry or player inside the same campaign, or a prepared fight.
 */

export class DuplicateError extends Error {}

const NAME_MAX = 200

/** Copies an uploaded file next to the original; returns the new relative path (or the old one if it's missing). */
function copyUpload(uploadsDir: string, relativePath: string | null): string | null {
  if (!relativePath) return relativePath
  const source = join(uploadsDir, relativePath)
  if (!existsSync(source)) return relativePath
  const ext = extname(relativePath)
  const stem = basename(relativePath, ext)
  const folder = dirname(relativePath)
  let target = ''
  for (let n = 0; !target || existsSync(join(uploadsDir, target)); n++) {
    const file = `${stem}-copy-${Date.now()}${n ? `-${n}` : ''}${ext}`
    target = folder === '.' ? file : `${folder}/${file}`
  }
  copyFileSync(source, join(uploadsDir, target))
  return target
}

const cleanName = (name: unknown, fallback: string) => {
  const text = typeof name === 'string' ? name.trim().slice(0, NAME_MAX) : ''
  return text || fallback.slice(0, NAME_MAX)
}

interface EntityRow {
  id: number
  type_id: number
  campaign_id: number
  name: string
  description: string | null
  metadata: string | null
  image_url: string | null
  parent_entity_id: number | null
  location_id: number | null
  folder_id: number | null
}

interface ImageRow {
  image_url: string | null
  caption: string | null
  is_primary: number
  display_order: number
}

interface DocumentRow {
  title: string
  content: string | null
  date: string
  sort_order: number
  file_path: string | null
  file_type: string | null
  document_type: string | null
}

/**
 * Copies an entity with its stats, tags, relations, pictures, documents,
 * group memberships and reference links. History (sessions, calendar,
 * continuity, maps) stays with the original. Returns the new entity id.
 */
export function duplicateEntity(db: Database.Database, uploadsDir: string, entityId: number, name?: string): number {
  const entity = db
    .prepare('SELECT * FROM entities WHERE id = ? AND deleted_at IS NULL')
    .get(entityId) as EntityRow | undefined
  if (!entity) throw new DuplicateError('Not found')

  // Files first: a failed copy leaves nothing half-written in the database
  const imageUrl = copyUpload(uploadsDir, entity.image_url)
  const images = (db.prepare('SELECT * FROM entity_images WHERE entity_id = ? ORDER BY display_order').all(entityId) as ImageRow[])
    .map(img => ({ ...img, image_url: copyUpload(uploadsDir, img.image_url) }))
  const documents = (db.prepare('SELECT * FROM entity_documents WHERE entity_id = ? ORDER BY sort_order').all(entityId) as DocumentRow[])
    .map(doc => ({ ...doc, file_path: copyUpload(uploadsDir, doc.file_path) }))

  return db.transaction(() => {
    // One INSERT with every column (the entities_fts index doesn't like a second write in the same transaction)
    const newId = Number(
      db.prepare(`
        INSERT INTO entities (type_id, campaign_id, name, description, metadata, image_url, parent_entity_id, location_id, folder_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        entity.type_id,
        entity.campaign_id,
        cleanName(name, `${entity.name} (copy)`),
        entity.description,
        entity.metadata,
        imageUrl,
        entity.parent_entity_id,
        entity.location_id,
        entity.folder_id,
      ).lastInsertRowid,
    )

    db.prepare(`
      INSERT INTO entity_stats (entity_id, template_id, values_json)
      SELECT ?, template_id, values_json FROM entity_stats WHERE entity_id = ?
    `).run(newId, entityId)
    db.prepare('INSERT INTO entity_tags (entity_id, tag_id) SELECT ?, tag_id FROM entity_tags WHERE entity_id = ?').run(newId, entityId)
    // Relations both ways ("lives in", "member of", "knows" ...), not to itself
    db.prepare(`
      INSERT INTO entity_relations (from_entity_id, to_entity_id, relation_type, notes)
      SELECT ?, to_entity_id, relation_type, notes FROM entity_relations WHERE from_entity_id = ? AND to_entity_id != ?
    `).run(newId, entityId, entityId)
    db.prepare(`
      INSERT INTO entity_relations (from_entity_id, to_entity_id, relation_type, notes)
      SELECT from_entity_id, ?, relation_type, notes FROM entity_relations WHERE to_entity_id = ? AND from_entity_id != ?
    `).run(newId, entityId, entityId)
    db.prepare('INSERT INTO entity_group_members (group_id, entity_id) SELECT group_id, ? FROM entity_group_members WHERE entity_id = ?').run(newId, entityId)
    db.prepare(`
      INSERT INTO ref_links (campaign_id, ref_uid, owner_type, owner_id, origin)
      SELECT campaign_id, ref_uid, owner_type, ?, origin FROM ref_links WHERE owner_type = 'entity' AND owner_id = ?
    `).run(newId, entityId)

    const insertImage = db.prepare('INSERT INTO entity_images (entity_id, image_url, caption, is_primary, display_order) VALUES (?, ?, ?, ?, ?)')
    for (const img of images) insertImage.run(newId, img.image_url, img.caption, img.is_primary, img.display_order)
    const insertDoc = db.prepare(`
      INSERT INTO entity_documents (entity_id, title, content, date, sort_order, file_path, file_type, document_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (const doc of documents) {
      insertDoc.run(newId, doc.title, doc.content, doc.date, doc.sort_order, doc.file_path, doc.file_type, doc.document_type)
    }
    return newId
  })()
}

/**
 * Copies a fight as a fresh one to prepare again: same participants with
 * full HP and their abilities restored, no initiative, effects or log.
 */
export function duplicateEncounter(db: Database.Database, encounterId: number, name?: string): number {
  const encounter = db
    .prepare('SELECT id, campaign_id, session_id, name FROM encounters WHERE id = ? AND deleted_at IS NULL')
    .get(encounterId) as { id: number, campaign_id: number, session_id: number | null, name: string } | undefined
  if (!encounter) throw new DuplicateError('Not found')

  return db.transaction(() => {
    const newId = Number(
      db.prepare(`
        INSERT INTO encounters (campaign_id, session_id, name, status, round, current_turn_index)
        VALUES (?, ?, ?, 'setup', 0, 0)
      `).run(encounter.campaign_id, encounter.session_id, cleanName(name, `${encounter.name} (copy)`)).lastInsertRowid,
    )
    const participants = db
      .prepare('SELECT * FROM encounter_participants WHERE encounter_id = ? ORDER BY sort_order')
      .all(encounterId) as Array<Record<string, unknown>>
    const insert = db.prepare(`
      INSERT INTO encounter_participants
        (encounter_id, entity_id, ref_uid, display_name, duplicate_index, current_hp, max_hp, armor_class, sort_order, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const copyResources = db.prepare(`
      INSERT INTO encounter_resources (participant_id, name, kind, max_uses, used, recharge_min, sort_order)
      SELECT ?, name, kind, max_uses, 0, recharge_min, sort_order FROM encounter_resources WHERE participant_id = ?
    `)
    for (const p of participants) {
      const maxHp = Number(p.max_hp) || 0
      const participantId = insert.run(
        newId,
        p.entity_id,
        p.ref_uid,
        p.display_name,
        p.duplicate_index,
        maxHp > 0 ? maxHp : p.current_hp,
        maxHp,
        p.armor_class,
        p.sort_order,
        p.notes,
      ).lastInsertRowid
      copyResources.run(participantId, p.id)
    }
    db.prepare(`
      INSERT INTO ref_links (campaign_id, ref_uid, owner_type, owner_id, origin)
      SELECT campaign_id, ref_uid, owner_type, ?, origin FROM ref_links WHERE owner_type = 'encounter' AND owner_id = ?
    `).run(newId, encounterId)
    return newId
  })()
}
