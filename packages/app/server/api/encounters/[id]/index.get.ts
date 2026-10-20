import { getDb } from '../../../utils/db'
import { listParticipants } from '../../../utils/encounter-participants'

export default defineEventHandler((event) => {
  const db = getDb()
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({
      statusCode: 400,
      message: 'Encounter ID is required',
    })
  }

  const encounter = db
    .prepare(
      `
    SELECT
      id, campaign_id, session_id, name, status, round, current_turn_index,
      created_at, updated_at, finished_at
    FROM encounters
    WHERE id = ? AND deleted_at IS NULL
  `,
    )
    .get(id)

  if (!encounter) {
    throw createError({
      statusCode: 404,
      message: 'Encounter not found',
    })
  }

  const participants = listParticipants(db, id)

  return { ...encounter, participants }
})
