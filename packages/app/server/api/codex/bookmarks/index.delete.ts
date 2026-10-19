import { getDb } from '../../../utils/db'
import { deleteBookmark } from '../../../utils/codex'

// DELETE /api/codex/bookmarks?uid=spell:toll the dead|xge
export default defineEventHandler((event) => {
  const { uid } = getQuery(event)
  if (typeof uid !== 'string' || !deleteBookmark(getDb(), uid)) {
    throw createError({ statusCode: 404, message: 'Bookmark not found' })
  }
  return { success: true }
})
