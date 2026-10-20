import { getDb } from '../../../utils/db'
import { handlePlayerExportRequest, PlayerExportError } from '../../../utils/share/player-export'

// Player handout as one html file - see server/utils/share/player-export.ts
export default defineEventHandler(async (event) => {
  const campaignId = Number(getRouterParam(event, 'id'))
  if (!campaignId) throw createError({ statusCode: 400, message: 'Invalid campaign ID' })
  const body = event.method === 'POST' ? ((await readBody(event)) ?? {}) : null
  try {
    const result = await handlePlayerExportRequest(getDb(), event.method, campaignId, body)
    if (typeof result === 'string') setHeader(event, 'content-type', 'text/html; charset=utf-8')
    return result
  }
  catch (error) {
    if (error instanceof PlayerExportError) throw createError({ statusCode: error.statusCode, message: error.message })
    throw error
  }
})
