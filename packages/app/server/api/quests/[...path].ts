import { getDb } from '../../utils/db'
import { QuestRouteError, handleQuestRequest } from '../../utils/quest-route'

// Quests and continuity, all in one route - see server/utils/quest-route.ts
export default defineEventHandler(async (event) => {
  const method = event.method
  const body = method === 'POST' || method === 'PATCH' ? ((await readBody(event)) ?? {}) : null
  try {
    return handleQuestRequest(getDb(), {
      method,
      segments: (getRouterParam(event, 'path') ?? '').split('/').filter(Boolean),
      query: getQuery(event),
      body,
    })
  }
  catch (error) {
    if (error instanceof QuestRouteError) throw createError({ statusCode: error.statusCode, message: error.message })
    throw error
  }
})
