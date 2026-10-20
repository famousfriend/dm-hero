import { getDb } from '../../utils/db'
import { TemplateError, handleTemplateRequest } from '../../utils/entity-templates'
import { getUploadPath } from '../../utils/paths'

// Entity templates and duplicates, all in one route - see server/utils/entity-templates.ts
export default defineEventHandler(async (event) => {
  const method = event.method
  const body = method === 'POST' || method === 'PATCH' ? ((await readBody(event)) ?? {}) : null
  try {
    return handleTemplateRequest(getDb(), {
      method,
      segments: (getRouterParam(event, 'path') ?? '').split('/').filter(Boolean),
      query: getQuery(event),
      body,
    }, getUploadPath())
  }
  catch (error) {
    if (error instanceof TemplateError) throw createError({ statusCode: error.statusCode, message: error.message })
    throw error
  }
})
