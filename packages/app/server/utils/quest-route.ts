import type Database from 'better-sqlite3'
import {
  QuestInputError,
  createContinuityItem,
  createQuest,
  deleteContinuityItem,
  deleteQuest,
  getQuest,
  listContinuity,
  listLastMet,
  listLinkable,
  listQuests,
  updateContinuityItem,
  updateQuest,
} from './quests'
import { PlayerPackInputError, buildPlayerPack } from './player-pack'
import { RecapInputError, addRecapFile, deleteRecapFile, getRecap, listRecaps, updateRecap } from './recaps'
import { getUploadPath } from './paths'

/*
 * All quest and continuity endpoints live behind ONE route (/api/quests/**).
 * Nitro types $fetch by matching URLs against every route; at ~220 routes that
 * matching is at TypeScript's instantiation limit (TS2589), so each feature
 * should add as few route files as possible.
 *
 *   GET    /api/quests?campaignId=1                  quests of a campaign
 *   POST   /api/quests                               { campaignId, name, ... }
 *   GET    /api/quests/linkable?campaignId=1         NPCs, places ... for pickers
 *   GET    /api/quests/last-met?campaignId=1         latest session per NPC
 *   GET    /api/quests/continuity?campaignId=1&sessionId=&status=&entityId=
 *   POST   /api/quests/continuity                    { campaignId, sessionId?, kind, text, ... }
 *   PATCH  /api/quests/continuity/:id                { kind?, text?, status?, nextSession?, entityIds? }
 *   DELETE /api/quests/continuity/:id
 *   POST   /api/quests/player-pack                   { campaignId, npcIds, placeIds, questIds, includeDescriptions, ... }
 *                                                     file for the Player Companion (server/utils/player-pack.ts)
 *   GET | PATCH | DELETE /api/quests/:id
 *
 * Session recaps (server/utils/recaps.ts):
 *   GET    /api/quests/recaps?campaignId=1           every session with its recap and files
 *   GET    /api/quests/recaps/:sessionId
 *   PATCH  /api/quests/recaps/:sessionId             { recap }
 *   POST   /api/quests/recaps/:sessionId/files       { fileName, data (base64) }
 *   DELETE /api/quests/recaps/files/:fileId
 */

export interface QuestRequest {
  method: string
  /** Path below /api/quests, split on "/" */
  segments: string[]
  query: Record<string, unknown>
  body: Record<string, unknown> | null
}

export class QuestRouteError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message)
  }
}

const notFound = (what = 'Not found') => new QuestRouteError(404, what)

function campaignIdFrom(source: Record<string, unknown> | null): number {
  const campaignId = Number(source?.campaignId)
  if (!campaignId) throw new QuestRouteError(400, 'campaignId is required')
  return campaignId
}

const optionalNumber = (value: unknown) => (value ? Number(value) : undefined)

function dispatchRecaps(db: Database.Database, { method, segments, query, body }: QuestRequest): unknown {
  const [, second, third, ...rest] = segments
  if (rest.length) throw notFound()
  if (!second && method === 'GET') return listRecaps(db, campaignIdFrom(query))
  if (second === 'files' && third && method === 'DELETE') {
    if (!deleteRecapFile(db, getUploadPath(), Number(third))) throw notFound('File not found')
    return { success: true }
  }
  if (second && /^\d+$/.test(second)) {
    const sessionId = Number(second)
    if (!third) {
      if (method === 'GET') return getRecap(db, sessionId)
      if (method === 'PATCH') return updateRecap(db, sessionId, body?.recap ?? null)
    }
    else if (third === 'files' && method === 'POST') {
      return addRecapFile(db, getUploadPath(), sessionId, body ?? {})
    }
  }
  throw notFound()
}

function dispatch(db: Database.Database, request: QuestRequest): unknown {
  if (request.segments[0] === 'recaps') return dispatchRecaps(db, request)
  const { method, segments, query, body } = request
  const [first, second, ...rest] = segments
  if (rest.length) throw notFound()
  const input = body ?? {}

  if (!first) {
    if (method === 'GET') return listQuests(db, campaignIdFrom(query))
    if (method === 'POST') return createQuest(db, campaignIdFrom(input), input)
  }
  else if (first === 'linkable' && !second && method === 'GET') {
    return listLinkable(db, campaignIdFrom(query))
  }
  else if (first === 'player-pack' && !second && method === 'POST') {
    return buildPlayerPack(db, campaignIdFrom(input), input)
  }
  else if (first === 'last-met' && !second && method === 'GET') {
    return listLastMet(db, campaignIdFrom(query))
  }
  else if (first === 'continuity') {
    if (!second) {
      if (method === 'GET') {
        const status = query.status === 'open' || query.status === 'resolved' ? query.status : undefined
        return listContinuity(db, campaignIdFrom(query), {
          sessionId: optionalNumber(query.sessionId),
          entityId: optionalNumber(query.entityId),
          status,
        })
      }
      if (method === 'POST') return createContinuityItem(db, campaignIdFrom(input), input)
    }
    else {
      const id = Number(second)
      if (method === 'PATCH') return updateContinuityItem(db, id, input)
      if (method === 'DELETE') {
        if (!deleteContinuityItem(db, id)) throw notFound('Item not found')
        return { success: true }
      }
    }
  }
  else if (!second && /^\d+$/.test(first)) {
    const id = Number(first)
    if (method === 'GET') {
      const quest = getQuest(db, id)
      if (!quest) throw notFound('Quest not found')
      return quest
    }
    if (method === 'PATCH') return updateQuest(db, id, input)
    if (method === 'DELETE') {
      if (!deleteQuest(db, id)) throw notFound('Quest not found')
      return { success: true }
    }
  }
  throw notFound()
}

/** Runs a quest/continuity request; input errors become 400 (or 404 for "... not found"). */
export function handleQuestRequest(db: Database.Database, request: QuestRequest): unknown {
  try {
    return dispatch(db, request)
  }
  catch (error) {
    if (error instanceof PlayerPackInputError) throw new QuestRouteError(404, error.message)
    if (error instanceof QuestInputError || error instanceof RecapInputError) {
      throw new QuestRouteError(error.message.endsWith('not found') ? 404 : 400, error.message)
    }
    throw error
  }
}
