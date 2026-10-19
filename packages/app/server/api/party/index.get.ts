import { getDb } from '../../utils/db'
import { listParty } from '../../utils/party'

// GET /api/party?campaignId=1 - every active player character with live numbers
export default defineEventHandler((event) => {
  const campaignId = Number(getQuery(event).campaignId)
  if (!campaignId) {
    throw createError({ statusCode: 400, message: 'Campaign ID is required' })
  }
  return listParty(getDb(), campaignId)
})
