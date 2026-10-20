import { getDb } from '../../../utils/db'
import { getUploadPath } from '../../../utils/paths'
import { DuplicateError, duplicateEntity } from '../../../utils/entity-duplicate'

// POST { name? } -> { id } of the copy (same campaign; stats, tags, relations, pictures, documents)
export default defineEventHandler(async (event) => {
  const db = getDb()
  const id = Number(getRouterParam(event, 'id'))
  const body = (await readBody(event).catch(() => null)) ?? {}
  if (!id) throw createError({ statusCode: 400, message: 'Entity ID is required' })
  try {
    return { id: duplicateEntity(db, getUploadPath(), id, body.name) }
  }
  catch (error) {
    if (error instanceof DuplicateError) throw createError({ statusCode: 404, message: 'Entity not found' })
    throw error
  }
})
