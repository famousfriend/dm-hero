import { getDb } from '../../utils/db'
import { CodexUserError, handleCodexUserRequest } from '../../utils/codex-user'
import { handleCodexImportRequest } from '../../utils/codex-import'

// Bookmarks, homebrew, campaign edits and imports, all in one route
// - see server/utils/codex-user.ts and codex-import.ts
export default defineEventHandler(async (event) => {
  const method = event.method
  const body = method === 'POST' || method === 'PUT' ? ((await readBody(event)) ?? {}) : null
  try {
    const request = {
      method,
      segments: (getRouterParam(event, 'path') ?? '').split('/').filter(Boolean),
      query: getQuery(event),
      body,
    }
    return handleCodexImportRequest(getDb(), request) ?? handleCodexUserRequest(getDb(), request)
  }
  catch (error) {
    if (error instanceof CodexUserError) throw createError({ statusCode: error.statusCode, message: error.message })
    throw error
  }
})
