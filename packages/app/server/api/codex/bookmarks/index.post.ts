import { getDb } from '../../../utils/db'
import { BookmarkError, saveBookmark } from '../../../utils/codex'

// POST /api/codex/bookmarks { kind, name, book, url } -> the bookmark (or the existing entry)
export default defineEventHandler(async (event) => {
  const body = (await readBody(event)) ?? {}
  try {
    return saveBookmark(getDb(), body)
  }
  catch (error) {
    if (error instanceof BookmarkError) throw createError({ statusCode: 400, message: error.message })
    throw error
  }
})
