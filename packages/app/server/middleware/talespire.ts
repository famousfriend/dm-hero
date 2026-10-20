import { getDb } from '../utils/db'
import { getTaleSpireKey, getTaleSpireState, isTaleSpireKey, logTaleSpireRoll, TaleSpireError } from '../utils/talespire'

/*
 * API of the TaleSpire panel (see utils/talespire.ts), outside /api so it needs
 * no new route files (the typed route list is full) and can answer TaleSpire's
 * browser with CORS headers:
 *   GET  /talespire-api/state   the running fight              (panel key)
 *   POST /talespire-api/roll    a roll for the action log      (panel key)
 *   GET  /talespire-api/setup   url + key for installing       (this app only, no CORS)
 */
export default defineEventHandler(async (event) => {
  const path = event.path.split('?')[0]!
  if (!path.startsWith('/talespire-api/')) return
  const db = getDb()

  if (path === '/talespire-api/setup') {
    // Never readable by other sites: no CORS headers, and browsers mark cross-site requests
    const site = getHeader(event, 'sec-fetch-site')
    if (site && site !== 'same-origin' && site !== 'none') throw createError({ statusCode: 403, message: 'Not allowed' })
    const origin = getRequestURL(event).origin.replace('localhost', '127.0.0.1')
    return { url: process.env.DM_HERO_APP_URL ?? origin, key: getTaleSpireKey(db) }
  }

  setResponseHeaders(event, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type, x-dmcc-key',
    'Access-Control-Allow-Private-Network': 'true',
    'Access-Control-Max-Age': '600',
  })
  if (event.method === 'OPTIONS') {
    setResponseStatus(event, 204)
    return ''
  }
  if (!isTaleSpireKey(db, getHeader(event, 'x-dmcc-key'))) throw createError({ statusCode: 401, message: 'Wrong or missing key' })

  try {
    if (path === '/talespire-api/state' && event.method === 'GET') return getTaleSpireState(db)
    if (path === '/talespire-api/roll' && event.method === 'POST') return logTaleSpireRoll(db, (await readBody(event)) ?? {})
  }
  catch (error) {
    if (error instanceof TaleSpireError) throw createError({ statusCode: error.statusCode, message: error.message })
    throw error
  }
  throw createError({ statusCode: 404, message: 'Not found' })
})
