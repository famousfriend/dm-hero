import { getDb } from '../../utils/db'
import { DuplicateError, duplicateEncounter } from '../../utils/entity-duplicate'

export default defineEventHandler(async (event) => {
  const db = getDb()
  const body = await readBody(event)

  const { campaignId, name, session_id, duplicateOf } = body

  // { duplicateOf: id, name? }: copy a fight to run again (participants, abilities, references)
  if (duplicateOf) {
    try {
      return db.prepare('SELECT * FROM encounters WHERE id = ?').get(duplicateEncounter(db, Number(duplicateOf), name))
    }
    catch (error) {
      if (error instanceof DuplicateError) throw createError({ statusCode: 404, message: 'Encounter not found' })
      throw error
    }
  }

  if (!campaignId || !name) {
    throw createError({
      statusCode: 400,
      message: 'Campaign ID and name are required',
    })
  }

  const result = db
    .prepare(
      `
    INSERT INTO encounters (campaign_id, session_id, name, status, round, current_turn_index)
    VALUES (?, ?, ?, 'setup', 0, 0)
  `,
    )
    .run(campaignId, session_id || null, name)

  const encounter = db
    .prepare(
      `
    SELECT
      id, campaign_id, session_id, name, status, round, current_turn_index,
      created_at, updated_at, finished_at
    FROM encounters
    WHERE id = ?
  `,
    )
    .get(result.lastInsertRowid)

  return encounter
})
