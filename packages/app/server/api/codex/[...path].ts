import { getDb } from '../../utils/db'
import { CodexUserError, handleCodexUserRequest } from '../../utils/codex-user'

// Bookmarks, homebrew and campaign edits, all in one route - see server/utils/codex-user.ts
export default defineEventHandler(async (event) => {
  const method = event.method
  const body = method === 'POST' || method === 'PUT' ? ((await readBody(event)) ?? {}) : null
  try {
    return handleCodexUserRequest(getDb(), {
      method,
      segments: (getRouterParam(event, 'path') ?? '').split('/').filter(Boolean),
      query: getQuery(event),
      body,
    })
  }
  catch (error) {
    if (error instanceof CodexUserError) throw createError({ statusCode: error.statusCode, message: error.message })
    throw error
  }
})
