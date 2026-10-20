import type Database from 'better-sqlite3'
import type { CopyableEntityType, EntityTemplate } from '~~/types/entity-template'
import { DuplicateError, duplicateEntity } from './entity-duplicate'

/*
 * Entity templates (DM Command Center M8.2): save an NPC, location, item,
 * faction or lore entry as a reusable starting point, create new entries from
 * it, and mark one per type as the default that fills the empty fields of
 * every new entry of that type. Templates are shared by all campaigns.
 */

export const TEMPLATE_TYPES = {
  npc: 'NPC',
  location: 'Location',
  item: 'Item',
  faction: 'Faction',
  lore: 'Lore',
} as const satisfies Record<CopyableEntityType, string>
export type TemplateType = CopyableEntityType

export class TemplateError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message)
  }
}

interface TemplateRow {
  id: number
  type_id: number
  type_name: string
  name: string
  description: string | null
  metadata: string | null
  stat_template_id: number | null
  stat_values_json: string | null
  tag_ids_json: string | null
  is_default: number
  created_at: string
}

const TEMPLATE_SELECT = `
  SELECT t.*, et.name AS type_name FROM entity_templates t
  JOIN entity_types et ON et.id = t.type_id`

const typeKeyOf = (typeName: string) =>
  (Object.keys(TEMPLATE_TYPES) as TemplateType[]).find(k => TEMPLATE_TYPES[k] === typeName)

function parseJson<T>(text: string | null, fallback: T): T {
  if (!text) return fallback
  try {
    return JSON.parse(text) as T
  }
  catch {
    return fallback
  }
}

function toTemplate(row: TemplateRow): EntityTemplate {
  return {
    id: row.id,
    type: typeKeyOf(row.type_name)!,
    name: row.name,
    description: row.description,
    metadata: parseJson(row.metadata, null),
    isDefault: row.is_default === 1,
    hasStats: row.stat_template_id !== null,
    tagCount: parseJson<number[]>(row.tag_ids_json, []).length,
    createdAt: row.created_at,
  }
}

function typeIdOf(db: Database.Database, type: unknown): number {
  const typeName = TEMPLATE_TYPES[type as TemplateType]
  if (!typeName) throw new TemplateError(400, 'Unknown type')
  return (db.prepare('SELECT id FROM entity_types WHERE name = ?').get(typeName) as { id: number }).id
}

function getRow(db: Database.Database, id: number): TemplateRow {
  const row = db.prepare(`${TEMPLATE_SELECT} WHERE t.id = ?`).get(id) as TemplateRow | undefined
  if (!row) throw new TemplateError(404, 'Template not found')
  return row
}

const cleanName = (name: unknown) => (typeof name === 'string' ? name.trim().slice(0, 200) : '')

export function listTemplates(db: Database.Database, type: TemplateType): EntityTemplate[] {
  const rows = db
    .prepare(`${TEMPLATE_SELECT} WHERE t.type_id = ? ORDER BY t.is_default DESC, t.name COLLATE NOCASE`)
    .all(typeIdOf(db, type)) as TemplateRow[]
  return rows.map(toTemplate)
}

/** Saves an entity's description, details, stats and tags as a template. */
export function saveTemplate(db: Database.Database, entityId: number, name?: string): EntityTemplate {
  const entity = db.prepare(`
    SELECT e.type_id, e.name, e.description, e.metadata, et.name AS type_name
    FROM entities e JOIN entity_types et ON et.id = e.type_id
    WHERE e.id = ? AND e.deleted_at IS NULL
  `).get(entityId) as { type_id: number, name: string, description: string | null, metadata: string | null, type_name: string } | undefined
  if (!entity) throw new TemplateError(404, 'Entity not found')
  if (!typeKeyOf(entity.type_name)) throw new TemplateError(400, 'This kind of entry can\'t be a template')

  const stats = db.prepare('SELECT template_id, values_json FROM entity_stats WHERE entity_id = ?').get(entityId) as
    { template_id: number, values_json: string | null } | undefined
  const tagIds = (db.prepare('SELECT tag_id FROM entity_tags WHERE entity_id = ? ORDER BY tag_id').all(entityId) as Array<{ tag_id: number }>)
    .map(r => r.tag_id)

  const id = Number(
    db.prepare(`
      INSERT INTO entity_templates (type_id, name, description, metadata, stat_template_id, stat_values_json, tag_ids_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      entity.type_id,
      cleanName(name) || entity.name,
      entity.description,
      entity.metadata,
      stats?.template_id ?? null,
      stats?.values_json ?? null,
      tagIds.length ? JSON.stringify(tagIds) : null,
    ).lastInsertRowid,
  )
  return toTemplate(getRow(db, id))
}

/** Stats and tags from a template, for a freshly created entity (existing values win). */
function copyExtras(db: Database.Database, row: TemplateRow, entityId: number) {
  if (row.stat_template_id !== null) {
    db.prepare('INSERT OR IGNORE INTO entity_stats (entity_id, template_id, values_json) VALUES (?, ?, ?)')
      .run(entityId, row.stat_template_id, row.stat_values_json ?? '{}')
  }
  const insertTag = db.prepare('INSERT OR IGNORE INTO entity_tags (entity_id, tag_id) SELECT ?, id FROM tags WHERE id = ? AND deleted_at IS NULL')
  for (const tagId of parseJson<number[]>(row.tag_ids_json, [])) insertTag.run(entityId, tagId)
}

/** Creates a new entry in a campaign from a template; returns its id. */
export function createFromTemplate(db: Database.Database, templateId: number, campaignId: number, name?: string): number {
  const row = getRow(db, templateId)
  const campaign = db.prepare('SELECT id FROM campaigns WHERE id = ? AND deleted_at IS NULL').get(campaignId)
  if (!campaign) throw new TemplateError(404, 'Campaign not found')
  return db.transaction(() => {
    // One INSERT with every column (the entities_fts index doesn't like a second write in the same transaction)
    const id = Number(
      db.prepare('INSERT INTO entities (type_id, campaign_id, name, description, metadata) VALUES (?, ?, ?, ?, ?)')
        .run(row.type_id, campaignId, cleanName(name) || row.name, row.description, row.metadata)
        .lastInsertRowid,
    )
    copyExtras(db, row, id)
    return id
  })()
}

export function setDefaultTemplate(db: Database.Database, templateId: number, isDefault: boolean): EntityTemplate {
  const row = getRow(db, templateId)
  db.transaction(() => {
    if (isDefault) db.prepare('UPDATE entity_templates SET is_default = 0 WHERE type_id = ?').run(row.type_id)
    db.prepare('UPDATE entity_templates SET is_default = ? WHERE id = ?').run(isDefault ? 1 : 0, templateId)
  })()
  return toTemplate(getRow(db, templateId))
}

export function deleteTemplate(db: Database.Database, templateId: number) {
  getRow(db, templateId)
  db.prepare('DELETE FROM entity_templates WHERE id = ?').run(templateId)
}

const isEmpty = (value: unknown) =>
  value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)

/**
 * The default template of a type fills what a new entry leaves empty:
 * description and each empty detail field. Call before the INSERT, then
 * `applyDefaultExtras` after it for stats and tags.
 */
export function fillFromDefault<M extends object>(
  db: Database.Database,
  typeName: string,
  description: string | null | undefined,
  metadata: M | null | undefined,
): { description: string | null, metadata: M | null, template: TemplateRow | null } {
  const template = db
    .prepare(`${TEMPLATE_SELECT} WHERE et.name = ? AND t.is_default = 1 LIMIT 1`)
    .get(typeName) as TemplateRow | undefined
  if (!template) return { description: description || null, metadata: metadata ?? null, template: null }

  const defaults = parseJson<Record<string, unknown>>(template.metadata, {})
  const merged: Record<string, unknown> = { ...(metadata ?? {}) }
  for (const [key, value] of Object.entries(defaults)) {
    if (isEmpty(merged[key]) && !isEmpty(value)) merged[key] = value
  }
  return {
    description: description || template.description || null,
    metadata: Object.keys(merged).length ? (merged as M) : null,
    template,
  }
}

export function applyDefaultExtras(db: Database.Database, template: TemplateRow | null, entityId: number | bigint) {
  if (template) copyExtras(db, template, Number(entityId))
}

interface TemplateRequest {
  method: string
  segments: string[]
  query: Record<string, unknown>
  body: Record<string, unknown> | null
}

/**
 * GET    /api/templates/list?type=npc            list
 * POST   /api/templates/save { entityId, name? } save an entry as a template
 * POST   /api/templates/duplicate/:entityId { name? } -> { id } (copy in the same campaign, M8.1)
 * (one route file for all of it keeps the Nitro route count down; no bare /api/templates)
 * POST   /api/templates/:id/create { campaignId, name? } -> { id }
 * PATCH  /api/templates/:id { isDefault }
 * DELETE /api/templates/:id
 */
export function handleTemplateRequest(db: Database.Database, request: TemplateRequest, uploadsDir: string): unknown {
  const { method, segments, query } = request
  const body = request.body ?? {}
  if (segments.length === 2 && segments[0] === 'duplicate' && method === 'POST') {
    try {
      return { id: duplicateEntity(db, uploadsDir, Number(segments[1]), body.name as string | undefined) }
    }
    catch (error) {
      if (error instanceof DuplicateError) throw new TemplateError(404, 'Entity not found')
      throw error
    }
  }
  if (segments.length === 1 && segments[0] === 'list' && method === 'GET') return listTemplates(db, query.type as TemplateType)
  if (segments.length === 1 && segments[0] === 'save' && method === 'POST') {
    return saveTemplate(db, Number(body.entityId), body.name as string | undefined)
  }
  const id = Number(segments[0])
  if (!Number.isInteger(id) || id <= 0) throw new TemplateError(404, 'Not found')

  if (segments.length === 1) {
    if (method === 'PATCH') return setDefaultTemplate(db, id, Boolean(body.isDefault))
    if (method === 'DELETE') {
      deleteTemplate(db, id)
      return { success: true }
    }
  }
  else if (segments.length === 2 && segments[1] === 'create' && method === 'POST') {
    return { id: createFromTemplate(db, id, Number(body.campaignId), body.name as string | undefined) }
  }
  throw new TemplateError(404, 'Not found')
}
