import { getDb } from '../../utils/db'
import { applyDefaultExtras, fillFromDefault } from '../../utils/entity-templates'
import type { LoreMetadata } from '../../../types/lore'

export default defineEventHandler(async (event) => {
  const db = getDb()
  const body = await readBody(event)

  const { name, description, location_id, metadata, campaignId } = body as {
    name: string
    description?: string
    location_id?: number | null
    metadata?: LoreMetadata
    campaignId: number
  }

  if (!name || !campaignId) {
    throw createError({
      statusCode: 400,
      message: 'Name and Campaign ID are required',
    })
  }

  // Get Lore entity type ID
  const entityType = db
    .prepare<unknown[], { id: number }>('SELECT id FROM entity_types WHERE name = ?')
    .get('Lore')

  if (!entityType) {
    throw createError({
      statusCode: 500,
      message: 'Lore entity type not found',
    })
  }

  // Lore metadata doesn't need conversion (type and date are already keys)
  // The default template fills what was left empty (DM Command Center M8.2)
  const filled = fillFromDefault(db, 'Lore', description, metadata)
  const result = db
    .prepare(
      `
    INSERT INTO entities (type_id, campaign_id, name, description, location_id, metadata)
    VALUES (?, ?, ?, ?, ?, ?)
  `,
    )
    .run(
      entityType.id,
      campaignId,
      name,
      filled.description,
      location_id ?? null,
      filled.metadata ? JSON.stringify(filled.metadata) : null,
    )
  applyDefaultExtras(db, filled.template, result.lastInsertRowid)

  interface DbEntity {
    id: number
    type_id: number
    campaign_id: number
    name: string
    description: string | null
    metadata: string | null
    created_at: string
    updated_at: string
    deleted_at: string | null
  }

  const lore = db
    .prepare<unknown[], DbEntity>(
      `
    SELECT * FROM entities WHERE id = ?
  `,
    )
    .get(result.lastInsertRowid)

  if (!lore) {
    throw createError({
      statusCode: 500,
      message: 'Failed to create lore entry',
    })
  }

  return {
    ...lore,
    metadata: lore.metadata ? (JSON.parse(lore.metadata) as LoreMetadata) : null,
  }
})
