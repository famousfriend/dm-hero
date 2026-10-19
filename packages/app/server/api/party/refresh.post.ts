import { getDb } from '../../utils/db'
import { listParty, refreshParty } from '../../utils/party'

// POST /api/party/refresh?campaignId=1 - auto-refresh: fetches linked sheets not
// fetched in the last few seconds, then returns the party
export default defineEventHandler(async (event) => {
  const campaignId = Number(getQuery(event).campaignId)
  if (!campaignId) {
    throw createError({ statusCode: 400, message: 'Campaign ID is required' })
  }
  const db = getDb()
  await refreshParty(db, campaignId)
  return listParty(db, campaignId)
})
