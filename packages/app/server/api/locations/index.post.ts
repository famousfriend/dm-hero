import { getDb } from '../../utils/db'
import { applyDefaultExtras, fillFromDefault } from '../../utils/entity-templates'

export default defineEventHandler(async (event) => {
  const db = getDb()
  const body = await readBody(event)

  const { name, description, metadata, campaignId, parentLocationId } = body

  if (!name || !campaignId) {
    throw createError({
      statusCode: 400,
      message: 'Name and campaign ID are required',
    })
  }

  // Get Location entity type
  const entityType = db
    .prepare(
      `
    SELECT id FROM entity_types WHERE name = 'Location'
  `,
    )
    .get() as { id: number } | undefined

  if (!entityType) {
    throw createError({
      statusCode: 500,
      message: 'Location entity type not found',
    })
  }

  // The default template fills what was left empty (DM Command Center M8.2)
  const filled = fillFromDefault(db, 'Location', description, metadata)
  const result = db
    .prepare(
      `
    INSERT INTO entities (type_id, name, description, metadata, campaign_id, parent_entity_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `,
    )
    .run(
      entityType.id,
      name,
      filled.description,
      filled.metadata ? JSON.stringify(filled.metadata) : null,
      campaignId,
      parentLocationId || null,
    )
  applyDefaultExtras(db, filled.template, result.lastInsertRowid)

  interface LocationRow {
    id: number
    name: string
    description: string | null
    metadata: string | null
    parent_entity_id: number | null
    created_at: string
    updated_at: string
  }

  const location = db
    .prepare<unknown[], LocationRow>(
      `
    SELECT * FROM entities WHERE id = ?
  `,
    )
    .get(result.lastInsertRowid)

  if (!location) {
    throw createError({
      statusCode: 500,
      message: 'Failed to create location',
    })
  }

  return {
    ...location,
    metadata: location.metadata ? JSON.parse(location.metadata) : null,
  }
})
